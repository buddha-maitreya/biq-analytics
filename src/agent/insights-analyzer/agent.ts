/**
 * Insights Analyzer Agent -- "The Analyst"
 *
 * Computational intelligence specialist. Uses the Agentuity sandbox
 * to execute dynamically-generated JavaScript code for statistical
 * analysis that goes BEYOND what SQL can express: z-scores, moving
 * averages, trend projections, anomaly scoring, demand forecasting,
 * pareto analysis, cohort comparisons, etc.
 *
 * Architecture (single-pass, LLM-generated code):
 *   1. LLM receives the analysis request, database schema, and output format
 *   2. LLM WRITES its own SQL query to fetch relevant data
 *   3. LLM WRITES JavaScript code to perform statistical analysis
 *      (code MUST include confidence metrics: sampleSize, stdDev, etc.)
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
import { DB_SCHEMA } from "@lib/db-schema";
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
    "Statistical analysis specialist -- runs LLM-generated JavaScript in a sandbox for demand forecasting, anomaly detection, restock recommendations, and sales trend analysis.",

  schema: { input: inputSchema, output: outputSchema },

  setup: async (): Promise<InsightsConfig> => {
    const agentConfig = await getAgentConfigWithDefaults("insights-analyzer");
    const cfg = (agentConfig.config ?? {}) as Record<string, unknown>;

    return {
      agentConfig,
      sandboxTimeoutMs: (cfg.sandboxTimeoutMs as number) ?? 30_000,
      structuringModel: (cfg.structuringModel as string) ?? "gpt-4o-mini",
      maxSteps: agentConfig.maxSteps ?? 5,
      temperature: agentConfig.temperature
        ? parseFloat(agentConfig.temperature)
        : undefined,
      sandboxSnapshotId: cfg.sandboxSnapshotId as string | undefined,
      sandboxRuntime: cfg.sandboxRuntime as string | undefined,
      sandboxDeps: cfg.sandboxDeps as string[] | undefined,
      sandboxMemory: (cfg.sandboxMemoryMb as number)
        ? `${cfg.sandboxMemoryMb}MB`
        : undefined,
    };
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

    const {
      agentConfig,
      sandboxTimeoutMs,
      maxSteps,
      temperature,
      sandboxSnapshotId,
      sandboxRuntime,
      sandboxDeps,
      sandboxMemory,
    } = ctx.config;

    // Access app-level AI settings from ctx.app (loaded once in app.ts setup)
    const ai = (ctx.app as unknown as { aiSettings: AISettings }).aiSettings;

    // ── Build the sandbox tool (closes over ctx.sandbox) ────
    const runtimeLabel = sandboxRuntime === "python" ? "Python 3"
      : sandboxRuntime === "node" ? "Node.js" : "Bun 1.x";
    const hasDeps = sandboxSnapshotId || sandboxDeps?.length;
    const depsNote = hasDeps
      ? `Available packages: ${sandboxDeps?.join(", ") ?? "pre-installed in snapshot (simple-statistics, date-fns, lodash)"}.`
      : "You have NO npm packages -- use built-in JS/Bun APIs only (Math, Date, Array methods, etc).";

    const runAnalysisTool = tool({
      description: `Execute a data analysis pipeline: run a SQL query to fetch data, then execute ${runtimeLabel} code in a sandboxed runtime to compute statistical results.
The SQL results become the DATA variable (array of row objects) in the code.
Your code MUST return a result object with the computed analysis.
${depsNote}
The sandbox has NO network access and a ${sandboxTimeoutMs / 1000}-second timeout.
If execution fails, you'll receive an errorType and errorHint -- use them to fix your code and try again.`,
      parameters: z.object({
        sqlQuery: z
          .string()
          .describe(
            "PostgreSQL SELECT query to fetch the data needed for analysis"
          ),
        code: z
          .string()
          .describe(
            "JavaScript code to analyze the data. DATA is the array of SQL result rows. Must RETURN a result object."
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
          runtime: (sandboxRuntime as SandboxRuntime) ?? "bun:1",
          snapshotId: sandboxSnapshotId,
          dependencies: sandboxDeps,
          memory: sandboxMemory,
        });

        if (!result.success) {
          return {
            error: result.error,
            errorType: result.errorType,
            errorHint: result.errorHint,
            stderr: result.stderr,
            explanation,
          };
        }

        return {
          result: result.result,
          dataRowCount: result.dataRowCount,
          explanation,
        };
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
    const { text: rawResponse, steps } = await traced(
      ctx.tracer,
      collector,
      "generateText",
      "llm",
      async () => generateText({
      model: await getModel(agentConfig.modelOverride ?? undefined),
      ...(temperature !== undefined ? { temperature } : {}),
      system: `You are an expert data scientist and business analyst for ${config.companyName}.
You have access to a tool that lets you:
1. Write a SQL query to fetch data from the business database
2. Write ${runtimeLabel} code to perform statistical analysis on that data
3. The code runs in an isolated sandbox (${depsNote.replace(/\.$/, "")}, no network)

${DB_SCHEMA}

Terminology: Products are "${config.labels.product}" (plural: "${config.labels.productPlural}"), orders are "${config.labels.order}", customers are "${config.labels.customer}".
Currency: ${config.currency}${businessContext}${customInstructions}

WORKFLOW:
1. Use the run_analysis tool to fetch data and compute statistics. You may call it MULTIPLE times if needed (e.g., first fetch and analyze sales data, then fetch and analyze inventory data).
2. After getting all computed results, provide your analysis as STRUCTURED JSON (see OUTPUT FORMAT below).

ERROR HANDLING:
- If the tool returns an error, check the errorType and errorHint fields
- For "syntax" errors: fix brackets, semicolons, or typos in your code
- For "runtime" errors: check for null/undefined access, wrong types, or undefined variables
- For "import" errors: remove the unavailable import and use built-in APIs instead
- For "timeout" errors: simplify the algorithm or reduce data scope via SQL aggregation
- You may retry the tool with corrected code (up to ${maxSteps} total tool calls)

IMPORTANT for your code:
- DATA is the array of SQL result row objects
- You MUST return a result object (use \`return { ... }\`)
- Handle edge cases: empty arrays, zero denominators, null values
- Convert numeric strings with Number()

CONFIDENCE SCORING (computation-based):
Your sandbox code MUST include confidence metrics in its return object:
\`\`\`
return {
  // ... your analysis results ...
  _confidence: {
    sampleSize: DATA.length,                    // rows analyzed
    completeness: nonNullCount / totalFields,    // data completeness ratio (0-1)
    stdDev: calculatedStdDev,                    // standard deviation (if applicable)
    coefficientOfVariation: stdDev / mean,       // CV for dispersion (if applicable)
    pValue: calculatedPValue,                    // significance (if applicable)
    timeSpanDays: actualDaysWithData,            // actual days with data points
    requestedDays: ${"{timeframeDays}"},         // requested timeframe
  }
}
\`\`\`
Include whichever metrics apply to your analysis. These will be used to compute
insight confidence scores automatically -- do NOT guess confidence values.

OUTPUT FORMAT:
After completing your analysis, respond with ONLY a JSON block (no other text):
\`\`\`json
{
  "insights": [
    {
      "title": "Concise headline",
      "severity": "info|warning|critical",
      "description": "Plain-English explanation",
      "recommendation": "Specific, actionable next step",
      "affectedItems": ["Product A", "SKU-123"],
      "dataPoints": { "metric1": 42, "metric2": 3.14 }
    }
  ],
  "summary": "Executive summary paragraph"
}
\`\`\`

Do NOT include a "confidence" field in insights -- it will be computed from the sandbox _confidence metrics.
Severity guide: info = noteworthy, warning = needs attention soon, critical = urgent action required.

GUARDRAILS:
- Never fabricate data points or statistics. Every number must come from your sandbox computation.
- Only use read-only SELECT queries. Never generate INSERT, UPDATE, DELETE, DROP, or ALTER SQL.
- Do not expose raw database credentials, connection strings, or infrastructure details.
- Mask personally identifiable information (PII) in outputs (e.g., j***@example.com).
- Stay within scientific and statistical analysis -- decline requests unrelated to business data.`,
      prompt: `${await getAnalysisPromptForType(input.analysis, input.timeframeDays)}

${input.productId ? `Focus on product ID: ${input.productId}` : "Analyze all active products."}

After running your analysis with the tool, output your structured JSON insights as specified in the OUTPUT FORMAT.`,
      tools: { run_analysis: runAnalysisTool },
      maxSteps,
    }),
      { model: agentConfig.modelOverride ?? "default", analysis: input.analysis }
    );

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

export default agent;
