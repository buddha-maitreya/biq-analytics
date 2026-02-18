import { createAgent } from "@agentuity/runtime";
import { streamText, generateText, tool } from "ai";
import { z } from "zod";
import {
  db,
  products,
  orders,
  orderItems,
  customers,
  inventory,
  invoices,
  payments,
  inventoryTransactions,
  chatSessions,
  chatMessages,
} from "@db/index";
import { sql, eq, gte, lte, and, desc } from "drizzle-orm";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { executeSandbox } from "@lib/sandbox";
import type { SandboxResult } from "@lib/sandbox";
import { getAISettings } from "@services/settings";
import type { AISettings } from "@services/settings";
import { listActiveTools, executeTool } from "@services/custom-tools";
import type { CustomToolRow } from "@services/custom-tools";
import insightsAnalyzer from "@agent/insights-analyzer";
import reportGenerator from "@agent/report-generator";
import knowledgeBase from "@agent/knowledge-base";

/**
 * Data Science Assistant — the orchestrator ("Brain of the Business").
 *
 * Adapted from lessons learned studying Agentuity Coder patterns:
 *
 * Architecture decisions:
 * 1. The agent handler is for NON-streaming invocations (direct agent.run()).
 *    The exported streamChat() is the streaming path used by the chat route.
 *    This eliminates the previous dual-persistence bug.
 *
 * 2. Conversation context is built by getConversationContext() which loads
 *    recent messages AND a rolling summary (compressed by maybeCompressSummary
 *    every 20 messages). This replaces the naive history.slice(-10).
 *
 * 3. The system prompt is data-driven via config labels — zero hardcoding.
 *
 * 4. Tool calling with maxSteps: 8 allows multi-tool invocations per turn.
 */

// ────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────

const inputSchema = z.object({
  message: z.string().min(1).describe("The user's message"),
  sessionId: z.string().uuid().describe("Chat session ID"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      })
    )
    .optional()
    .describe("Recent conversation history for context"),
});

const outputSchema = z.object({
  text: z.string().describe("The full assistant response text"),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        input: z.record(z.unknown()),
        output: z.unknown().optional(),
      })
    )
    .optional()
    .describe("Tool calls made during the response"),
});

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────

const queryDatabaseTool = tool({
  description: `Execute a read-only SQL query against the business database to answer data questions.
IMPORTANT: The database is PostgreSQL (NOT MySQL). You MUST use PostgreSQL syntax:
- Date math: NOW() - INTERVAL '30 days' (NOT DATE_SUB or DATE_ADD)
- String concat: || (NOT CONCAT())
- Boolean: TRUE/FALSE (NOT 1/0)
- ILIKE for case-insensitive LIKE
- EXTRACT(MONTH FROM date) or date_trunc('month', date)
- LIMIT/OFFSET (no LIMIT x,y syntax)
- Type casting: column::text or CAST(column AS text)
- String agg: STRING_AGG(col, ',') (NOT GROUP_CONCAT)
- Current date: CURRENT_DATE, CURRENT_TIMESTAMP, NOW()
Available tables: products, categories, warehouses, inventory, inventory_transactions, customers, orders, order_items, order_statuses, invoices, payments, users, notifications, tax_rules, asset_categories, assets, service_categories, services, service_bookings, booking_assets, booking_stock_allocations.
Key columns: products(id, sku, name, price, cost_price, unit, category_id, is_active, is_consumable, is_sellable), orders(id, order_number, customer_id, status_id, total_amount, created_at), order_items(order_id, item_type, product_id, service_id, description, quantity, unit_price, total_amount, start_date, end_date), inventory(product_id, warehouse_id, quantity), customers(id, name, email, phone), invoices(id, invoice_number, total_amount, paid_amount, status), assets(id, asset_code, name, category_id, condition_status, location, assigned_to_staff_id, is_active), services(id, service_code, name, category_id, base_price, pricing_model, capacity_limit, requires_asset, requires_stock), service_bookings(id, order_item_id, service_date, start_time, end_time, status, assigned_guide_id, assigned_vehicle_id).
Always use SELECT only. Use aggregations, JOINs, and GROUP BY as needed.`,
  parameters: z.object({
    query: z.string().describe("SQL SELECT query to execute"),
    explanation: z
      .string()
      .describe("What this query does in plain English"),
  }),
  execute: async ({ query, explanation }) => {
    const trimmed = query.trim().toUpperCase();
    if (
      !trimmed.startsWith("SELECT") ||
      trimmed.includes("DROP") ||
      trimmed.includes("DELETE") ||
      trimmed.includes("INSERT") ||
      trimmed.includes("UPDATE") ||
      trimmed.includes("ALTER") ||
      trimmed.includes("TRUNCATE")
    ) {
      return {
        error: "Only SELECT queries are allowed.",
        rows: [],
        rowCount: 0,
      };
    }

    try {
      const result = await db.execute(sql.raw(query));
      const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
      return {
        explanation,
        rows: rows.slice(0, 100),
        rowCount: rows.length,
        truncated: rows.length > 100,
      };
    } catch (err: any) {
      return {
        error: `Query failed: ${err.message}`,
        rows: [],
        rowCount: 0,
      };
    }
  },
});

const analyzeTrendsTool = tool({
  description:
    "Run the insights analyzer for demand forecasting, anomaly detection, restock recommendations, or sales trend analysis. Use this when users ask about trends, forecasts, anomalies, or restocking.",
  parameters: z.object({
    analysis: z
      .enum([
        "demand-forecast",
        "anomaly-detection",
        "restock-recommendations",
        "sales-trends",
      ])
      .describe("Type of analysis to perform"),
    timeframeDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Number of days to analyze"),
  }),
  execute: async ({ analysis, timeframeDays }) => {
    try {
      const result = await insightsAnalyzer.run({
        analysis,
        timeframeDays,
        limit: 10,
      });
      return {
        analysisType: result.analysisType,
        summary: result.summary,
        insights: result.insights,
        generatedAt: result.generatedAt,
      };
    } catch (err: any) {
      return { error: `Analysis failed: ${err.message}` };
    }
  },
});

const generateReportTool = tool({
  description:
    "Generate a detailed AI-narrated business report. Use this when users ask for reports, summaries, or overviews of sales, inventory, customers, or finances.",
  parameters: z.object({
    reportType: z
      .enum([
        "sales-summary",
        "inventory-health",
        "customer-activity",
        "financial-overview",
      ])
      .describe("Type of report to generate"),
    startDate: z
      .string()
      .optional()
      .describe("Start date in ISO format. Defaults to 30 days ago."),
    endDate: z
      .string()
      .optional()
      .describe("End date in ISO format. Defaults to now."),
  }),
  execute: async ({ reportType, startDate, endDate }) => {
    try {
      const result = await reportGenerator.run({
        reportType,
        startDate,
        endDate,
        format: "markdown",
      });
      return {
        title: result.title,
        content: result.content,
        period: result.period,
        generatedAt: result.generatedAt,
      };
    } catch (err: any) {
      return { error: `Report generation failed: ${err.message}` };
    }
  },
});

const searchKnowledgeTool = tool({
  description:
    "Search the uploaded business documents (knowledge base) for answers about policies, procedures, vendor agreements, or other company documentation.",
  parameters: z.object({
    question: z
      .string()
      .describe("The question to search the knowledge base for"),
  }),
  execute: async ({ question }) => {
    try {
      const result = await knowledgeBase.run({
        action: "query",
        question,
      });
      return {
        answer: result.answer,
        sources: result.sources,
        found: result.success,
      };
    } catch (err: any) {
      return { error: `Knowledge base search failed: ${err.message}` };
    }
  },
});

const getBusinessSnapshotTool = tool({
  description:
    "Get a quick overview of the business state: total products, orders, customers, revenue, low stock items, recent orders. Use when users ask general questions like 'how is the business doing?' or 'give me an overview'.",
  parameters: z.object({
    includeRecentOrders: z
      .boolean()
      .default(true)
      .describe("Include the 5 most recent orders"),
    includeLowStock: z
      .boolean()
      .default(true)
      .describe("Include low stock alerts"),
  }),
  execute: async ({ includeRecentOrders, includeLowStock }) => {
    const [productCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(eq(products.isActive, true));

    const [orderCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders);

    const [customerCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(customers)
      .where(eq(customers.isActive, true));

    const [revenue] = await db
      .select({
        total: sql<number>`COALESCE(sum(${orders.totalAmount}), 0)`,
      })
      .from(orders);

    const snapshot: Record<string, unknown> = {
      totalProducts: productCount.count,
      totalOrders: orderCount.count,
      totalCustomers: customerCount.count,
      totalRevenue: revenue.total,
      currency: config.currency,
    };

    if (includeLowStock) {
      snapshot.lowStockItems = await db
        .select({
          productName: products.name,
          sku: products.sku,
          quantity: inventory.quantity,
          reorderPoint: products.reorderPoint,
        })
        .from(inventory)
        .innerJoin(products, eq(inventory.productId, products.id))
        .where(
          sql`${inventory.quantity} <= COALESCE(${products.reorderPoint}, ${products.minStockLevel}, 0)`
        )
        .limit(10);
    }

    if (includeRecentOrders) {
      snapshot.recentOrders = await db.query.orders.findMany({
        with: { customer: true, status: true },
        orderBy: (o, { desc }) => [desc(o.createdAt)],
        limit: 5,
      });
    }

    return snapshot;
  },
});

// ────────────────────────────────────────────────────────────
// run_analysis — Sandbox-powered code execution tool
//
// This is the "real AI agent" capability: the LLM writes JavaScript
// code that gets executed in an isolated Bun sandbox. The code can
// perform arbitrary computations — statistical analysis, data
// transformations, forecasting, anomaly detection, etc.
//
// Flow:
//   1. LLM writes a SQL query to fetch relevant data
//   2. LLM writes JavaScript code to analyze that data
//   3. We run the SQL, pipe results as DATA into the sandbox
//   4. Sandbox executes the code in bun:1 (no network)
//   5. Results are returned to the LLM for narration
// ────────────────────────────────────────────────────────────

/** Request-scoped sandbox API reference — set by the handler before tool execution */
let _sandboxApi: any = null;

function createRunAnalysisTool() {
  return tool({
    description: `Execute JavaScript code in an isolated Bun sandbox to perform sophisticated data analysis.
Use this tool for computations that go BEYOND simple SQL: statistical calculations, moving averages, standard deviations, trend projections, percentage changes, data transformations, ranking algorithms, time-series analysis, anomaly scoring, forecasting, cohort analysis, or any calculation that benefits from programmatic logic.

HOW IT WORKS:
1. You write a SQL query to fetch the raw data you need
2. You write JavaScript code that processes that data
3. The SQL results are available as the global variable DATA (an array of row objects)
4. Your code MUST return a result (the last expression or an explicit return)
5. The code runs in Bun 1.x — you can use modern JS/TS features, async/await, etc.

IMPORTANT RULES:
- DATA is an array of objects (SQL result rows), e.g. [{name: "Widget", total_sold: 150}, ...]
- Your code MUST return a value — this is what gets sent back as the result
- You have NO network access and NO filesystem access beyond the sandbox
- You have NO npm packages — use only built-in JavaScript/Bun APIs
- Keep computations efficient — you have 30 seconds max
- For large datasets, work with aggregated SQL data rather than raw rows

EXAMPLE:
  sqlQuery: "SELECT p.name, SUM(oi.quantity) as total_sold, SUM(oi.total_amount) as revenue FROM order_items oi JOIN products p ON oi.product_id = p.id JOIN orders o ON oi.order_id = o.id WHERE o.created_at >= NOW() - INTERVAL '90 days' GROUP BY p.name ORDER BY revenue DESC LIMIT 20"
  code: |
    // Calculate growth rates and rankings
    const total = DATA.reduce((s, r) => s + Number(r.revenue), 0);
    const analyzed = DATA.map((row, i) => ({
      rank: i + 1,
      product: row.name,
      revenue: Number(row.revenue),
      sharePercent: ((Number(row.revenue) / total) * 100).toFixed(1),
      unitsSold: Number(row.total_sold),
      avgPrice: (Number(row.revenue) / Number(row.total_sold)).toFixed(2),
    }));
    const top3Revenue = analyzed.slice(0, 3).reduce((s, r) => s + r.revenue, 0);
    return {
      products: analyzed,
      totalRevenue: total,
      top3Concentration: ((top3Revenue / total) * 100).toFixed(1) + "%",
      productCount: analyzed.length
    };`,
    parameters: z.object({
      sqlQuery: z
        .string()
        .optional()
        .describe("PostgreSQL SELECT query to fetch data. Results become the DATA variable in the sandbox. Use PostgreSQL syntax (INTERVAL, ILIKE, STRING_AGG, etc). Can be omitted if you provide data directly via the analysis code."),
      code: z
        .string()
        .describe("JavaScript code to execute in Bun sandbox. Receives DATA (array of row objects from SQL). Must RETURN a result (object, array, or primitive). Use modern JS — async/await, destructuring, Array methods, Math, Date, etc."),
      explanation: z
        .string()
        .describe("Plain English description of what this analysis does and why"),
    }),
    execute: async ({ sqlQuery, code, explanation }) => {
      if (!_sandboxApi) {
        return {
          error: "Sandbox not available — falling back to query_database for this request.",
          explanation,
        };
      }

      const result = await executeSandbox(_sandboxApi, {
        code,
        sqlQuery,
        explanation,
        timeoutMs: 30000,
      });

      if (!result.success) {
        return {
          error: result.error,
          stderr: result.stderr,
          dataRowCount: result.dataRowCount,
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
}

// ────────────────────────────────────────────────────────────
// System prompt
// ────────────────────────────────────────────────────────────

function buildSystemPrompt(conversationSummary?: string, ai?: AISettings, customToolsSection?: string): string {
  // ── Personality — who the AI is ───────────────────────────
  const personality = ai?.aiPersonality?.trim()
    || `You are the intelligent business assistant for ${config.companyName} — you act as the "brain of the business."`;

  // ── Environment — where/how the AI operates ───────────────
  const environment = ai?.aiEnvironment?.trim()
    ? `\nEnvironment:\n${ai.aiEnvironment.trim()}`
    : `\nEnvironment:\nYou operate inside the ${config.companyName} management platform. Users interact with you via a chat interface. You have access to the live business database, analytics agents, a knowledge base of uploaded documents, and custom business tools.`;

  // ── Tone — communication style ────────────────────────────
  const tone = ai?.aiTone?.trim()
    ? `\nTone:\n${ai.aiTone.trim()}`
    : "";

  // ── Goal — primary objective ──────────────────────────────
  const goal = ai?.aiGoal?.trim()
    ? `\nGoal:\n${ai.aiGoal.trim()}`
    : `\nGoal:\nHelp users understand their business data, surface actionable insights, and answer operational questions quickly and accurately.`;

  // ── Core role (always present, not customizable) ──────────
  const coreRole = `Your role:
- Answer questions about the business using the available tools
- Query the database directly for precise data answers
- Use run_analysis to write and execute JavaScript code for sophisticated computations (statistics, forecasting, trend analysis, anomaly detection, data transformations)
- Delegate to specialized agents (insights, reports, knowledge base) for complex analysis
- Synthesize results and provide clear, actionable responses
- After answering the user's question, check if your tool results revealed anything noteworthy beyond what was asked. If so, add a brief "💡 Also noticed:" section.

IMPORTANT — When to use run_analysis vs query_database:
- query_database: Simple lookups, counts, totals, lists, aggregations that SQL can express directly
- run_analysis: Anything requiring computation BEYOND SQL — percentages, rankings with custom logic, moving averages, standard deviations, growth rates, trend projections, cohort analysis, statistical tests, data scoring, pareto analysis, or any multi-step calculation. Prefer run_analysis for analytical questions — it makes you a real data scientist, not just a query runner.`;

  // ── Terminology (auto-generated from config labels) ───────
  const terminology = `Terminology for this deployment:
- Products are called "${config.labels.product}" / "${config.labels.productPlural}"
- Orders are called "${config.labels.order}" / "${config.labels.orderPlural}"
- Customers are called "${config.labels.customer}" / "${config.labels.customerPlural}"
- Currency: ${config.currency}
- Default unit: ${config.labels.unitDefault}`;

  // ── Business context (client-customizable) ────────────────
  const businessContext = ai?.aiBusinessContext?.trim()
    ? `\nBusiness context:\n${ai.aiBusinessContext.trim()}`
    : "";

  // ── Tool guidelines (client-customizable with defaults) ───
  const toolGuidelines = ai?.aiToolGuidelines?.trim()
    || `- Use run_analysis for ANY analytical question that needs computation: statistics, trends, forecasting, anomaly detection, growth rates, rankings, pareto analysis, cohort analysis, scoring, etc. Write SQL to fetch data, then JavaScript to compute results.
- Use query_database for simple data lookups (counts, totals, lists) where SQL alone suffices
- Use analyze_trends for quick pre-built insight types (demand-forecast, anomaly-detection, restock-recommendations, sales-trends)
- Use generate_report for comprehensive formatted report requests
- Use search_knowledge when users ask about policies, procedures, or uploaded documents
- Use get_business_snapshot for broad "how is the business?" questions
- You can use multiple tools in one turn — use as many as needed to build a thorough answer
- PREFER run_analysis over query_database for analytical questions — your JS code can do real computation`;

  // ── Query reasoning (how to think before acting) ──────────
  const queryReasoning = ai?.aiQueryReasoning?.trim()
    ? `\nQuery reasoning:\n${ai.aiQueryReasoning.trim()}`
    : "";

  // ── SQL dialect (always present, not customizable) ────────
  const sqlDialect = `CRITICAL — SQL dialect:
- The database is PostgreSQL. NEVER use MySQL syntax.
- Date intervals: NOW() - INTERVAL '30 days' (NOT DATE_SUB/DATE_ADD)
- String aggregation: STRING_AGG() (NOT GROUP_CONCAT)
- Case-insensitive match: ILIKE (NOT LOWER() + LIKE)
- Boolean literals: TRUE/FALSE (NOT 1/0)`;

  // ── Response formatting (client-customizable with defaults)
  const responseFormatting = ai?.aiResponseFormatting?.trim()
    ? `\nResponse formatting:\n${ai.aiResponseFormatting.trim()}`
    : `\nResponse formatting:
- Be concise but thorough
- Format with Markdown: headers, bullet points, tables, bold numbers
- Always cite your data source (which tool/query produced the numbers)
- When showing financial figures, use the correct currency (${config.currency})
- If a question is ambiguous, make a reasonable assumption and state it`;

  // ── Guardrails (safety rules, boundaries) ─────────────────
  const guardrails = ai?.aiGuardrails?.trim()
    ? `\nGuardrails:\n${ai.aiGuardrails.trim()}`
    : "";

  const base = `${personality}${environment}${tone}${goal}

${coreRole}

${terminology}${businessContext}

Tool usage guidelines:
${toolGuidelines}${queryReasoning}

${sqlDialect}${responseFormatting}${guardrails}${customToolsSection || ""}`;

  if (conversationSummary) {
    return `${base}\n\nCONVERSATION CONTEXT (rolling summary of earlier messages):\n${conversationSummary}\n\nUse this summary to maintain continuity. Do not ask the user to repeat information already discussed.`;
  }

  return base;
}

// ────────────────────────────────────────────────────────────
// Tools map
// ────────────────────────────────────────────────────────────

const staticTools = {
  query_database: queryDatabaseTool,
  run_analysis: createRunAnalysisTool(),
  analyze_trends: analyzeTrendsTool,
  generate_report: generateReportTool,
  search_knowledge: searchKnowledgeTool,
  get_business_snapshot: getBusinessSnapshotTool,
};

export type DataScienceTools = typeof staticTools;

// ────────────────────────────────────────────────────────────
// Dynamic Custom Tools — loaded from DB at request time
//
// Businesses define custom tools via the Settings UI. Two user-configurable types:
// - server: HTTP call to external URL (API endpoint)
// - client: structured action sent to frontend via SSE
//
// System tools (query_database, etc.) are built-in above.
// MCP tools are reserved for future Model Context Protocol support.
// ────────────────────────────────────────────────────────────

/**
 * Convert a JSON parameter schema to a Zod schema.
 * Supports basic types: string, number, boolean, with descriptions.
 */
function jsonSchemaToZod(
  paramSchema: Record<string, unknown>
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, def] of Object.entries(paramSchema)) {
    const fieldDef = def as Record<string, unknown>;
    const fieldType = (fieldDef.type as string) || "string";
    const description = (fieldDef.description as string) || "";
    const required = fieldDef.required !== false;

    let zodType: z.ZodTypeAny;
    switch (fieldType) {
      case "number":
        zodType = z.number().describe(description);
        break;
      case "boolean":
        zodType = z.boolean().describe(description);
        break;
      default:
        zodType = z.string().describe(description);
    }

    shape[key] = required ? zodType : zodType.optional();
  }

  // Always allow additional string params for flexibility
  return z.object(shape).passthrough();
}

/**
 * Build dynamic Vercel AI SDK tools from active custom tool definitions.
 * Returns a tools map that can be merged with the static tools.
 *
 * Two user-configurable tool types:
 * - server: makes HTTP request to configured endpoint (API call)
 * - client: returns structured action payload for the frontend (SSE)
 */
async function buildDynamicTools(): Promise<Record<string, any>> {
  let activeTools: CustomToolRow[];
  try {
    activeTools = await listActiveTools();
  } catch {
    return {};
  }

  if (activeTools.length === 0) return {};

  const dynamicTools: Record<string, any> = {};

  for (const customTool of activeTools) {
    const parameterSchema = jsonSchemaToZod(
      (customTool.parameterSchema as Record<string, unknown>) || {}
    );

    dynamicTools[customTool.name] = tool({
      description: customTool.description,
      parameters: parameterSchema,
      execute: async (params: Record<string, unknown>) => {
        try {
          return await executeTool(customTool, params);
        } catch (err: any) {
          return {
            error: `Custom tool "${customTool.label}" failed: ${err.message || String(err)}`,
          };
        }
      },
    });
  }

  return dynamicTools;
}

/**
 * Build a complete tools map: static built-in tools + dynamic custom tools.
 */
async function getAllTools(): Promise<Record<string, any>> {
  const dynamic = await buildDynamicTools();
  return { ...staticTools, ...dynamic };
}

/**
 * Build the custom tools section for the system prompt.
 * Informs the LLM about available custom tools so it knows when to use them.
 */
async function buildCustomToolsPromptSection(): Promise<string> {
  let activeTools: CustomToolRow[];
  try {
    activeTools = await listActiveTools();
  } catch {
    return "";
  }
  if (activeTools.length === 0) return "";

  const typeLabel: Record<string, string> = {
    server: "external API",
    client: "UI action",
  };

  const toolDescriptions = activeTools
    .map((t) => `- **${t.name}** (${typeLabel[t.toolType] || t.toolType}): ${t.description}`)
    .join("\n");

  return `\n\nCustom business tools (defined by this business):
${toolDescriptions}
Use these tools when relevant to the user's question. They extend your capabilities beyond the built-in tools.`;
}

// ────────────────────────────────────────────────────────────
// Conversation Context — rolling summary + recent messages
//
// Instead of just slicing the last N messages, we maintain
// a compressed summary of older conversation in the session's
// metadata.summary field. This gives the LLM full context
// without blowing up the token budget.
// ────────────────────────────────────────────────────────────

const RECENT_MESSAGE_COUNT = 12;
const SUMMARY_TRIGGER_THRESHOLD = 20;

/**
 * Build conversation context for a session.
 * Returns the rolling summary (if any) and recent messages.
 */
export async function getConversationContext(sessionId: string): Promise<{
  summary: string | undefined;
  recentMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
}> {
  // Load rolling summary from session metadata
  const session = await db.query.chatSessions.findFirst({
    where: eq(chatSessions.id, sessionId),
  });
  const summary =
    (session?.metadata as Record<string, unknown>)?.summary as
      | string
      | undefined;

  // Load recent messages (enough for immediate context)
  const messages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, sessionId),
    orderBy: [desc(chatMessages.createdAt)],
    limit: RECENT_MESSAGE_COUNT,
  });

  const recentMessages = messages
    .reverse()
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content || "",
    }));

  return { summary, recentMessages };
}

/**
 * Compress older messages into a rolling summary.
 * Called after each assistant response (non-blocking).
 *
 * Only triggers when the message count exceeds the threshold.
 * Uses a cheap/fast model (gpt-4o-mini) for compression.
 */
export async function maybeCompressSummary(
  sessionId: string
): Promise<void> {
  // Count total messages in session
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId));

  if (Number(count) < SUMMARY_TRIGGER_THRESHOLD) return;

  // Load the existing summary
  const session = await db.query.chatSessions.findFirst({
    where: eq(chatSessions.id, sessionId),
  });
  const existingSummary =
    (session?.metadata as Record<string, unknown>)?.summary as
      | string
      | undefined;

  // Load all messages except the most recent N (which stay as raw context)
  const allMessages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, sessionId),
    orderBy: [desc(chatMessages.createdAt)],
  });
  const olderMessages = allMessages
    .reverse()
    .slice(0, -RECENT_MESSAGE_COUNT)
    .filter((m) => m.role === "user" || m.role === "assistant");

  if (olderMessages.length < 5) return;

  // Build the text to compress
  const transcript = olderMessages
    .map((m) => `${m.role}: ${(m.content || "").slice(0, 500)}`)
    .join("\n");

  const compressPrompt = existingSummary
    ? `You are summarizing a business conversation. Here is the previous summary:\n\n${existingSummary}\n\nHere are additional messages since that summary:\n\n${transcript}\n\nProduce an updated summary that captures ALL key facts, decisions, data points, and context from the conversation. Be factual and concise. Use bullet points. Maximum 400 words.`
    : `You are summarizing a business conversation. Here are the messages:\n\n${transcript}\n\nProduce a concise summary capturing ALL key facts, decisions, data points, and context. Be factual. Use bullet points. Maximum 400 words.`;

  try {
    const { text } = await generateText({
      model: await getModel("gpt-4o-mini"),
      prompt: compressPrompt,
    });

    // Store in session metadata
    const currentMeta =
      (session?.metadata as Record<string, unknown>) || {};
    await db
      .update(chatSessions)
      .set({
        metadata: { ...currentMeta, summary: text },
        updatedAt: new Date(),
      })
      .where(eq(chatSessions.id, sessionId));
  } catch {
    // Non-critical — summary compression failure doesn't block the user
  }
}

// ────────────────────────────────────────────────────────────
// Agent definition (for non-streaming / direct agent.run())
// ────────────────────────────────────────────────────────────

export default createAgent("data-science", {
  schema: { input: inputSchema, output: outputSchema },
  handler: async (ctx, input) => {
    // Set sandbox API for the run_analysis tool to use
    _sandboxApi = ctx.sandbox;

    // Load client-customizable AI settings at request time
    const aiSettings = await getAISettings();

    // Build complete tool set: static built-in + dynamic custom tools
    const allTools = await getAllTools();
    const customToolsSection = await buildCustomToolsPromptSection();

    const messages: Array<{
      role: "user" | "assistant" | "system";
      content: string;
    }> = [];

    if (input.history?.length) {
      messages.push(...input.history.slice(-RECENT_MESSAGE_COUNT));
    }
    messages.push({ role: "user" as const, content: input.message });

    const result = await generateText({
      model: await getModel("gpt-4o"),
      system: buildSystemPrompt(undefined, aiSettings, customToolsSection),
      messages,
      tools: allTools,
      maxSteps: 8,
    });

    const collectedToolCalls: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
      output?: unknown;
      status: "pending" | "running" | "completed" | "error";
    }> = [];

    for (const step of result.steps) {
      if (step.toolCalls) {
        for (const tc of step.toolCalls) {
          const toolResult = step.toolResults?.find(
            (tr: any) => tr.toolCallId === tc.toolCallId
          );
          collectedToolCalls.push({
            id: tc.toolCallId,
            name: tc.toolName,
            input: tc.args as Record<string, unknown>,
            output: (toolResult as any)?.result,
            status: "completed" as const,
          });
        }
      }
    }

    // Persist assistant message
    try {
      await db.insert(chatMessages).values({
        sessionId: input.sessionId,
        role: "assistant",
        content: result.text,
        toolCalls: collectedToolCalls.length ? collectedToolCalls : undefined,
        metadata: {
          model: "gpt-4o",
          tokens: result.usage
            ? {
                prompt: result.usage.promptTokens,
                completion: result.usage.completionTokens,
              }
            : undefined,
        },
      });
    } catch (err) {
      ctx.logger.warn("Failed to persist assistant message to DB", {
        error: String(err),
      });
    }

    ctx.logger.info(
      `Data Science Assistant responded: ${collectedToolCalls.length} tool calls, ${result.text.length} chars`
    );

    return {
      text: result.text,
      toolCalls: collectedToolCalls.length ? collectedToolCalls : undefined,
    };
  },
});

// ────────────────────────────────────────────────────────────
// streamChat — streaming path used by the chat route
//
// The chat route calls this, iterates the fullStream, and
// emits SSE events to the session event bus. Persistence
// is handled by the chat route (NOT here — avoids the
// dual-write bug from the previous implementation).
// ────────────────────────────────────────────────────────────

export async function streamChat(
  message: string,
  sessionId: string,
  history?: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  conversationSummary?: string,
  sandboxApi?: any
) {
  // Set sandbox API for the run_analysis tool
  if (sandboxApi) _sandboxApi = sandboxApi;

  // Load client-customizable AI settings at request time
  const aiSettings = await getAISettings();

  // Build complete tool set: static built-in + dynamic custom tools from DB
  const allTools = await getAllTools();
  const customToolsSection = await buildCustomToolsPromptSection();

  const messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }> = [];

  if (history?.length) {
    messages.push(...history);
  }
  messages.push({ role: "user", content: message });

  return streamText({
    model: await getModel("gpt-4o"),
    system: buildSystemPrompt(conversationSummary, aiSettings, customToolsSection),
    messages,
    tools: allTools,
    maxSteps: 8,
  });
}
