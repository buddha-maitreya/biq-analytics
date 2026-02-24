/**
 * Insights Analyzer Agent -- "The Analyst"
 *
 * Computational intelligence specialist. Uses the Agentuity sandbox
 * to execute dynamically-generated Python code for statistical
 * analysis that goes BEYOND what SQL can express: z-scores, moving
 * averages, trend projections, anomaly scoring, demand forecasting,
 * pareto analysis, cohort comparisons, etc.
 *
 * Architecture (single-pass, LLM-generated code):
 *   1. LLM receives the analysis request, database schema, and output format
 *   2. LLM WRITES its own SQL query to fetch relevant data
 *   3. LLM WRITES Python code using numpy/pandas/scipy/sklearn/statsmodels
 *      to perform statistical analysis (code MUST include confidence metrics)
 *   4. Sandbox executes the LLM-generated code in isolated runtime
 *   5. LLM returns structured JSON insights directly (no separate formatting step)
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
import { generateText, tool } from "ai";
import { z } from "zod";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { DB_SCHEMA_ANALYTICS } from "@lib/db-schema";
import { executeSandbox } from "@lib/sandbox";
import type { SandboxRuntime } from "@lib/sandbox";
import { createCache, CACHE_NS, CACHE_TTL, analysisKey } from "@lib/cache";
import { maskPII } from "@lib/pii";
import { validateTextOutput } from "@lib/output-validation";
import { createTokenTracker, DEFAULT_TOKEN_BUDGETS } from "@lib/tokens";
import { SpanCollector, traced, extractToolInvocations } from "@lib/tracing";
import { getAnalysisPromptForType } from "@services/type-registry";
import type { AISettings } from "@services/settings";
import {
  InsightsConfig,
  inputSchema,
  outputSchema,
  type InsightItem,
} from "./types";
import { getAnalysisPrompt, parseInsightsFromText } from "./prompts";
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
      sandboxSnapshotId: undefined,
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
    const sandboxDeps = cfgJson.sandboxDeps as string[] | undefined;
    const sandboxMemory = (cfgJson.sandboxMemoryMb as number)
      ? `${cfgJson.sandboxMemoryMb}MB`
      : undefined;

    // Access app-level AI settings from ctx.app (loaded once in app.ts setup)
    const appState = ctx.app as unknown as { aiSettings?: AISettings } | undefined;
    const ai = appState?.aiSettings;

    // ── Build the sandbox tool (closes over ctx.sandbox) ────
    const effectiveRuntime = (sandboxRuntime as SandboxRuntime) ?? "python:3.14";
    const hasPython = effectiveRuntime.startsWith("python");
    const hasSnapshot = !!sandboxSnapshotId;

    /** Truncate tool results to prevent context bloat across multi-step calls.
     *  Keeps the structure but limits serialized JSON to ~4000 chars. */
    function truncateToolResult(obj: Record<string, unknown>): Record<string, unknown> {
      const json = JSON.stringify(obj);
      if (json.length <= 4000) return obj;
      // Keep _confidence, error fields, and summary — truncate large data
      const slim: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "_confidence" || k === "error" || k === "errorType" || k === "errorHint" ||
            k === "stderr" || k === "explanation" || k === "dataRowCount") {
          slim[k] = v;
        } else if (typeof v === "string" && v.length > 500) {
          slim[k] = v.slice(0, 500) + "… [truncated]";
        } else if (Array.isArray(v) && v.length > 20) {
          slim[k] = [...v.slice(0, 20), `… and ${v.length - 20} more items`];
        } else if (typeof v === "object" && v !== null) {
          const childJson = JSON.stringify(v);
          if (childJson.length > 2000) {
            slim[k] = JSON.parse(childJson.slice(0, 2000) + '"}');
          } else {
            slim[k] = v;
          }
        } else {
          slim[k] = v;
        }
      }
      return slim;
    }

    const runAnalysisTool = tool({
      description: `Execute analysis: SQL query fetches data → Python code analyzes it in a sandbox.
DATA = list of dicts (SQL rows). DF = pandas DataFrame. Pre-imported: numpy (np), pandas (pd), scipy.stats, sklearn, statsmodels.
MUST return a dict with results. Include _confidence metrics. Sandbox has no network, ${sandboxTimeoutMs / 1000}s timeout.
On errors: check errorType/errorHint and retry with fixed code.`,
      parameters: z.object({
        sqlQuery: z
          .string()
          .describe(
            "PostgreSQL SELECT query to fetch the data needed for analysis"
          ),
        code: z
          .string()
          .describe(
            `${effectiveRuntime.startsWith("python") ? "Python" : "JavaScript"} code to analyze the data. DATA is a list of dicts (SQL rows)${effectiveRuntime.startsWith("python") ? ". DF is a pandas DataFrame of the same data" : ""}. Must RETURN a result.`
          ),
        explanation: z
          .string()
          .describe("What this analysis step does"),
      }),
      execute: async ({ sqlQuery, code, explanation }) => {
        const result = await executeSandbox(ctx.sandbox, {
          code,
          sqlQuery,
          explanation,
          timeoutMs: sandboxTimeoutMs,
          runtime: effectiveRuntime,
          snapshotId: sandboxSnapshotId,
          dependencies: sandboxDeps,
          memory: sandboxMemory,
        });

        if (!result.success) {
          return truncateToolResult({
            error: result.error,
            errorType: result.errorType,
            errorHint: result.errorHint,
            stderr: result.stderr,
            explanation,
          });
        }

        return truncateToolResult({
          result: result.result,
          dataRowCount: result.dataRowCount,
          explanation,
        });
      },
    });

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

    let rawResponse = "";
    let steps: any[] = [];

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
          system: `You are a data scientist for ${config.companyName}. You analyze business data using Python in a sandbox.

${DB_SCHEMA_ANALYTICS}

Currency: ${config.currency}. Products="${config.labels.product}", Orders="${config.labels.order}", Customers="${config.labels.customer}".${businessContext}${customInstructions}

TOOL USAGE:
- Call run_analysis with a SQL query + Python code. You may call it multiple times.
- DATA = list of dicts from SQL. DF = pandas DataFrame (dates auto-parsed).
- Available: numpy (np), pandas (pd), scipy.stats, sklearn, statsmodels.
- Use pandas vectorized ops (groupby, rolling, pct_change). Check for empty data first.
- On errors: read errorType/errorHint, fix code, retry (max ${maxSteps} calls).
- Only SELECT queries allowed. No INSERT/UPDATE/DELETE/DROP.

CONFIDENCE: Your code MUST return _confidence in its result dict:
\`\`\`python
return { ..., "_confidence": { "sampleSize": len(DATA), "completeness": ratio, "timeSpanDays": days } }
\`\`\`

OUTPUT: After analysis, respond with ONLY this JSON:
\`\`\`json
{ "insights": [{ "title": "...", "severity": "info|warning|critical", "description": "...", "recommendation": "...", "affectedItems": [...], "dataPoints": {...} }], "summary": "..." }
\`\`\`
No confidence field in insights (computed from _confidence). Never fabricate data.`,
          prompt: `${await getAnalysisPromptForType(input.analysis, input.timeframeDays)}

${input.productId ? `Focus on product ID: ${input.productId}` : "Analyze all active products."}

Output structured JSON insights after running your analysis.`,
          tools: { run_analysis: runAnalysisTool },
          maxSteps,
        }),
          { model: modelName, analysis: input.analysis }
        );

        rawResponse = result.text;
        steps = result.steps;
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

    if (lastError) {
      throw lastError;
    }

    // Phase 7.5: Token budget tracking
    const tokenTracker = createTokenTracker();
    const tokenBudget =
      ((agentConfig.config as any)?.tokenBudget as number) ??
      DEFAULT_TOKEN_BUDGETS["insights-analyzer"];
    if ((steps as any).usage) {
      tokenTracker.add(
        (steps as any).usage.promptTokens,
        (steps as any).usage.completionTokens
      );
    }
    // Also accumulate from individual steps
    for (const step of steps) {
      if ((step as any).usage) {
        tokenTracker.add(
          (step as any).usage.promptTokens ?? 0,
          (step as any).usage.completionTokens ?? 0
        );
      }
    }

    // ── Extract confidence metrics from tool results ────────
    const toolResults = steps
      .flatMap((s) => s.toolResults || [])
      .map((tr: any) => tr.result)
      .filter(Boolean);

    // Aggregate _confidence from all sandbox runs
    const confidenceMetrics = toolResults
      .map((r: any) => r?._confidence ?? r?.result?._confidence)
      .filter(Boolean);

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

    const computedConfidence = computeConfidence(confidenceMetrics);

    // ── Parse structured JSON from the LLM response ─────────
    let parsed: { insights: InsightItem[]; summary: string };
    try {
      // Extract JSON block from the response (supports ```json fences)
      const jsonMatch = rawResponse.match(
        /```json\s*([\s\S]*?)```|(\{[\s\S]*"insights"[\s\S]*\})/
      );
      const jsonStr = jsonMatch?.[1]?.trim() || jsonMatch?.[2]?.trim();
      if (jsonStr) {
        const obj = JSON.parse(jsonStr);
        parsed = {
          insights: Array.isArray(obj.insights)
            ? obj.insights.map((ins: any) => ({
                ...ins,
                confidence: computedConfidence, // override with computed value
              }))
            : [],
          summary: obj.summary ?? rawResponse,
        };
      } else {
        const fallback = parseInsightsFromText(rawResponse);
        parsed = {
          insights: fallback.insights.map((ins: any) => ({
            ...ins,
            confidence: computedConfidence,
          })) as InsightItem[],
          summary: fallback.summary,
        };
      }
    } catch {
      const fallback = parseInsightsFromText(rawResponse);
      parsed = {
        insights: fallback.insights.map((ins: any) => ({
          ...ins,
          confidence: computedConfidence,
        })) as InsightItem[],
        summary: fallback.summary,
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
    };

    // Phase 3.2: Cache analysis result (15-minute TTL)
    ctx.waitUntil(async () => {
      await cache.set(CACHE_NS.ANALYSIS, cacheKeyStr, result, { ttl: CACHE_TTL.MEDIUM });
    });

    // Phase 1.10 + 2.2: Record tool invocations + flush telemetry (background)
    {
      const toolInvocations = extractToolInvocations(steps as any, "insights-analyzer");
      for (const inv of toolInvocations) {
        collector.addToolCall(inv);
      }
      ctx.waitUntil(async () => {
        try { await collector.flush(); } catch { /* non-critical */ }
      });
    }

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
