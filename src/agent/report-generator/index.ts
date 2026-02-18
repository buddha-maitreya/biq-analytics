import { createAgent } from "@agentuity/runtime";
import { generateText, tool } from "ai";
import { z } from "zod";
import { db } from "@db/index";
import { sql } from "drizzle-orm";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { getAISettings } from "@services/settings";

/**
 * Report Generator Agent — "The Writer"
 *
 * Unique specialty: PROFESSIONAL NARRATIVE WRITING.
 *
 * This agent is the platform's business writer. It takes data and
 * transforms it into polished, structured business reports with
 * executive summaries, key metrics, analysis, and recommendations.
 *
 * Architecture (v4 — writer-focused, fast):
 *   1. Receives report request (type, period, optional pre-computed data)
 *   2. If no pre-computed data: LLM generates SQL queries dynamically
 *      to fetch the necessary metrics (no sandbox — SQL handles aggregation)
 *   3. LLM writes a professional, formatted business report from the data
 *   4. Returns the complete report as structured output
 *
 * Design principles:
 *   - NO SANDBOX — report writing is a language task, not a computation task.
 *     Complex statistical computations belong in insights-analyzer (The Analyst).
 *   - SQL handles data aggregation (SUM, COUNT, AVG, GROUP BY, window functions).
 *   - The LLM's job is WRITING: structuring, interpreting, and narrating.
 *   - Fast: one generateText call with a lightweight fetch_data tool.
 *   - When computedData is provided (pre-fetched by orchestrator), skips
 *     SQL entirely → single LLM call → 2-4 second response.
 *
 * Vs. other agents:
 *   - insights-analyzer (The Analyst): Computes statistics in sandbox
 *   - report-generator (The Writer): Narrates data into professional reports
 *   - knowledge-base (The Librarian): Retrieves from uploaded documents
 */

const inputSchema = z.object({
  reportType: z.enum([
    "sales-summary",
    "inventory-health",
    "customer-activity",
    "financial-overview",
  ]),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  format: z.enum(["markdown", "plain"]).default("markdown"),
  /** Pre-computed data from the orchestrator or another agent.
   *  When provided, the agent skips SQL and writes directly → fastest path. */
  computedData: z.string().optional(),
});

const outputSchema = z.object({
  title: z.string(),
  reportType: z.string(),
  period: z.object({ start: z.string(), end: z.string() }),
  content: z.string(),
  generatedAt: z.string(),
});

// ────────────────────────────────────────────────────────────
// Database schema reference (injected into LLM prompt)
// ────────────────────────────────────────────────────────────

const DB_SCHEMA = `PostgreSQL database schema:

Tables:
- products(id uuid, sku varchar, name varchar, description text, category_id uuid, unit varchar, price numeric, cost_price numeric, tax_rate numeric, barcode varchar, is_consumable boolean, is_sellable boolean, is_active boolean, min_stock_level int, max_stock_level int, reorder_point int, metadata jsonb, created_at timestamptz, updated_at timestamptz)
- categories(id uuid, name varchar, description text, parent_id uuid, sort_order int, is_active boolean)
- warehouses(id uuid, name varchar, code varchar, address text, is_active boolean, is_default boolean)
- inventory(id uuid, product_id uuid FK->products, warehouse_id uuid FK->warehouses, quantity int, metadata jsonb)
- inventory_transactions(id uuid, product_id uuid FK->products, warehouse_id uuid FK->warehouses, type varchar, quantity int, reference_type varchar, reference_id uuid, notes text, created_at timestamptz)
- customers(id uuid, name varchar, email varchar, phone varchar, address text, is_active boolean, metadata jsonb, created_at timestamptz)
- orders(id uuid, order_number varchar, customer_id uuid FK->customers, status_id uuid FK->order_statuses, total_amount numeric, tax_amount numeric, discount_amount numeric, notes text, metadata jsonb, created_at timestamptz)
- order_items(id uuid, order_id uuid FK->orders, item_type varchar, product_id uuid FK->products, service_id uuid, description text, quantity numeric, unit_price numeric, total_amount numeric)
- order_statuses(id uuid, name varchar, color varchar, sort_order int, is_default boolean, is_final boolean)
- invoices(id uuid, invoice_number varchar, order_id uuid FK->orders, customer_id uuid FK->customers, total_amount numeric, paid_amount numeric, status varchar, due_date timestamptz, created_at timestamptz)
- payments(id uuid, invoice_id uuid FK->invoices, amount numeric, payment_method varchar, reference varchar, created_at timestamptz)

Key relationships:
- order_items.product_id -> products.id (what was sold)
- order_items.order_id -> orders.id (which order)
- orders.customer_id -> customers.id (who bought)
- inventory.product_id -> products.id (stock levels)
- inventory_transactions tracks all stock movements

SQL DIALECT: PostgreSQL. Use INTERVAL, ILIKE, STRING_AGG, EXTRACT, date_trunc, etc. NEVER MySQL syntax.`;

// ────────────────────────────────────────────────────────────
// Agent definition
// ────────────────────────────────────────────────────────────

export default createAgent("report-generator", {
  schema: { input: inputSchema, output: outputSchema },
  handler: async (ctx, input) => {
    const aiSettings = await getAISettings();

    // Default to last 30 days
    const end = input.endDate ? new Date(input.endDate) : new Date();
    const start = input.startDate
      ? new Date(input.startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const startStr = start.toISOString();
    const endStr = end.toISOString();
    const periodStr = `${start.toISOString().split("T")[0]} to ${end.toISOString().split("T")[0]}`;

    const reportTitles: Record<string, string> = {
      "sales-summary": `${config.labels.orderPlural} & Revenue Report`,
      "inventory-health": "Inventory Health Report",
      "customer-activity": `${config.labels.customerPlural} Activity Report`,
      "financial-overview": "Financial Overview Report",
    };

    const title = reportTitles[input.reportType];

    // ── Report-specific guidance prompts ──────────────────────
    const reportPrompts: Record<string, string> = {
      "sales-summary": `Generate a SALES SUMMARY report for the period ${periodStr}:
- Fetch total revenue, order count, average order value using aggregate SQL
- Fetch top-selling products (by revenue and by units) using GROUP BY + ORDER BY
- Fetch top customers by spend
- Fetch daily revenue for trend description
- Use multiple fetch_data calls if needed for different data sections`,

      "inventory-health": `Generate an INVENTORY HEALTH report:
- Fetch current stock summary: total products, total units, low-stock count, out-of-stock count
- Fetch the low/out-of-stock items with their quantities and reorder points
- Fetch top items by inventory value (quantity × cost_price)
- Note: Inventory is point-in-time — ignore date filters for stock queries`,

      "customer-activity": `Generate a CUSTOMER ACTIVITY report for the period ${periodStr}:
- Fetch customer counts: total, active, new (created in period)
- Fetch top customers by spend with order counts and last order date
- Fetch order frequency distribution (how many customers have 1 order, 2 orders, etc.)
- Use orders within the date range for activity metrics`,

      "financial-overview": `Generate a FINANCIAL OVERVIEW report for the period ${periodStr}:
- Fetch order revenue totals for the period
- Fetch invoice summary: total invoiced, total paid, outstanding balance, overdue count
- Fetch payment summary: total collected, payment count
- Fetch accounts receivable aging (current, 1-30, 31-60, 61-90, 90+ days overdue)`,
    };

    // ── Custom instructions if configured ─────────────────────
    const customInstructions = aiSettings.aiReportInstructions?.trim()
      ? `\n\nAdditional report formatting instructions:\n${aiSettings.aiReportInstructions.trim()}`
      : "";

    const businessContext = aiSettings.aiBusinessContext?.trim()
      ? `\n\nBusiness context:\n${aiSettings.aiBusinessContext.trim()}`
      : "";

    const formatInstruction =
      input.format === "markdown"
        ? "Format the report in clean Markdown with headers (##, ###), bullet points, and tables where appropriate."
        : "Format the report in plain text, well-structured with clear sections.";

    // ── Fast path: pre-computed data provided ─────────────────
    if (input.computedData) {
      const { text: reportContent } = await generateText({
        model: await getModel(),
        system: `You are a professional business report writer for ${config.companyName}.
Write a clear, actionable business report based on the provided data.

IMPORTANT: The data has been pre-computed with mathematical precision.
Do NOT recalculate or approximate — use the EXACT numbers provided.
Your job is to WRITE: structure, interpret, and narrate the data into a professional report.

Terminology: "${config.labels.product}" for products, "${config.labels.order}" for orders, "${config.labels.customer}" for customers.
Currency: ${config.currency}
Period: ${periodStr}${businessContext}${customInstructions}

${formatInstruction}`,
        prompt: `Write the "${title}" report for ${config.companyName}.
Period: ${periodStr}

Pre-computed data:
${input.computedData}

Report structure:
1. Executive Summary (2-3 sentences, key highlights)
2. Key Metrics (exact numbers from the data)
3. Detailed Analysis (interpret what the numbers mean)
4. Rankings & Breakdowns (top products, customers, etc.)
5. Recommendations (specific, actionable next steps)`,
      });

      ctx.logger.info(`Generated report (fast path): ${input.reportType} for ${periodStr}`);

      return {
        title,
        reportType: input.reportType,
        period: { start: start.toISOString(), end: end.toISOString() },
        content: reportContent,
        generatedAt: new Date().toISOString(),
      };
    }

    // ── Standard path: LLM writes SQL + report ────────────────
    // The LLM generates SQL queries dynamically to fetch the data
    // it needs, then writes the report from the results.
    // No sandbox needed — SQL handles aggregation, LLM handles writing.

    const fetchDataTool = tool({
      description: `Execute a read-only SQL query against the business database to fetch data for the report.
Returns the query results as an array of row objects. Use PostgreSQL syntax.
Use aggregate functions (SUM, COUNT, AVG, MIN, MAX), GROUP BY, JOINs, and window functions
to get the exact metrics you need. You can call this tool multiple times for different data sections.`,
      parameters: z.object({
        query: z.string().describe("PostgreSQL SELECT query to execute"),
        section: z.string().describe("Which part of the report this data is for"),
      }),
      execute: async ({ query, section }) => {
        // Safety check — only allow SELECT
        const trimmed = query.trim().toUpperCase();
        if (
          !trimmed.startsWith("SELECT") ||
          /\b(DROP|DELETE|INSERT|UPDATE|ALTER|TRUNCATE|CREATE)\b/.test(trimmed)
        ) {
          return { error: "Only SELECT queries are allowed.", rows: [], section };
        }

        try {
          const result = await db.execute(sql.raw(query));
          const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
          return { rows: rows.slice(0, 200), rowCount: rows.length, section };
        } catch (err: any) {
          return { error: `Query failed: ${err.message}`, rows: [], section };
        }
      },
    });

    const { text: reportContent } = await generateText({
      model: await getModel(),
      system: `You are a professional business report writer and data analyst for ${config.companyName}.
You write clear, insightful, actionable business reports.

You have a fetch_data tool to retrieve data from the business database via SQL queries.
SQL handles all data aggregation — use SUM, COUNT, AVG, GROUP BY, window functions, JOINs, etc.
You can call fetch_data MULTIPLE times to get different data sections.

${DB_SCHEMA}

Report period: ${periodStr} (start: ${startStr}, end: ${endStr})
Terminology: "${config.labels.product}" for products, "${config.labels.order}" for orders, "${config.labels.customer}" for customers.
Currency: ${config.currency}${businessContext}${customInstructions}

WORKFLOW:
1. Use fetch_data to retrieve the metrics you need (call it multiple times for different sections)
2. After getting ALL data, write the complete professional report

SQL TIPS:
- Filter by date: created_at >= '${startStr}'::timestamp AND created_at <= '${endStr}'::timestamp
- Use COALESCE for nullable aggregates
- Use LIMIT for top-N queries
- Use LEFT JOIN when data may not exist (e.g. customers with no orders)

${formatInstruction}`,
      prompt: `${reportPrompts[input.reportType]}

After fetching all the data you need, write a complete, professional "${title}" report.

Report structure:
1. Executive Summary (2-3 sentences highlighting the most important findings)
2. Key Metrics (exact numbers from your queries — do NOT approximate)
3. Detailed Analysis (interpret what the numbers mean for the business)
4. Rankings & Breakdowns (top products, customers, categories, etc.)
5. Recommendations (specific, actionable next steps based on the data)

Use exact numbers — never round or approximate. Reference specific product names, SKUs, and customer names.`,
      tools: { fetch_data: fetchDataTool },
      maxSteps: 6,
    });

    ctx.logger.info(`Generated report (dynamic SQL): ${input.reportType} for ${periodStr}`);

    return {
      title,
      reportType: input.reportType,
      period: { start: start.toISOString(), end: end.toISOString() },
      content: reportContent,
      generatedAt: new Date().toISOString(),
    };
  },
});
