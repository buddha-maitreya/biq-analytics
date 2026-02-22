/**
 * Unified Prompt Builder — Phase 7.1
 *
 * Shared prompt construction utilities used by all agents.
 * Provides:
 *   - `injectLabels(template)` — replaces {{PLACEHOLDER}} tokens with config labels
 *   - `terminologySection()` — standard terminology block for system prompts
 *   - `defaultGuardrails()` — built-in safety guardrails (always present)
 *   - `formattingSection(custom?)` — response formatting instructions
 *   - `buildAgentPrompt(sections)` — assembles ordered sections into a final prompt
 *
 * All agents should use these utilities instead of duplicating
 * terminology, guardrails, and formatting blocks.
 */

import { config } from "@lib/config";

// ── Label Injection ────────────────────────────────────────

/**
 * Label placeholders recognized by `injectLabels()`.
 * Maps template tokens to `config` values.
 */
const LABEL_MAP: Record<string, string> = {
  "{{PRODUCT_LABEL}}": config.labels.product,
  "{{PRODUCT_LABEL_PLURAL}}": config.labels.productPlural,
  "{{ORDER_LABEL}}": config.labels.order,
  "{{ORDER_LABEL_PLURAL}}": config.labels.orderPlural,
  "{{CUSTOMER_LABEL}}": config.labels.customer,
  "{{CUSTOMER_LABEL_PLURAL}}": config.labels.customerPlural,
  "{{WAREHOUSE_LABEL}}": config.labels.warehouse,
  "{{INVOICE_LABEL}}": config.labels.invoice,
  "{{UNIT_DEFAULT}}": config.labels.unitDefault,
  "{{CURRENCY}}": config.currency,
  "{{COMPANY_NAME}}": config.companyName,
  "{{TIMEZONE}}": config.timezone,
};

/**
 * Pre-compiled regex matching all `{{LABEL}}` placeholders.
 * Case-sensitive, matches exact tokens only.
 */
const LABEL_RE = new RegExp(
  Object.keys(LABEL_MAP)
    .map((k) => k.replace(/[{}]/g, "\\$&"))
    .join("|"),
  "g"
);

/**
 * Replace all `{{LABEL}}` placeholders in a template string with
 * the deployment's configured label values.
 *
 * @example
 * injectLabels("Top {{PRODUCT_LABEL_PLURAL}} by revenue")
 * // → "Top Products by revenue"  (or "Top Menu Items by revenue" etc.)
 */
export function injectLabels(template: string): string {
  return template.replace(LABEL_RE, (match) => LABEL_MAP[match] ?? match);
}

// ── Reusable Prompt Sections ───────────────────────────────

/**
 * Standard terminology block for system prompts.
 * Tells the LLM what this deployment calls its entities.
 */
export function terminologySection(): string {
  return `Terminology for this deployment:
- Products are called "${config.labels.product}" / "${config.labels.productPlural}"
- Orders are called "${config.labels.order}" / "${config.labels.orderPlural}"
- Customers are called "${config.labels.customer}" / "${config.labels.customerPlural}"
- Warehouses are called "${config.labels.warehouse}"
- Invoices are called "${config.labels.invoice}"
- Currency: ${config.currency}
- Default unit of measure: ${config.labels.unitDefault}`;
}

/**
 * Built-in safety guardrails that are ALWAYS present in the system prompt,
 * regardless of whether custom guardrails are configured.
 *
 * Custom guardrails from DB settings are appended AFTER these defaults.
 */
export function defaultGuardrails(customText?: string): string {
  const builtin = `Guardrails:
- Never execute or suggest SQL that modifies data (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE). All database access is read-only.
- Never reveal raw database credentials, connection strings, API keys, or internal infrastructure details.
- Never fabricate data. If you don't have the information, say so. Cite which tool or query produced each number.
- Protect personally identifiable information (PII): do not expose full email addresses, phone numbers, or payment details in chat responses. Use masking (e.g., j***@example.com) when referencing PII.
- Stay within the scope of business data analysis and operations. Politely decline requests unrelated to the business platform.
- If a question is ambiguous, state your assumptions before answering rather than guessing silently.`;

  if (customText?.trim()) {
    return `${builtin}\n\nAdditional guardrails (deployment-specific):\n${customText.trim()}`;
  }
  return builtin;
}

/**
 * Standard response formatting instructions.
 * Can be overridden per-deployment via DB settings.
 */
export function formattingSection(customFormatting?: string): string {
  if (customFormatting?.trim()) {
    return `Response formatting:\n${customFormatting.trim()}`;
  }
  return `Response formatting:
- Be concise but thorough
- Format with Markdown: headers, bullet points, tables, bold numbers
- Always cite your data source (which tool/query produced the numbers)
- When showing financial figures, use the correct currency (${config.currency})
- If a question is ambiguous, make a reasonable assumption and state it`;
}

// ── Prompt Section Assembly ────────────────────────────────

/**
 * A named section of a system prompt.
 * Sections are assembled in array order with blank-line separators.
 */
export interface PromptSection {
  /** Section identifier (for debugging / logging, not included in output) */
  label: string;
  /** The text content of this section. Empty/undefined sections are skipped. */
  content?: string;
}

/**
 * Assemble an ordered array of `PromptSection` items into a single
 * system prompt string. Empty sections are silently skipped.
 * Sections are joined with double newlines for clean separation.
 *
 * @example
 * buildAgentPrompt([
 *   { label: "personality", content: "You are a helpful assistant." },
 *   { label: "terminology", content: terminologySection() },
 *   { label: "guardrails", content: defaultGuardrails() },
 * ])
 */
export function buildAgentPrompt(sections: PromptSection[]): string {
  return sections
    .filter((s) => s.content?.trim())
    .map((s) => s.content!.trim())
    .join("\n\n");
}

/**
 * SQL dialect reminder — always present for agents that write SQL.
 * Prevents common MySQL-ism mistakes.
 */
export const SQL_DIALECT_SECTION = `CRITICAL — SQL dialect:
- The database is PostgreSQL. NEVER use MySQL syntax.
- Date intervals: NOW() - INTERVAL '30 days' (NOT DATE_SUB/DATE_ADD)
- String aggregation: STRING_AGG() (NOT GROUP_CONCAT)
- Case-insensitive match: ILIKE (NOT LOWER() + LIKE)
- Boolean literals: TRUE/FALSE (NOT 1/0)`;

// ── Config-Driven Routing ──────────────────────────────────

/**
 * A single routing example: maps a user query pattern to
 * one or more tool calls and an execution strategy.
 */
export interface RoutingExample {
  /** Example user query (natural language) */
  query: string;
  /** Tool(s) to invoke */
  tools: string[];
  /** "parallel" | "sequential" | "direct" */
  strategy: "parallel" | "sequential" | "direct";
  /** Human-readable routing rationale */
  rationale: string;
}

/**
 * Default routing examples. The orchestrator uses these to decide
 * which tool(s) to invoke for a given user query. Deployments can
 * override or extend these via `agent_configs.config.routingExamples`.
 */
export const DEFAULT_ROUTING_EXAMPLES: RoutingExample[] = [
  // Strategy demonstrations only — teach HOW to execute, not WHERE to route.
  // The agent reasons about tool selection independently via the understanding-first protocol.
  {
    query: "Do X and also do Y",
    tools: ["<tool-for-X>", "<tool-for-Y>"],
    strategy: "parallel",
    rationale: "Independent tasks — run concurrently in the same step for speed",
  },
  {
    query: "Do X, then use those results to do Y",
    tools: ["<tool-for-X>", "<tool-for-Y>"],
    strategy: "sequential",
    rationale: "Y depends on X's output — must run across separate steps",
  },
  {
    query: "Do X",
    tools: ["<tool-for-X>"],
    strategy: "direct",
    rationale: "Single clear intent — one tool call",
  },
];

/**
 * Build the routing heuristic section from structured examples.
 * Generates the ROUTING HEURISTIC block for the orchestrator system prompt.
 *
 * @param examples — routing examples (default + custom merged)
 */
export function buildRoutingSection(examples: RoutingExample[]): string {
  const lines = examples.map((ex) => {
    const toolStr = ex.tools.join(" + ");
    const strategyLabel =
      ex.strategy === "parallel"
        ? " (PARALLEL — same step)"
        : ex.strategy === "sequential"
          ? " (SEQUENTIAL — two steps)"
          : "";
    return `- "${ex.query}" -> ${toolStr}${strategyLabel}`;
  });

  return `ROUTING HEURISTIC:\n${lines.join("\n")}`;
}

/**
 * Merge custom routing examples with defaults.
 * Custom examples with matching `query` text override defaults.
 * Custom examples with new queries are appended.
 */
export function mergeRoutingExamples(
  defaults: RoutingExample[],
  custom: RoutingExample[]
): RoutingExample[] {
  const map = new Map<string, RoutingExample>();
  for (const ex of defaults) map.set(ex.query.toLowerCase(), ex);
  for (const ex of custom) map.set(ex.query.toLowerCase(), ex);
  return Array.from(map.values());
}
