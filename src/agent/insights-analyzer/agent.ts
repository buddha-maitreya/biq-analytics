/**
 * Insights Analyzer Agent -- "The Analyst"
 *
 * Computational intelligence specialist. Uses the Agentuity sandbox
 * to execute dynamically-generated Python code for statistical
 * analysis that goes BEYOND what SQL can express: z-scores, moving
 * averages, trend projections, anomaly scoring, demand forecasting,
 * pareto analysis, cohort comparisons, etc.
 *
 * Architecture (single-script code orchestration):
 *   1. LLM receives analysis request, database schema, and Python API stubs
 *   2. LLM generates ONE complete Python script that:
 *      - Calls query_db()/query_df() to fetch data directly from Postgres
 *      - Performs statistical analysis using numpy/pandas/scipy/sklearn/statsmodels
 *      - Returns structured JSON insights including confidence metrics
 *   3. Sandbox executes the script with directDbAccess (DATABASE_URL injected)
 *   4. Only the final JSON result returns — no intermediate data in LLM context
 *   5. On failure, error is fed back to LLM for one self-correction retry
 *
 * Confidence scoring is COMPUTATION-BASED: the sandbox code returns
 * statistical quality metrics (sample size, std deviation, p-values)
 * which determine confidence, rather than the LLM guessing a number.
 *
 * All runtime parameters (model, maxSteps, temperature, timeout, etc.)
 * are read from the agent_configs DB table -- tunable per-deployment
 * via the Admin Console without code changes.
 */

import { createAgent } from "@agentuity/runtime";
import { generateText } from "ai";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { DB_SCHEMA_ANALYTICS } from "@lib/db-schema";
import { executeSandbox } from "@lib/sandbox";
import type { SandboxRuntime, SandboxResult } from "@lib/sandbox";
import { createCache, CACHE_NS, CACHE_TTL, analysisKey } from "@lib/cache";
import { maskPII } from "@lib/pii";
import { validateTextOutput } from "@lib/output-validation";
import { createTokenTracker, DEFAULT_TOKEN_BUDGETS } from "@lib/tokens";
import { SpanCollector, traced } from "@lib/tracing";
import { getAnalysisPromptForType } from "@services/type-registry";
import type { AISettings } from "@services/settings";
import {
  InsightsConfig,
  inputSchema,
  outputSchema,
  type InsightItem,
  type InsightChart,
} from "./types";
import { parseInsightsFromText } from "./prompts";
import { getAgentConfigWithDefaults } from "@services/agent-configs";

// ────────────────────────────────────────────────────────────
// Agent definition
// ────────────────────────────────────────────────────────────

const agent = createAgent("insights-analyzer", {
  description:
    "Statistical analysis specialist -- runs LLM-generated Python (numpy/pandas/scipy/sklearn/statsmodels) in a sandbox for demand forecasting, anomaly detection, restock recommendations, and sales trend analysis.",

  schema: { input: inputSchema, output: outputSchema },

  setup: async (): Promise<InsightsConfig> => {
    // Static defaults only — no DB calls, cannot fail or timeout.
    // Live config is loaded per-request in the handler via
    // getAgentConfigWithDefaults() (60s memory cache, infallible
    // fallback to AGENT_DEFAULTS if DB is unreachable).
    return {
      agentConfig: {
        id: "",
        agentName: "insights-analyzer",
        displayName: "The Analyst",
        description: "Statistical analysis specialist",
        isActive: true,
        modelOverride: null,
        temperature: null,
        maxSteps: 5,
        timeoutMs: 45000,
        customInstructions: null,
        executionPriority: 1,
        config: { structuringModel: "gpt-4o-mini", sandboxMemoryMb: 256, sandboxTimeoutMs: 30000 },
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sandboxTimeoutMs: 30_000,
      structuringModel: "gpt-4o-mini",
      maxSteps: 5,
      temperature: undefined,
      // Snapshot resolved at infrastructure level by sandbox.ts
      // (reads ANALYTICS_SNAPSHOT_ID env var as default for Python runtimes)
      sandboxRuntime: undefined,
      sandboxDeps: undefined,
      sandboxMemory: undefined,
    };
  },

  shutdown: async (_app, _config) => {
    // Graceful shutdown — clean up sandbox snapshots or cached analysis.
    // Currently stateless; hook reserved for future resource cleanup.
  },

  handler: async (ctx, input) => {
    // Phase 1.9: Use request-scoped state for timing metadata
    ctx.state.set("startedAt", Date.now());

    // Phase 1.10: Telemetry collector
    const collector = new SpanCollector("insights-analyzer");

    // Phase 3.2: Check KV cache for recent identical analysis
    const cacheKeyStr = analysisKey(input.analysis, input.timeframeDays, input.productId);
    const cache = createCache(ctx.kv as any);
    const cached = await cache.get<{
      analysisType: string;
      generatedAt: string;
      insights: any[];
      summary: string;
    }>(CACHE_NS.ANALYSIS, cacheKeyStr);
    if (cached) {
      ctx.logger.info("Returning cached analysis", {
        analysis: input.analysis,
        cacheKey: cacheKeyStr,
      });
      return cached;
    }

    // ── Load live agent config (infallible — 60s cache, AGENT_DEFAULTS fallback) ──
    const agentConfig = await getAgentConfigWithDefaults("insights-analyzer");
    const cfgJson = (agentConfig.config ?? {}) as Record<string, unknown>;
    const sandboxTimeoutMs = (cfgJson.sandboxTimeoutMs as number) ?? 30_000;
    const maxSteps = agentConfig.maxSteps ?? 5;
    const temperature = agentConfig.temperature
      ? parseFloat(agentConfig.temperature)
      : undefined;
    const sandboxSnapshotId = cfgJson.sandboxSnapshotId as string | undefined;
    const sandboxRuntime = cfgJson.sandboxRuntime as string | undefined;
    const sandboxMemory = (cfgJson.sandboxMemoryMb as number)
      ? `${cfgJson.sandboxMemoryMb}MB`
      : undefined;

    // Access app-level AI settings from ctx.app (loaded once in app.ts setup)
    const appState = ctx.app as unknown as { aiSettings?: AISettings } | undefined;
    const ai = appState?.aiSettings;

    // ── Sandbox configuration ────────────────────────────────
    const effectiveRuntime = (sandboxRuntime as SandboxRuntime) ?? "python:3.13";

    // ── Build custom instructions ───────────────────────────
    const customParts: string[] = [];
    if (agentConfig.customInstructions?.trim()) {
      customParts.push(agentConfig.customInstructions.trim());
    }
    if (ai?.aiInsightsInstructions?.trim()) {
      customParts.push(ai.aiInsightsInstructions.trim());
    }
    const customInstructions = customParts.length
      ? `\n\nAdditional business-specific instructions:\n${customParts.join("\n")}`
      : "";

    const businessContext = ai?.aiBusinessContext?.trim()
      ? `\n\nBusiness context:\n${ai.aiBusinessContext.trim()}`
      : "";

    // ── Single-pass: LLM generates code + structured insights ──
    // Determine which model to use — prefer gpt-4o-mini for analytics
    // (higher TPM limits: 200K vs 30K on Tier 1 orgs, sufficient for code gen)
    const requestedModel = agentConfig.modelOverride ?? "gpt-4o-mini";
    let lastError: Error | undefined;

    // Try with the requested model first, fall back to gpt-4o-mini on TPM errors
    const modelsToTry = requestedModel === "gpt-4o-mini"
      ? [requestedModel]
      : [requestedModel, "gpt-4o-mini"];

    const tokenTracker = createTokenTracker();
    const tokenBudget =
      ((agentConfig.config as any)?.tokenBudget as number) ??
      DEFAULT_TOKEN_BUDGETS["insights-analyzer"];

    // System prompt instructs the LLM to generate a COMPLETE Python script
    // instead of using tool calls. The script calls query_db()/query_df()
    // directly inside the sandbox (directDbAccess mode), keeping all
    // intermediate data in sandbox memory — only the final JSON returns.
    const systemPrompt = `You are a data scientist for ${config.companyName}. Write a COMPLETE Python script that analyzes business data, generates publication-quality charts, and returns structured insights.

${DB_SCHEMA_ANALYTICS}

Currency: ${config.currency}. Products="${config.labels.product}", Orders="${config.labels.order}", Customers="${config.labels.customer}".${businessContext}${customInstructions}

PYTHON API (pre-loaded in sandbox):
- query_db(sql, limit=None) -- execute a PostgreSQL SELECT query, returns list[dict]
- query_df(sql, limit=None) -- same but returns pandas DataFrame (date columns auto-parsed)
- Pre-installed: numpy (np), pandas (pd), scipy.stats, sklearn, statsmodels, matplotlib, seaborn

DATABASE ACCESS:
- Only SELECT/WITH queries. No INSERT/UPDATE/DELETE/DROP.

CHART API (pre-loaded — brand colors and styling already applied):
- apply_brand_style() — already called at script start, do NOT call again
- get_brand_palette(n) — returns n brand colors as hex list
- format_currency(value) — formats as "${config.currency} 1.2M" / "${config.currency} 45.3K"
- currency_formatter() — returns matplotlib FuncFormatter for currency Y-axis
- save_chart(fig, title, width=800, height=400) — saves chart as base64 PNG
  * Call this INSTEAD of plt.show() or plt.savefig()
  * Charts are automatically collected and returned with results
- sns (seaborn) is available with brand palette pre-set

YOUR SCRIPT MUST:
1. Fetch data using query_db() or query_df() — call them as many times as needed
2. Perform statistical analysis (z-scores, trends, forecasts, anomaly detection, etc.)
3. Generate 2-3 publication-quality charts using matplotlib/seaborn that visualize key findings:
   - Use fig, ax = plt.subplots(figsize=(10, 5)) for each chart
   - Use seaborn (sns) for beautiful statistical visualizations when appropriate
   - Use get_brand_palette() for colors, currency_formatter() for money axes
   - Add clear titles, axis labels, and legends
   - Call save_chart(fig, "Descriptive Title") for each chart — NEVER plt.show()
   - Chart types to consider: line plots, bar charts, heatmaps, scatter plots, area charts
4. Handle empty data gracefully (check len() before analysis and charting)
5. Use pandas vectorized ops (groupby, rolling, pct_change) — not row-by-row loops
6. Return a dict with this EXACT structure:

return {
    "insights": [
        {
            "title": "Concise headline with key metric",
            "severity": "info" or "warning" or "critical",
            "description": "Detailed explanation with specific numbers and percentages",
            "recommendation": "Actionable next step for the business",
            "affectedItems": ["item_1", "item_2"],
            "dataPoints": {"metric_name": value}
        }
    ],
    "summary": "Executive summary of all findings (2-3 sentences with key numbers)",
    "_confidence": {
        "sampleSize": total_rows_analyzed,
        "completeness": ratio_of_non_null_fields,
        "timeSpanDays": actual_days_with_data,
        "pValue": lowest_p_value_if_applicable
    }
}

CHART STYLE GUIDELINES:
- Clean, professional look — no default matplotlib styling
- Use sns.lineplot/barplot/heatmap for elegant charts
- Add gridlines (alpha=0.3) for readability
- Use format_currency() in annotations and currency_formatter() on y-axes showing money
- Include data labels on bar charts when ≤12 bars
- Use fig.suptitle() for main title, ax.set_xlabel()/set_ylabel() for axis labels
- Rotate x-labels 45° if they overlap: plt.xticks(rotation=45, ha='right')
- Always call plt.tight_layout() or fig.tight_layout() before save_chart()

RULES:
- Generate 3-8 insights ranked by business impact (critical first)
- Use f-strings with real computed values — never hardcode example numbers
- Include at least one actionable recommendation per insight
- Timeout: ${sandboxTimeoutMs / 1000}s. Keep queries and analysis efficient.
- If insufficient data, return fewer insights with lower confidence, not fabricated ones.
- Do NOT call plt.show() — only save_chart()

RESPOND WITH ONLY THE PYTHON CODE wrapped in triple-backtick python fences. No explanations outside the code block.`;

    const analysisPrompt = `${await getAnalysisPromptForType(input.analysis, input.timeframeDays)}

${input.productId ? `Focus on product ID: ${input.productId}` : "Analyze all active products."}

Write the complete Python script now.`;

    let generatedScript = "";

    for (const modelName of modelsToTry) {
      try {
        const result = await traced(
          ctx.tracer,
          collector,
          "generateText",
          "llm",
          async () => generateText({
          model: await getModel(modelName),
          ...(temperature !== undefined ? { temperature } : {}),
          system: systemPrompt,
          prompt: analysisPrompt,
        }),
          { model: modelName, analysis: input.analysis }
        );

        // Extract Python code from LLM response
        const codeMatch = result.text.match(/```python\s*([\s\S]*?)```/);
        generatedScript = codeMatch?.[1]?.trim() || result.text.trim();

        // Track token usage
        if (result.usage) {
          tokenTracker.add(
            result.usage.promptTokens ?? 0,
            result.usage.completionTokens ?? 0
          );
        }
        lastError = undefined;
        break; // Success — exit the model loop
      } catch (err: any) {
        lastError = err;
        const msg = err.message || "";
        // If it's a TPM/rate limit error, try the next model
        if (msg.includes("tokens per min") || msg.includes("TPM") || msg.includes("rate limit") || msg.includes("Request too large")) {
          ctx.logger.warn("TPM limit hit, falling back to next model", {
            model: modelName,
            nextModel: modelsToTry[modelsToTry.indexOf(modelName) + 1] ?? "none",
            error: msg.slice(0, 200),
          });
          continue;
        }
        // Non-TPM error — don't retry with a different model
        throw err;
      }
    }

    if (lastError) throw lastError;

    // ── Chart configuration for brand-aware sandbox charts ────
    const chartConfig = {
      primaryColor: "#3b82f6",
      secondaryColor: "#10b981",
      accentColor: "#f59e0b",
      currencySymbol: config.currency,
      currencyPosition: "prefix" as const,
      companyName: config.companyName,
      chartStyle: "modern" as const,
      fontFamily: "Inter",
      dpi: 150,
    };

    // ── Execute the generated script in sandbox ─────────────
    let sandboxResult = await executeSandbox(ctx.sandbox, {
      code: generatedScript,
      directDbAccess: true,
      chartConfig,
      explanation: `${input.analysis} analysis (single-script)`,
      timeoutMs: sandboxTimeoutMs,
      maxOutputBytes: 2 * 1024 * 1024, // 2MB — charts are base64 PNGs (~100-200KB each)
      runtime: effectiveRuntime,
      snapshotId: sandboxSnapshotId,
      memory: sandboxMemory,
    });

    // ── Error retry: feed error back to LLM for self-correction ──
    if (!sandboxResult.success && generatedScript) {
      ctx.logger.warn("Sandbox script failed, attempting LLM self-correction", {
        errorType: sandboxResult.errorType,
        error: sandboxResult.error?.slice(0, 200),
      });

      try {
        const retryResult = await traced(
          ctx.tracer,
          collector,
          "generateText-retry",
          "llm",
          async () => generateText({
            model: await getModel(modelsToTry[0]),
            ...(temperature !== undefined ? { temperature } : {}),
            system: systemPrompt,
            prompt: `Your previous script failed with this error:\nERROR TYPE: ${sandboxResult.errorType}\nERROR: ${sandboxResult.error?.slice(0, 500)}\nSTDERR: ${sandboxResult.stderr?.slice(0, 500)}\nHINT: ${sandboxResult.errorHint}\n\nFix the script. Common fixes:\n- Check column names against the schema\n- Handle empty DataFrames (check len() first)\n- Use .fillna(0) for numeric operations on nullable columns\n- Ensure query_db() results are not empty before analysis\n\nWrite the corrected complete script:`,
          }),
          { model: modelsToTry[0], analysis: input.analysis, retry: true }
        );

        if (retryResult.usage) {
          tokenTracker.add(
            retryResult.usage.promptTokens ?? 0,
            retryResult.usage.completionTokens ?? 0
          );
        }

        const fixedMatch = retryResult.text.match(/```python\s*([\s\S]*?)```/);
        const fixedScript = fixedMatch?.[1]?.trim() || retryResult.text.trim();

        if (fixedScript) {
          sandboxResult = await executeSandbox(ctx.sandbox, {
            code: fixedScript,
            directDbAccess: true,
            chartConfig,
            explanation: `${input.analysis} analysis (retry)`,
            timeoutMs: sandboxTimeoutMs,
            maxOutputBytes: 2 * 1024 * 1024,
            runtime: effectiveRuntime,
            snapshotId: sandboxSnapshotId,
            memory: sandboxMemory,
          });
        }
      } catch (retryErr: any) {
        ctx.logger.warn("LLM retry failed", { error: retryErr.message?.slice(0, 200) });
      }
    }

    // ── Compute confidence from sandbox result ──────────────
    /**
     * Compute a confidence score (0-1) from statistical metrics
     * returned by the sandbox code. Uses a weighted formula:
     * - Sample size: more data = higher confidence (log scale, cap at 1000)
     * - Data completeness: ratio of non-null fields
     * - Time coverage: actual days with data / requested days
     * - Statistical significance: p-value if available
     */
    function computeConfidence(
      metrics: Array<Record<string, unknown>>
    ): number {
      if (metrics.length === 0) return 0.5; // no metrics = moderate default

      // Average across all sandbox runs
      let totalScore = 0;
      for (const m of metrics) {
        let score = 0;
        let weights = 0;

        // Sample size factor (0-1, log scale up to 1000 rows)
        const sampleSize = Number(m.sampleSize) || 0;
        if (sampleSize > 0) {
          score += Math.min(Math.log10(sampleSize + 1) / 3, 1) * 0.35;
          weights += 0.35;
        }

        // Data completeness factor (0-1)
        const completeness = Number(m.completeness);
        if (!isNaN(completeness) && completeness >= 0) {
          score += Math.min(completeness, 1) * 0.25;
          weights += 0.25;
        }

        // Time coverage factor (actual days / requested days)
        const timeSpan = Number(m.timeSpanDays) || 0;
        const requested = Number(m.requestedDays) || input.timeframeDays;
        if (timeSpan > 0 && requested > 0) {
          score += Math.min(timeSpan / requested, 1) * 0.25;
          weights += 0.25;
        }

        // Statistical significance (p-value < 0.05 = high confidence)
        const pValue = Number(m.pValue);
        if (!isNaN(pValue) && pValue > 0) {
          score += (pValue < 0.05 ? 1 : pValue < 0.1 ? 0.7 : 0.4) * 0.15;
          weights += 0.15;
        }

        totalScore += weights > 0 ? score / weights : 0.5;
      }

      return Math.round((totalScore / metrics.length) * 100) / 100;
    }

    // ── Parse result from sandbox output ────────────────────
    let parsed: { insights: InsightItem[]; summary: string; charts?: InsightChart[] };
    let rawResponse = ""; // No LLM prose in single-script mode (used as fallback only)

    if (sandboxResult.success && sandboxResult.result) {
      const res = sandboxResult.result as any;
      const confidenceMetrics = res?._confidence ? [res._confidence] : [];
      const computedConfidence = computeConfidence(confidenceMetrics);

      // Extract charts from sandbox result (collected via save_chart() calls)
      const charts: InsightChart[] = (sandboxResult.charts ?? []).map((c) => ({
        data: c.data,
        title: c.title,
        width: c.width,
        height: c.height,
      }));

      parsed = {
        insights: Array.isArray(res.insights)
          ? res.insights.map((ins: any) => ({
              ...ins,
              confidence: computedConfidence,
            }))
          : [],
        summary: res.summary ?? JSON.stringify(res).slice(0, 500),
        ...(charts.length > 0 ? { charts } : {}),
      };
    } else {
      // Sandbox failed or returned empty result
      ctx.logger.warn("Sandbox execution did not produce a usable result", {
        success: sandboxResult.success,
        hasResult: !!sandboxResult.result,
        hasError: !!sandboxResult.error,
        errorType: sandboxResult.errorType,
        error: sandboxResult.error?.slice(0, 500),
        stderr: sandboxResult.stderr?.slice(0, 300),
        exitCode: sandboxResult.exitCode,
        stdoutLength: sandboxResult.stdout?.length ?? 0,
      });

      const fallbackMsg = sandboxResult.error
        ? `Analysis encountered an error: ${sandboxResult.error.slice(0, 300)}`
        : sandboxResult.success
          ? "The analysis ran but returned no data. This usually means insufficient sales or order data exists for the requested timeframe. Try a wider timeframe or verify data has been imported."
          : "Analysis could not be completed. The sandbox may be temporarily unavailable. Please try again in a few minutes.";

      const severity: "info" | "warning" = sandboxResult.success ? "info" : "warning";

      parsed = {
        insights: [{
          title: sandboxResult.success ? "Insufficient Data" : "Analysis Error",
          severity,
          description: fallbackMsg,
          recommendation: sandboxResult.success
            ? "Try a wider timeframe (60 or 90 days) or ensure sales data has been imported into the system."
            : "Try with a different analysis type or shorter timeframe. If the issue persists, check the sandbox configuration.",
          confidence: 0.1,
        }] as InsightItem[],
        summary: fallbackMsg,
      };
    }

    const startedAt = ctx.state.get("startedAt") as number | undefined;

    // Phase 7.5: PII masking on summary and insight descriptions
    const { masked: maskedSummary, scan: summaryPII } = maskPII(parsed.summary ?? rawResponse);
    if (summaryPII.hasPII) {
      ctx.logger.info("PII masked in insights summary", {
        detections: summaryPII.detections,
      });
      parsed.summary = maskedSummary;
    }
    for (const insight of parsed.insights) {
      if (insight.description) {
        const { masked } = maskPII(insight.description);
        insight.description = masked;
      }
      if (insight.recommendation) {
        const { masked } = maskPII(insight.recommendation);
        insight.recommendation = masked;
      }
    }

    // Phase 7.5: Validate structured output
    const validation = validateTextOutput(JSON.stringify(parsed), { minLength: 10 });
    if (!validation.valid) {
      ctx.logger.warn("Insights output validation issues", {
        issues: validation.issues.map((i) => i.code),
      });
    }

    ctx.logger.info("Insights analysis complete", {
      analysis: input.analysis,
      insightsCount: parsed.insights?.length ?? 0,
      chartsCount: parsed.charts?.length ?? 0,
      timeframeDays: input.timeframeDays,
      productId: input.productId ?? "all",
      durationMs: startedAt ? Date.now() - startedAt : undefined,
      tokenUsage: tokenTracker.totals(),
      withinBudget: tokenTracker.isWithinBudget(tokenBudget),
    });

    const result = {
      analysisType: input.analysis,
      generatedAt: new Date().toISOString(),
      insights: parsed.insights ?? [],
      summary: parsed.summary ?? rawResponse,
      ...(parsed.charts?.length ? { charts: parsed.charts } : {}),
    };

    // Phase 3.2: Cache analysis result (15-minute TTL)
    ctx.waitUntil(async () => {
      await cache.set(CACHE_NS.ANALYSIS, cacheKeyStr, result, { ttl: CACHE_TTL.MEDIUM });
    });

    // Phase 1.10: Flush telemetry (background)
    ctx.waitUntil(async () => {
      try { await collector.flush(); } catch { /* non-critical */ }
    });

    return result;
  },
});

// ── Agent-level event listeners (per-agent telemetry) ──────
agent.addEventListener("started", (_event, _agentInfo, ctx) => {
  ctx.logger.info("[insights-analyzer] agent invocation started");
});

agent.addEventListener("completed", (_event, _agentInfo, ctx) => {
  ctx.logger.info("[insights-analyzer] agent invocation completed");
});

agent.addEventListener("errored", (_event, _agentInfo, ctx, error) => {
  ctx.logger.error("[insights-analyzer] agent invocation errored", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});

export default agent;
