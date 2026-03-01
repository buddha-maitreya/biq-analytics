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
import { dbRows, sanitizeRows } from "@db/rows";
import { sql } from "drizzle-orm";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { DB_SCHEMA_ANALYTICS } from "@lib/db-schema";
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
import { getAllSettings } from "@services/settings";
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
    // Static defaults only — no DB calls, cannot fail or timeout.
    // Live config is loaded per-request in the handler via
    // getAgentConfigWithDefaults() (60s memory cache, infallible
    // fallback to AGENT_DEFAULTS if DB is unreachable).
    return {
      agentConfig: {
        id: "",
        agentName: "report-generator",
        displayName: "The Writer",
        description: "Professional report writer",
        isActive: true,
        modelOverride: null,
        temperature: null,
        maxSteps: 6,
        timeoutMs: 30000,
        customInstructions: null,
        executionPriority: 2,
        config: { defaultFormat: "markdown", maxSqlSteps: 6 },
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      maxSqlSteps: 6,
      defaultFormat: "markdown",
      temperature: undefined,
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

    // ── Load live agent config (infallible — 60s cache, AGENT_DEFAULTS fallback) ──
    const agentConfig = await getAgentConfigWithDefaults("report-generator");
    const cfgJson = (agentConfig.config ?? {}) as Record<string, unknown>;
    const maxSqlSteps = (cfgJson.maxSqlSteps as number) ?? 6;
    const defaultFormat = (cfgJson.defaultFormat as string) ?? "markdown";
    const temperature = agentConfig.temperature
      ? parseFloat(agentConfig.temperature)
      : undefined;

    // Phase 7.5: Token budget tracker
    const tokenTracker = createTokenTracker();
    const tokenBudget =
      ((agentConfig.config as any)?.tokenBudget as number) ??
      DEFAULT_TOKEN_BUDGETS["report-generator"];

    // Access app-level AI settings from ctx.app (loaded once in app.ts setup)
    const appState = ctx.app as unknown as { aiSettings?: AISettings } | undefined;
    const ai = appState?.aiSettings;

    // ── Resolve company name from DB settings (consistent with report exports) ──
    let companyName = config.companyName; // Fallback to env var
    try {
      const dbSettings = await getAllSettings();
      if (dbSettings.businessName) {
        companyName = dbSettings.businessName;
      }
    } catch {
      // DB unavailable — use env var fallback
    }

    // ── Load report settings (layout, limits, chart config) ──
    let reportSettings: import("@services/settings").ReportSettings;
    try {
      const { getReportSettings } = await import("@services/settings");
      reportSettings = await getReportSettings();
    } catch {
      reportSettings = {
        titlePage: true, tocPage: true, execSummaryMaxWords: 200,
        maxPages: 20, maxWords: 5000, referencesPage: true,
        chartsEnabled: true, maxChartDataPoints: 50,
        confidentialFooter: true, maxCharts: 4,
      };
    }

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

    // ── Chart generation instructions (conditional on report settings) ──
    const chartInstruction = reportSettings.chartsEnabled ? `
CHARTS -- Visual Data Representation:
When writing reports, include chart specifications for key data visualizations.
Place each chart as a fenced code block with the language "chart" containing a JSON object.

Chart JSON schema:
{
  "type": "bar" | "line" | "area" | "pie" | "donut" | "scatter" | "grouped_bar" | "stacked_bar" | "heatmap",
  "title": "Chart Title",
  "data": [{"category": "A", "value": 100}, {"category": "B", "value": 200}],
  "xField": "category",
  "yField": "value",
  "colorField": "optional_grouping_field",
  "xLabel": "X Axis Label",
  "yLabel": "Y Axis Label"
}

RULES for charts:
- Include ${Math.min(reportSettings.maxCharts, 4)} charts per report (not more).
- Place each chart immediately after the related analysis section.
- Use REAL data from the report — never fabricate chart data.
- Choose chart types that best represent the data:
  • bar/grouped_bar: comparing categories (product revenue, customer spend)
  • line/area: trends over time (daily/weekly revenue, order volume)
  • pie/donut: proportional breakdowns (category share, payment methods)
  • scatter: correlations (price vs quantity)
- Keep chart data arrays concise (max ${reportSettings.maxChartDataPoints} data points per chart).
- The "data" array must be an array of objects with consistent keys matching xField/yField.

Example (place this in your report where appropriate):
\`\`\`chart
{"type":"bar","title":"Top 5 Products by Revenue","data":[{"product":"Widget A","revenue":12500},{"product":"Widget B","revenue":9800},{"product":"Widget C","revenue":7200},{"product":"Widget D","revenue":5100},{"product":"Widget E","revenue":3400}],"xField":"product","yField":"revenue","xLabel":"Product","yLabel":"Revenue"}
\`\`\`
` : "\nDo NOT include any chart blocks in the report.\n";

    // ── Report structure instructions (driven by settings) ──
    const reportLimits = `
REPORT LENGTH CONSTRAINTS:
- Executive Summary: approximately ${reportSettings.execSummaryMaxWords} words (concise overview with key findings, period, and business impact)
- Total report: approximately ${reportSettings.maxWords} words maximum (prose only — chart code blocks do NOT count toward this limit)
- Target: ${reportSettings.maxPages} pages when exported to PDF

CRITICAL FORMATTING RULES:
- Do NOT include a title heading (# Title) — the PDF template renders its own title page.
- Do NOT include "Prepared for:", "Date:", or "---" lines — these are handled by the export template.
- Start your output directly with ## Executive Summary.
`;

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
        system: `You are a professional business report writer for ${companyName}.
Write a clear, actionable business report based on the provided data.

IMPORTANT: The data has been pre-computed with mathematical precision.
Do NOT recalculate or approximate -- use the EXACT numbers provided.
Your job is to WRITE: structure, interpret, and narrate the data into a professional report.

CRITICAL -- NO PLACEHOLDERS:
NEVER use placeholder text like [Company Name], [Business Name], [Date], [Generation Date], [Your Name], etc.
The company name is "${companyName}" -- use it directly.
Today's date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} -- use it directly.
Always use REAL values, never bracketed placeholder tokens.

Terminology: "${config.labels.product}" for products, "${config.labels.order}" for orders, "${config.labels.customer}" for customers.
Currency: ${config.currency}
Period: ${periodStr}${businessContext}${customInstructions}

${formatInstruction}

${reportLimits}

${chartInstruction}`,
        prompt: `Write the "${title}" report for ${companyName}.
Period: ${periodStr}

Pre-computed data:
${input.computedData}

Report structure (FOLLOW THIS EXACTLY — start directly with ## Executive Summary):
1. Executive Summary (## Executive Summary) — approximately ${reportSettings.execSummaryMaxWords} words summarizing the key findings, period under review (${periodStr}), and why this report matters to ${companyName}.
2. Key Metrics (## Key Metrics) — Present exact numbers from the data in a markdown table format.
3. Detailed Analysis (## Detailed Analysis) — Interpret what the numbers mean for the business. Use markdown tables where data comparisons are relevant.
4. Rankings & Breakdowns (## Rankings & Breakdowns) — Top products, customers, categories etc. Use ranked markdown tables.
5. Conclusion (## Conclusion) — Key observations from the data and a specific, actionable recommended action plan with concrete next steps the business should take.${reportSettings.referencesPage ? `
6. References (## References) — List the data sources used to compile this report. Include database tables queried, date ranges analyzed, and any computed metrics referenced. Format as a numbered list. Example:
   1. Orders database — ${periodStr}
   2. Product inventory records
   3. Customer transaction history` : ""}`,

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
          const rows = sanitizeRows(dbRows(result));
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
      system: `You are a professional business report writer and data analyst for ${companyName}.
You write clear, insightful, actionable business reports.

You have a fetch_data tool to retrieve data from the business database via SQL queries.
SQL handles all data aggregation -- use SUM, COUNT, AVG, GROUP BY, window functions, JOINs, etc.
You can call fetch_data MULTIPLE times to get different data sections.

${DB_SCHEMA_ANALYTICS}

Report period: ${periodStr} (start: ${startStr}, end: ${endStr})
Terminology: "${config.labels.product}" for products, "${config.labels.order}" for orders, "${config.labels.customer}" for customers.
Currency: ${config.currency}${businessContext}${customInstructions}

CRITICAL -- NO PLACEHOLDERS:
NEVER use placeholder text like [Company Name], [Business Name], [Date], [Generation Date], [Your Name], etc.
The company name is "${companyName}" -- use it directly.
Today's date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} -- use it directly.
Always use REAL values, never bracketed placeholder tokens.

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

${formatInstruction}

${reportLimits}

${chartInstruction}`,
      prompt: `${await getReportPromptForType(input.reportType, periodStr, startStr, endStr)}

After fetching all the data you need, write a complete, professional "${title}" report.
Start DIRECTLY with ## Executive Summary — do NOT include title headings, "Prepared for:", or "Date:" lines.

Report structure (FOLLOW THIS EXACTLY):
1. Executive Summary (## Executive Summary) — approximately ${reportSettings.execSummaryMaxWords} words summarizing the key findings, the period under review (${periodStr}), and why this report matters to ${companyName}.
2. Key Metrics (## Key Metrics) — Present exact numbers from your queries in a markdown table. Do NOT approximate.
3. Detailed Analysis (## Detailed Analysis) — Interpret what the numbers mean for the business. Use markdown tables where data comparisons are relevant.
4. Rankings & Breakdowns (## Rankings & Breakdowns) — Top products, customers, categories, etc. Use ranked markdown tables.
5. Conclusion (## Conclusion) — Key observations from the data and a specific, actionable recommended action plan with concrete next steps the business should take.${reportSettings.referencesPage ? `
6. References (## References) — List ALL data sources used. Include the specific database tables queried, date ranges analyzed, number of records examined, and any SQL aggregations performed. Format as a numbered list. Example:
   1. orders table — 30 records, period ${periodStr}
   2. order_items table — joined for product-level breakdown
   3. products table — inventory and pricing data
   4. customers table — customer activity analysis` : ""}

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
