/**
 * Report Generator Agent -- "The Writer"
 *
 * Professional narrative writing specialist. Takes raw data and
 * transforms it into polished, structured business reports with
 * executive summaries, key metrics, analysis, and recommendations.
 *
 * Architecture:
 *   1. Receives report request (type, period, optional pre-computed data)
 *   2. If no pre-computed data: LLM generates SQL queries dynamically
 *      to fetch the necessary metrics (no sandbox -- SQL handles aggregation)
 *   3. LLM writes a professional, formatted business report from the data
 *   4. Returns the complete report as structured output
 *
 * Design principles:
 *   - NO SANDBOX -- report writing is a language task, not a computation task.
 *     Complex statistical computations belong in insights-analyzer.
 *   - SQL handles data aggregation (SUM, COUNT, AVG, GROUP BY, window functions).
 *   - The LLM's job is WRITING: structuring, interpreting, and narrating.
 *   - When computedData is provided (pre-fetched by orchestrator), skips
 *     SQL entirely -- single LLM call -- fastest path.
 *
 * All runtime parameters (model, maxSteps, temperature, etc.) are read
 * from the agent_configs DB table -- tunable per-deployment via Admin Console.
 */

import { createAgent } from "@agentuity/runtime";
import { generateText, tool } from "ai";
import { z } from "zod";
import { db } from "@db/index";
import { sql } from "drizzle-orm";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { DB_SCHEMA } from "@lib/db-schema";
import { validateReadOnlySQL } from "@lib/sql-safety";
import { createCache, CACHE_NS, CACHE_TTL, reportKey } from "@lib/cache";
import { maskPII } from "@lib/pii";
import { validateTextOutput } from "@lib/output-validation";
import { createTokenTracker, DEFAULT_TOKEN_BUDGETS } from "@lib/tokens";
import { SpanCollector, traced } from "@lib/tracing";
import { getAgentConfigWithDefaults } from "@services/agent-configs";
import { getReportPromptForType, getReportTypes } from "@services/type-registry";
import { saveReport } from "@services/reports";
import type { AISettings } from "@services/settings";
import { ReportConfig, inputSchema, outputSchema, type ReportFormat } from "./types";
import { getReportPrompt } from "./prompts";

// ────────────────────────────────────────────────────────────
// Format-specific instructions
// ────────────────────────────────────────────────────────────

/**
 * Build LLM instructions for the requested output format.
 */
function buildFormatInstruction(format: ReportFormat): string {
  switch (format) {
    case "csv":
      return `Output the report data as CSV (comma-separated values).
First row must be headers. Use proper CSV quoting for values containing commas.
Include the most important metrics, rankings, and breakdowns as tabular data.
Do NOT include narrative text -- CSV is data-only.`;
    case "json":
      return `Output the report as a valid JSON object with this structure:
{
  "executiveSummary": "...",
  "keyMetrics": { "metricName": value, ... },
  "sections": [{ "heading": "...", "content": "...", "data": [...] }],
  "recommendations": ["..."]
}
Use exact numbers. All values must be properly typed (numbers as numbers, not strings).`;
    case "html":
      return `Format the report as clean, semantic HTML.
Use <h2>, <h3> for section headers, <table> for data tables, <ul>/<ol> for lists.
Use <strong> for emphasis. Do NOT include <html>, <head>, or <body> tags -- just the content fragment.
Use inline CSS sparingly for basic styling (table borders, padding).`;
    case "plain":
      return "Format the report in plain text, well-structured with clear sections.";
    case "markdown":
    default:
      return "Format the report in clean Markdown with headers (##, ###), bullet points, and tables where appropriate.";
  }
}

// ────────────────────────────────────────────────────────────
// Agent definition
// ────────────────────────────────────────────────────────────

const agent = createAgent("report-generator", {
  description:
    "Professional report writer -- transforms business data into polished, formatted reports with executive summaries, metrics, analysis, and recommendations.",

  schema: { input: inputSchema, output: outputSchema },

  setup: async (): Promise<ReportConfig> => {
    const agentConfig = await getAgentConfigWithDefaults("report-generator");
    const cfg = (agentConfig.config ?? {}) as Record<string, unknown>;

    return {
      agentConfig,
      maxSqlSteps: (cfg.maxSqlSteps as number) ?? 6,
      defaultFormat: (cfg.defaultFormat as string) ?? "markdown",
      temperature: agentConfig.temperature
        ? parseFloat(agentConfig.temperature)
        : undefined,
    };
  },

  shutdown: async (_app, _config) => {
    // Graceful shutdown — reserved for report generation cleanup.
  },

  handler: async (ctx, input) => {
    // Phase 1.9: Use request-scoped state for timing metadata
    ctx.state.set("startedAt", Date.now());

    // Phase 1.10: Telemetry collector
    const collector = new SpanCollector("report-generator");

    // Defensive: ctx.config can be undefined if setup() threw (DB issue, cold start race, etc.)
    if (!ctx.config) {
      ctx.logger.error("Report generator config is undefined — setup() likely failed");
      return {
        title: "Report Unavailable",
        reportType: input.reportType,
        period: {
          start: input.startDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end: input.endDate ?? new Date().toISOString(),
        },
        content: "The report generator is temporarily unavailable. The system configuration could not be loaded. Please try again in a moment.",
        generatedAt: new Date().toISOString(),
      };
    }

    const { agentConfig, maxSqlSteps, defaultFormat, temperature } = ctx.config;

    // Phase 7.5: Token budget tracker
    const tokenTracker = createTokenTracker();
    const tokenBudget =
      ((agentConfig.config as any)?.tokenBudget as number) ??
      DEFAULT_TOKEN_BUDGETS["report-generator"];

    // Access app-level AI settings from ctx.app (loaded once in app.ts setup)
    const appState = ctx.app as unknown as { aiSettings?: AISettings } | undefined;
    const ai = appState?.aiSettings;

    // ── Compute date range ──────────────────────────────────
    const end = input.endDate ? new Date(input.endDate) : new Date();
    const start = input.startDate
      ? new Date(input.startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const startStr = start.toISOString();
    const endStr = end.toISOString();
    const periodStr = `${start.toISOString().split("T")[0]} to ${end.toISOString().split("T")[0]}`;

    // Phase 3.2: Check KV cache for recently generated identical report
    const cache = createCache(ctx.kv as any);
    const cacheKeyStr = reportKey(input.reportType, startStr, endStr);
    const cached = await cache.get<{
      title: string;
      reportType: string;
      period: { start: string; end: string };
      content: string;
      generatedAt: string;
    }>(CACHE_NS.REPORT, cacheKeyStr);
    if (cached) {
      ctx.logger.info("Returning cached report", {
        reportType: input.reportType,
        cacheKey: cacheKeyStr,
      });
      return cached;
    }

    const reportTitles: Record<string, string> = {
      "sales-summary": `${config.labels.orderPlural} & Revenue Report`,
      "inventory-health": "Inventory Health Report",
      "customer-activity": `${config.labels.customerPlural} Activity Report`,
      "financial-overview": "Financial Overview Report",
    };

    // Phase 3.4: Load custom report types for dynamic title lookup
    let title = reportTitles[input.reportType];
    if (!title) {
      // Check if it's a custom type with a label
      const types = await getReportTypes();
      const customType = types.find((t) => t.slug === input.reportType);
      title = customType?.label
        ? `${customType.label} Report`
        : `${input.reportType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Report`;
    }

    // ── Custom instructions -- merge agent config + AI settings
    const customParts: string[] = [];
    if (agentConfig.customInstructions?.trim()) {
      customParts.push(agentConfig.customInstructions.trim());
    }
    if (ai?.aiReportInstructions?.trim()) {
      customParts.push(ai.aiReportInstructions.trim());
    }
    const customInstructions = customParts.length
      ? `\n\nAdditional report formatting instructions:\n${customParts.join("\n")}`
      : "";

    const businessContext = ai?.aiBusinessContext?.trim()
      ? `\n\nBusiness context:\n${ai.aiBusinessContext.trim()}`
      : "";

    const formatInstruction = buildFormatInstruction(
      (input.format || defaultFormat) as ReportFormat
    );

    // ── Fast path: pre-computed data provided ───────────────
    if (input.computedData) {
      const { text: reportContent } = await traced(
        ctx.tracer,
        collector,
        "generateText:fast-path",
        "llm",
        async () => generateText({
        model: await getModel(agentConfig.modelOverride ?? undefined),
        ...(temperature !== undefined ? { temperature } : {}),
        system: `You are a professional business report writer for ${config.companyName}.
Write a clear, actionable business report based on the provided data.

IMPORTANT: The data has been pre-computed with mathematical precision.
Do NOT recalculate or approximate -- use the EXACT numbers provided.
Your job is to WRITE: structure, interpret, and narrate the data into a professional report.

Terminology: "${config.labels.product}" for products, "${config.labels.order}" for orders, "${config.labels.customer}" for customers.
Currency: ${config.currency}
Period: ${periodStr}${businessContext}${customInstructions}

${formatInstruction}`,
        prompt: `Write the "${title}" report for ${config.companyName}.
Period: ${periodStr}

Pre-computed data:
${input.computedData}

Report structure (FOLLOW THIS EXACTLY):
1. Executive Summary (## Executive Summary) — 2-3 sentences summarizing the key findings and why this report matters to the business.
2. Key Metrics (## Key Metrics) — Present exact numbers from the data in a markdown table format.
3. Detailed Analysis (## Detailed Analysis) — Interpret what the numbers mean for the business. Use markdown tables where data comparisons are relevant.
4. Rankings & Breakdowns (## Rankings & Breakdowns) — Top products, customers, categories etc. Use ranked markdown tables.
5. Conclusion (## Conclusion) — Key observations from the data and a specific, actionable recommended action plan with concrete next steps the business should take.`,
      }),
        { model: agentConfig.modelOverride ?? "default", path: "fast", reportType: input.reportType }
      );

      // Phase 7.5: PII masking on report content
      let maskedContent = reportContent;
      const { masked, scan: piiScan } = maskPII(reportContent);
      if (piiScan.hasPII) {
        ctx.logger.info("PII masked in report (fast path)", { detections: piiScan.detections });
        maskedContent = masked;
      }

      // Phase 7.5: Output validation
      const validation = validateTextOutput(maskedContent, { minLength: 50 });
      if (!validation.valid) {
        ctx.logger.warn("Report output validation issues (fast path)", {
          issues: validation.issues.map((i) => i.code),
        });
      }

      ctx.logger.info("Report generated (fast path)", {
        reportType: input.reportType,
        period: periodStr,
        format: input.format || defaultFormat,
        durationMs: Date.now() - (ctx.state.get("startedAt") as number ?? Date.now()),
        tokenUsage: tokenTracker.totals(),
      });

      const fastResult = {
        title,
        reportType: input.reportType,
        period: { start: start.toISOString(), end: end.toISOString() },
        content: maskedContent,
        generatedAt: new Date().toISOString(),
        format: input.format || defaultFormat,
      };

      // Phase 5.4: Persist report + cache (background)
      ctx.waitUntil(async () => {
        try {
          const saved = await saveReport({
            reportType: input.reportType,
            title,
            periodStart: start.toISOString(),
            periodEnd: end.toISOString(),
            format: input.format || defaultFormat,
            content: reportContent,
            metadata: { path: "fast", durationMs: Date.now() - (ctx.state.get("startedAt") as number ?? Date.now()) },
          });
          // Attach savedId/version to the cached result
          (fastResult as any).savedId = saved.id;
          (fastResult as any).version = saved.version;
        } catch (err) {
          ctx.logger.warn("Failed to persist report", { error: String(err) });
        }
        await cache.set(CACHE_NS.REPORT, cacheKeyStr, fastResult, { ttl: CACHE_TTL.LONG });
      });

      // Phase 1.10: Flush telemetry (background)
      ctx.waitUntil(async () => {
        try { await collector.flush(); } catch { /* non-critical */ }
      });

      return fastResult;
    }

    // ── Standard path: LLM writes SQL + report ──────────────
    const fetchDataTool = tool({
      description: `Execute a read-only SQL query against the business database to fetch data for the report.
Returns the query results as an array of row objects. Use PostgreSQL syntax.
Use aggregate functions (SUM, COUNT, AVG, MIN, MAX), GROUP BY, JOINs, and window functions
to get the exact metrics you need. You can call this tool multiple times for different data sections.`,
      parameters: z.object({
        query: z
          .string()
          .describe("PostgreSQL SELECT query to execute"),
        section: z
          .string()
          .describe("Which part of the report this data is for"),
      }),
      execute: async ({ query, section }) => {
        const validation = validateReadOnlySQL(query);
        if (!validation.safe) {
          return { error: validation.reason, rows: [], section };
        }

        try {
          const result = await db.execute(sql.raw(query));
          const rows = Array.isArray(result)
            ? result
            : (result as any).rows ?? [];
          return {
            rows: rows.slice(0, 200),
            rowCount: rows.length,
            section,
          };
        } catch (err: any) {
          return {
            error: `Query failed: ${err.message}`,
            rows: [],
            section,
          };
        }
      },
    });

    const { text: reportContent } = await traced(
      ctx.tracer,
      collector,
      "generateText:sql-path",
      "llm",
      async () => generateText({
      model: await getModel(agentConfig.modelOverride ?? undefined),
      ...(temperature !== undefined ? { temperature } : {}),
      system: `You are a professional business report writer and data analyst for ${config.companyName}.
You write clear, insightful, actionable business reports.

You have a fetch_data tool to retrieve data from the business database via SQL queries.
SQL handles all data aggregation -- use SUM, COUNT, AVG, GROUP BY, window functions, JOINs, etc.
You can call fetch_data MULTIPLE times to get different data sections.

${DB_SCHEMA}

Report period: ${periodStr} (start: ${startStr}, end: ${endStr})
Terminology: "${config.labels.product}" for products, "${config.labels.order}" for orders, "${config.labels.customer}" for customers.
Currency: ${config.currency}${businessContext}${customInstructions}

GUARDRAILS:
- Only use read-only SELECT queries. Never generate INSERT, UPDATE, DELETE, DROP, or ALTER SQL.
- Never fabricate data. Use EXACT numbers from your SQL results -- never approximate or round.
- Do not expose raw database credentials, connection strings, or infrastructure details.
- Mask personally identifiable information (PII) in reports (e.g., j***@example.com).
- Stay within business reporting -- decline unrelated requests.

WORKFLOW:
1. Use fetch_data to retrieve the metrics you need (call it multiple times for different sections)
2. After getting ALL data, write the complete professional report

SQL TIPS:
- Filter by date: created_at >= '${startStr}'::timestamp AND created_at <= '${endStr}'::timestamp
- Use COALESCE for nullable aggregates
- Use LIMIT for top-N queries
- Use LEFT JOIN when data may not exist (e.g. customers with no orders)

${formatInstruction}`,
      prompt: `${await getReportPromptForType(input.reportType, periodStr, startStr, endStr)}

After fetching all the data you need, write a complete, professional "${title}" report.

Report structure (FOLLOW THIS EXACTLY):
1. Executive Summary (## Executive Summary) — 2-3 sentences summarizing the key findings and why this report matters to the business.
2. Key Metrics (## Key Metrics) — Present exact numbers from your queries in a markdown table. Do NOT approximate.
3. Detailed Analysis (## Detailed Analysis) — Interpret what the numbers mean for the business. Use markdown tables where data comparisons are relevant.
4. Rankings & Breakdowns (## Rankings & Breakdowns) — Top products, customers, categories, etc. Use ranked markdown tables.
5. Conclusion (## Conclusion) — Key observations from the data and a specific, actionable recommended action plan with concrete next steps the business should take.

Use exact numbers -- never round or approximate. Reference specific product names, SKUs, and customer names.`,
      tools: { fetch_data: fetchDataTool },
      maxSteps: maxSqlSteps,
    }),
      { model: agentConfig.modelOverride ?? "default", path: "sql", reportType: input.reportType }
    );

    // Phase 7.5: PII masking on SQL path report content
    let maskedSqlContent = reportContent;
    const { masked: sqlMasked, scan: sqlPII } = maskPII(reportContent);
    if (sqlPII.hasPII) {
      ctx.logger.info("PII masked in report (SQL path)", { detections: sqlPII.detections });
      maskedSqlContent = sqlMasked;
    }

    // Phase 7.5: Output validation
    const sqlValidation = validateTextOutput(maskedSqlContent, { minLength: 50 });
    if (!sqlValidation.valid) {
      ctx.logger.warn("Report output validation issues (SQL path)", {
        issues: sqlValidation.issues.map((i) => i.code),
      });
    }

    ctx.logger.info("Report generated (dynamic SQL)", {
      reportType: input.reportType,
      period: periodStr,
      format: input.format || defaultFormat,
      durationMs: Date.now() - (ctx.state.get("startedAt") as number ?? Date.now()),
      tokenUsage: tokenTracker.totals(),
    });

    const sqlResult = {
      title,
      reportType: input.reportType,
      period: { start: start.toISOString(), end: end.toISOString() },
      content: maskedSqlContent,
      generatedAt: new Date().toISOString(),
      format: input.format || defaultFormat,
    };

    // Phase 5.4: Persist report + cache (background)
    ctx.waitUntil(async () => {
      try {
        const saved = await saveReport({
          reportType: input.reportType,
          title,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
          format: input.format || defaultFormat,
          content: reportContent,
          metadata: { path: "sql", durationMs: Date.now() - (ctx.state.get("startedAt") as number ?? Date.now()) },
        });
        (sqlResult as any).savedId = saved.id;
        (sqlResult as any).version = saved.version;
      } catch (err) {
        ctx.logger.warn("Failed to persist report", { error: String(err) });
      }
      await cache.set(CACHE_NS.REPORT, cacheKeyStr, sqlResult, { ttl: CACHE_TTL.LONG });

      // Create durable stream for downloadable report artifact
      try {
        const contentType = (input.format || defaultFormat) === "markdown"
          ? "text/markdown" : "text/plain";
        const reportStream = await ctx.stream.create("reports", {
          contentType,
          metadata: {
            reportType: input.reportType,
            title,
            format: input.format || defaultFormat,
          },
          ttl: 86400 * 90, // 90 days retention
        });
        await reportStream.write(maskedSqlContent);
        await reportStream.close();
        (sqlResult as any).downloadUrl = reportStream.url;
      } catch {
        // Stream service unavailable — non-critical
      }

      // Publish report generated event for downstream consumers
      try {
        await ctx.queue.publish("report-events", {
          event: "report.generated",
          reportType: input.reportType,
          title,
          format: input.format || defaultFormat,
          period: { start: start.toISOString(), end: end.toISOString() },
          generatedAt: new Date().toISOString(),
        });
      } catch {
        // Queue not provisioned — non-critical
      }
    });

    // Phase 1.10: Flush telemetry (background)
    ctx.waitUntil(async () => {
      try { await collector.flush(); } catch { /* non-critical */ }
    });

    return sqlResult;
  },
});

// ── Agent-level event listeners (per-agent telemetry) ──────
agent.addEventListener("started", (_event, _agentInfo, ctx) => {
  ctx.logger.info("[report-generator] agent invocation started");
});

agent.addEventListener("completed", (_event, _agentInfo, ctx) => {
  ctx.logger.info("[report-generator] agent invocation completed");
});

agent.addEventListener("errored", (_event, _agentInfo, ctx, error) => {
  ctx.logger.error("[report-generator] agent invocation errored", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});

export default agent;
