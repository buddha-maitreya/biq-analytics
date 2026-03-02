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
      return `Format the report in professional Markdown:
- Structure: ## for main section headings, ### for sub-sections inside each section
- Tables are MANDATORY in every Key Metrics section, every Rankings section, and any comparison of 3+ values
  Required columns for ranked tables: | Rank | Name | Value | % of Total | Change |
  Required columns for metrics tables: | Metric | Value | Prior Period | Change | Notes |
- Bold (**figure**) every key number when cited inline in narrative text
- Bullet points: only for grouped parallel observations — never a single standalone sentence
- Write in active voice with exact figures: never "revenue improved" — always "revenue rose ${config.currency} X (+Y%)"
- Every analytical paragraph must contain both: what the data shows AND what it means for the business
- Never write vague language: "significant", "notable", "strong performance" must always be followed by the exact number that justifies the claim`;
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
        config: { defaultFormat: "markdown", maxSqlSteps: 8 },
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
    // skipCache=true is passed by export_report's internal call to avoid
    // serving a stale chartless report that generate_report may have cached.
    const cache = createCache(ctx.kv as any);
    const cacheKeyStr = reportKey(input.reportType, startStr, endStr);
    if (!input.skipCache) {
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
    } else {
      ctx.logger.info("Cache bypassed (skipCache=true)", {
        reportType: input.reportType,
        cacheKey: cacheKeyStr,
      });
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
⚠️ MANDATORY CHARTS — YOU MUST INCLUDE EXACTLY ${Math.min(reportSettings.maxCharts, 4)} CHART BLOCKS ⚠️
Charts are NOT optional. A report submitted without chart blocks is INCOMPLETE.
Chart JSON blocks are EXCLUDED from the ${reportSettings.maxWords}-word prose limit — they DO NOT count toward the word budget.

Place each chart as a fenced code block with the language "chart" containing a JSON object:

\`\`\`chart
{"type":"bar","title":"Chart Title","data":[{"category":"A","value":100}],"xField":"category","yField":"value","xLabel":"X Label","yLabel":"Y Label"}
\`\`\`

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

CHART PLACEMENT RULES:
- Place each chart immediately after the section whose data it visualises.
- Use REAL numbers from your SQL query results — never invent chart data.
- Keep data arrays concise (max ${reportSettings.maxChartDataPoints} data points per chart).
- The "data" array must be an array of objects with consistent keys matching xField/yField.
- Choose the chart type that best fits the data:
  • bar/grouped_bar: comparing categories (product revenue, customer spend)
  • line/area: trends over time (daily/weekly revenue, order volume)
  • pie/donut: proportional breakdowns (category share, payment methods)
  • scatter: correlations (price vs quantity)

REMINDER: Charts are mandatory. Include all ${Math.min(reportSettings.maxCharts, 4)} chart blocks before finishing the report.
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
        system: `You are a senior business intelligence analyst at a top management consulting firm, producing board-level reports for ${companyName}. Your reports are used by executives to make decisions worth thousands of dollars — every sentence must earn its place.

QUALITY STANDARD — every report must meet ALL of these:
• SPECIFIC: Every claim backed by an exact figure. "Revenue: ${config.currency} 12,450" — not "strong revenue performance"
• COMPARATIVE: Show direction and magnitude wherever possible: "▲ +18% vs prior period", "lowest in the last 3 months"
• ANALYTICAL: Each section must explain BOTH what the data shows AND what it means for the business
• TABLE-RICH: Ranked tables must include Rank + Value + % of Total + Change columns. Do not summarise in prose what a table can show more clearly
• ACTIONABLE: Every recommendation must name a specific product, customer, or dollar threshold — not generic advice
• EXECUTIVE-READY: The executive summary alone must allow a CEO to act — first sentence states the #1 finding with a number

CRITICAL — NO PLACEHOLDERS:
NEVER use placeholder text like [Company Name], [Business Name], [Date], [Generation Date], [Your Name], etc.
The company name is "${companyName}" — use it directly.
Today's date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} — use it directly.
Always use REAL values, never bracketed placeholder tokens.

The data has been pre-computed with mathematical precision. Do NOT recalculate or approximate — use the EXACT numbers provided. Your job is to WRITE: structure, interpret, and narrate the data into a decision-ready report.

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

REPORT STRUCTURE — follow exactly, start directly with ## Executive Summary (no title line, no "Prepared for:" line):

## Executive Summary
FIRST SENTENCE must state the single most important finding with an exact number (e.g. "Revenue for ${periodStr} was ${config.currency} X, ▲ Y% vs the prior period."). Then: 3–5 bullet points, each containing at least one number. Cover: period overview, top positive finding, top risk or concern, and one forward-looking implication. Limit: ~${reportSettings.execSummaryMaxWords} words. Every sentence must contain a figure.

## Key Metrics
A markdown table — NO prose paragraphs in this section. Columns: | Metric | This Period | Prior Period | Change | Notes |
Include every primary KPI available in the data. Use "N/A" where prior-period data is unavailable. Format currency with ${config.currency} prefix. Format percentages with one decimal place.

## Detailed Analysis
Use ### sub-sections for each major theme (e.g. ### Revenue Performance, ### Product Mix, ### Customer Behaviour).
Each sub-section: 2–3 sentences of narrative that explain BOTH what the data shows AND what it means for ${companyName}, followed by a supporting data table. Narrative must reference specific names and numbers from the data — no generic statements.

## Rankings & Breakdowns
Use ### sub-sections for each entity type (e.g. ### Top ${config.labels.productPlural}, ### Top ${config.labels.customerPlural}).
Every table must have: | Rank | Name | Value | % of Total | Change (if available) |
Show at least 10 rows per table where the data exists. Append 1–2 sentences of commentary calling out the most significant entry.

## Strategic Observations & Recommended Actions
5 numbered action items. Each must: (a) name a specific entity (product name, customer name, or category), (b) include a specific number or measurable target, (c) explain the business rationale in one sentence. No generic advice.${reportSettings.referencesPage ? `

## References
Numbered list of all data sources used. Include: database tables queried, date ranges analysed, record counts, and key aggregations performed. Example format:
   1. orders table — X records, ${periodStr}
   2. order_items table — joined for product-level breakdown
   3. products table — inventory and pricing data` : ""}`,

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
      system: `You are a senior business intelligence analyst at a top management consulting firm, producing board-level reports for ${companyName}. Your reports are used by executives to make decisions worth thousands of dollars — every sentence must earn its place.

QUALITY STANDARD — every report must meet ALL of these:
• SPECIFIC: Every claim backed by an exact figure. "Revenue: ${config.currency} 12,450" — not "strong revenue performance"
• COMPARATIVE: Show direction and magnitude wherever possible: "▲ +18% vs prior period", "lowest in the last 3 months"
• ANALYTICAL: Each section must explain BOTH what the data shows AND what it means for the business
• TABLE-RICH: Ranked tables must include Rank + Value + % of Total + Change columns. Do not summarise in prose what a table can show more clearly
• ACTIONABLE: Every recommendation must name a specific product, customer, or dollar threshold — not generic advice
• EXECUTIVE-READY: The executive summary alone must allow a CEO to act — first sentence states the #1 finding with a number

You have a fetch_data tool to retrieve data from the business database via SQL queries.
SQL handles all data aggregation — use SUM, COUNT, AVG, GROUP BY, window functions, JOINs, etc.
Call fetch_data MULTIPLE times — one call per data section. Richer data produces better reports.

${DB_SCHEMA_ANALYTICS}

Report period: ${periodStr} (start: ${startStr}, end: ${endStr})
Terminology: "${config.labels.product}" for products, "${config.labels.order}" for orders, "${config.labels.customer}" for customers.
Currency: ${config.currency}${businessContext}${customInstructions}

CRITICAL — NO PLACEHOLDERS:
NEVER use [Company Name], [Business Name], [Date], [Generation Date], or any bracketed placeholder.
The company name is "${companyName}" — use it directly.
Today's date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} — use it directly.

GUARDRAILS:
- Read-only SELECT queries only. Never INSERT, UPDATE, DELETE, DROP, or ALTER.
- Never fabricate data. Use EXACT numbers from SQL results — never approximate.
- Mask PII in reports (e.g. j***@example.com). Do not expose credentials or infrastructure details.
- Stay within business reporting scope.

SQL TIPS:
- Date filter: created_at >= '${startStr}'::timestamp AND created_at <= '${endStr}'::timestamp
- Prior period: shift the window back by the same duration (e.g. for 30 days: start - 30 days to start)
- Use COALESCE for nullable aggregates; LIMIT for top-N; LEFT JOIN when related data may be absent
- ROUND(value::numeric, 2) for currency; ROUND(pct * 100, 1) for percentages

${formatInstruction}

${reportLimits}

${chartInstruction}`,
      prompt: `${await getReportPromptForType(input.reportType, periodStr, startStr, endStr)}

After fetching ALL the data above, write the complete "${title}" report for ${companyName}.
Start DIRECTLY with ## Executive Summary — NO title heading, NO "Prepared for:" line, NO "Date:" line.

REPORT STRUCTURE — follow exactly:

## Executive Summary
FIRST SENTENCE must state the single most important finding with an exact number (e.g. "Revenue for ${periodStr} was ${config.currency} X, ▲ Y% vs the prior period."). Then: 3–5 bullet points, each containing at least one number. Cover: period overview, top positive finding, top risk or concern, and one forward-looking implication. Limit: ~${reportSettings.execSummaryMaxWords} words. Every sentence must contain a figure.

## Key Metrics
A markdown table — NO prose paragraphs in this section. Columns: | Metric | This Period | Prior Period | Change | Notes |
Include every primary KPI you retrieved. Use "N/A" where prior-period data is unavailable. Format currency with ${config.currency} prefix and percentages with one decimal place.

## Detailed Analysis
Use ### sub-sections for each major theme (e.g. ### Revenue Performance, ### Product Mix, ### Customer Behaviour).
Each sub-section: 2–3 sentences of narrative explaining BOTH what the data shows AND what it means for ${companyName}, followed by a supporting data table. Name specific products, customers, and exact figures — no generic statements.

## Rankings & Breakdowns
Use ### sub-sections for each entity type (e.g. ### Top ${config.labels.productPlural}, ### Top ${config.labels.customerPlural}).
Every table must have: | Rank | Name | Value | % of Total | Change (if available) |
Show at least 10 rows per table where the data exists. Follow each table with 1–2 sentences calling out the most significant entry.

## Strategic Observations & Recommended Actions
5 numbered action items. Each must: (a) name a specific entity (product name, customer name, or category), (b) include a specific number or measurable target, (c) explain the business rationale in one sentence. No generic advice.${reportSettings.referencesPage ? `

## References
Numbered list of all data sources used. Include: tables queried, date ranges, record counts, and key aggregations performed.` : ""}

Use EXACT numbers from your SQL results — never round, never approximate. Reference specific product names, SKUs, and customer names throughout.`,
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

    // Count chart blocks in the generated content for observability
    const sqlChartBlockCount = (maskedSqlContent.match(/```chart/g) ?? []).length;
    ctx.logger.info("Report generated (dynamic SQL)", {
      reportType: input.reportType,
      period: periodStr,
      format: input.format || defaultFormat,
      durationMs: Date.now() - (ctx.state.get("startedAt") as number ?? Date.now()),
      tokenUsage: tokenTracker.totals(),
      chartBlocksInContent: sqlChartBlockCount,
      skipCache: input.skipCache ?? false,
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
