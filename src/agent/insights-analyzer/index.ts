import { createAgent } from "@agentuity/runtime";
import { generateText, generateObject, tool } from "ai";
import { z } from "zod";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { executeSandbox } from "@lib/sandbox";
import { getAISettings } from "@services/settings";

/**
 * Insights Analyzer Agent — "The Analyst"
 *
 * Unique specialty: COMPUTATIONAL INTELLIGENCE.
 *
 * This agent is the platform's data scientist. It uses the Agentuity
 * sandbox to execute dynamically-generated JavaScript code for
 * statistical analysis that goes BEYOND what SQL can express:
 * z-scores, moving averages, trend projections, anomaly scoring,
 * demand forecasting, pareto analysis, cohort comparisons, etc.
 *
 * Vs. other agents:
 *   - insights-analyzer (The Analyst): Computes statistics in sandbox
 *   - report-generator (The Writer): Narrates data into reports (no sandbox)
 *   - knowledge-base (The Librarian): Retrieves from uploaded documents
 *
 * Speed optimizations:
 *   - Uses gpt-4o-mini for the structuring step (fast, cheap)
 *   - Main model for code generation (needs quality)
 *   - maxSteps: 5 limits tool-calling rounds
 *
 * Original Insights Analyzer Agent â€” AI + Sandbox-powered business intelligence.
 *
 * Architecture (v3 â€” fully dynamic, LLM-generated code):
 *   1. The LLM receives the analysis request and database schema
 *   2. The LLM WRITES its own SQL query to fetch relevant data
 *   3. The LLM WRITES JavaScript code to perform statistical analysis
 *   4. The sandbox executes the LLM-generated code in isolated bun:1
 *   5. The LLM interprets the computed results into business insights
 *
 * The code is generated ON THE FLY â€” not from templates. This means the
 * agent can adapt its analysis approach to any data shape, any question,
 * and any business context. It's a real data scientist, not a template runner.
 */

const inputSchema = z.object({
  analysis: z.enum([
    "demand-forecast",
    "anomaly-detection",
    "restock-recommendations",
    "sales-trends",
  ]),
  timeframeDays: z.number().int().min(1).max(365).default(30),
  productId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const insightSchema = z.object({
  title: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  description: z.string(),
  recommendation: z.string(),
  affectedItems: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  dataPoints: z.record(z.unknown()).optional(),
});

const outputSchema = z.object({
  analysisType: z.string(),
  generatedAt: z.string(),
  insights: z.array(insightSchema),
  summary: z.string(),
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Database schema reference (injected into LLM prompt)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Agent definition
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default createAgent("insights-analyzer", {
  schema: { input: inputSchema, output: outputSchema },
  handler: async (ctx, input) => {
    const aiSettings = await getAISettings();

    // â”€â”€ Build the sandbox tool (closes over ctx.sandbox) â”€â”€â”€â”€â”€â”€
    const runAnalysisTool = tool({
      description: `Execute a data analysis pipeline: run a SQL query to fetch data, then execute JavaScript code in a sandboxed Bun runtime to compute statistical results.
The SQL results become the DATA variable (array of row objects) in the JavaScript code.
Your JavaScript code MUST return a result object with the computed analysis.
You have NO npm packages â€” use built-in JS/Bun APIs only (Math, Date, Array methods, etc).
The sandbox has NO network access and a 30-second timeout.`,
      parameters: z.object({
        sqlQuery: z.string().describe("PostgreSQL SELECT query to fetch the data needed for analysis"),
        code: z.string().describe("JavaScript code to analyze the data. DATA is the array of SQL result rows. Must RETURN a result object."),
        explanation: z.string().describe("What this analysis step does"),
      }),
      execute: async ({ sqlQuery, code, explanation }) => {
        const result = await executeSandbox(ctx.sandbox, {
          code,
          sqlQuery,
          explanation,
          timeoutMs: 30000,
        });

        if (!result.success) {
          return { error: result.error, stderr: result.stderr, explanation };
        }

        return { result: result.result, dataRowCount: result.dataRowCount, explanation };
      },
    });

    // â”€â”€ Analysis-specific prompts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const analysisPrompts: Record<string, string> = {
      "demand-forecast": `Perform DEMAND FORECASTING analysis:
- Fetch daily sales data and current stock levels for the last ${input.timeframeDays} days
- Write JavaScript to compute: moving averages (7-day, 14-day), sales velocity, velocity acceleration/deceleration, days until stockout, demand variability (coefficient of variation)
- Identify products at risk of stockout and products with accelerating/decelerating demand
- Return structured data with per-product forecasts sorted by risk level`,

      "anomaly-detection": `Perform ANOMALY DETECTION analysis:
- Fetch daily order volumes, revenue, and per-product sales data for the last ${input.timeframeDays} days
- Write JavaScript to compute: z-scores for daily volumes/revenue, IQR analysis for pricing outliers, volume spike detection
- Flag any data point with |z-score| > 2 as anomalous
- Return structured anomaly data with severity ratings, directions (spike/drop), and affected entities`,

      "restock-recommendations": `Perform RESTOCK RECOMMENDATIONS analysis:
- Fetch sales velocity data and current stock levels for the last ${input.timeframeDays} days
- Write JavaScript to compute: daily velocity per product, safety stock (1.5x lead time buffer assuming 7-day lead time), optimal reorder quantities, days of stock remaining, urgency classification
- Prioritize by urgency: out-of-stock > critical (â‰¤3 days) > high (â‰¤7 days) > medium (â‰¤14 days) > low
- Return structured recommendations sorted by urgency`,

      "sales-trends": `Perform SALES TRENDS analysis:
- Fetch weekly revenue, daily revenue, and per-product weekly breakdown for the last ${input.timeframeDays} days
- Write JavaScript to compute: overall growth rate (first half vs second half), product momentum scoring (recent vs earlier periods), day-of-week revenue patterns, peak identification
- Classify products as accelerating (>15% momentum), decelerating (<-15%), or steady
- Return structured trend data with overall metrics, top growers, top decliners, and day patterns`,
    };

    // â”€â”€ Custom analysis instructions if configured â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const customInstructions = aiSettings.aiInsightsInstructions?.trim()
      ? `\n\nAdditional business-specific instructions:\n${aiSettings.aiInsightsInstructions.trim()}`
      : "";

    const businessContext = aiSettings.aiBusinessContext?.trim()
      ? `\n\nBusiness context:\n${aiSettings.aiBusinessContext.trim()}`
      : "";

    // â”€â”€ Step 1 & 2: LLM generates code, sandbox executes it â”€â”€
    const { text: analysisNarrative, steps } = await generateText({
      model: await getModel(),
      system: `You are an expert data scientist and business analyst for ${config.companyName}.
You have access to a tool that lets you:
1. Write a SQL query to fetch data from the business database
2. Write JavaScript code to perform statistical analysis on that data
3. The code runs in an isolated Bun sandbox (no packages, no network â€” pure JS/Bun APIs)

${DB_SCHEMA}

Terminology: Products are "${config.labels.product}" (plural: "${config.labels.productPlural}"), orders are "${config.labels.order}", customers are "${config.labels.customer}".
Currency: ${config.currency}${businessContext}${customInstructions}

WORKFLOW:
1. Use the run_analysis tool to fetch data and compute statistics. You may call it MULTIPLE times if needed (e.g., first fetch and analyze sales data, then fetch and analyze inventory data).
2. After getting computed results, provide your expert interpretation as structured insights.

IMPORTANT for your JavaScript code:
- DATA is the array of SQL result row objects
- You MUST return a result object (use \`return { ... }\`)
- Use only built-in JS: Math, Date, Array methods, Object methods, etc.
- Handle edge cases: empty arrays, zero denominators, null values
- Convert numeric strings with Number()`,
      prompt: `${analysisPrompts[input.analysis]}

${input.productId ? `Focus on product ID: ${input.productId}` : "Analyze all active products."}

After running your analysis, provide a comprehensive interpretation with:
- Clear title for each finding
- Severity (info/warning/critical)
- Business-language description (not technical stats jargon)
- Specific, actionable recommendation
- Confidence level (0-1) based on data quality and sample size
- Reference affected product names/SKUs where applicable`,
      tools: { run_analysis: runAnalysisTool },
      maxSteps: 5,
    });

    // â”€â”€ Step 3: Parse the LLM's structured response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // The LLM provided narrative text after running tools. Now we
    // ask it to structure the insights formally.
    const toolResults = steps
      .flatMap((s) => s.toolResults || [])
      .map((tr: any) => tr.result)
      .filter(Boolean);

    const { object } = await generateObject({
      model: await getModel("gpt-4o-mini"), // Fast model for structuring — saves 2-3s
      schema: z.object({
        insights: z.array(insightSchema),
        summary: z.string(),
      }),
      system: `You are formatting business insights into a structured JSON format.
Use the analysis results and narrative below to produce structured insights.
Each insight needs: title, severity (info/warning/critical), description, recommendation, affectedItems (product names/SKUs), confidence (0-1), and optional dataPoints.
Also provide an overall summary paragraph.`,
      prompt: `Analysis type: ${input.analysis}
Timeframe: ${input.timeframeDays} days

Tool results:
${JSON.stringify(toolResults, null, 2)}

Narrative interpretation:
${analysisNarrative}`,
    });

    // Handle both the experimental_output path and fallback
    const parsed = object ?? parseInsightsFromText(analysisNarrative);

    ctx.logger.info(
      `Insights analysis complete (dynamic sandbox): ${input.analysis}, ${parsed.insights?.length ?? 0} insights generated`
    );

    return {
      analysisType: input.analysis,
      generatedAt: new Date().toISOString(),
      insights: parsed.insights ?? [],
      summary: parsed.summary ?? analysisNarrative,
    };
  },
});

/** Fallback parser if structured output fails */
function parseInsightsFromText(text: string): { insights: Array<Record<string, unknown>>; summary: string } {
  try {
    // Try to find JSON in the text
    const jsonMatch = text.match(/\{[\s\S]*"insights"[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* ignore */ }

  return {
    insights: [{
      title: "Analysis Complete",
      severity: "info",
      description: text.slice(0, 500),
      recommendation: "Review the full analysis above for details.",
      confidence: 0.7,
    }],
    summary: text.slice(0, 300),
  };
}
