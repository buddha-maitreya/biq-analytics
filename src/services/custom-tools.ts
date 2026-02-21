/**
 * Custom Tools Service
 *
 * CRUD operations for user-defined tools and execution.
 * Four tool types (aligned with ElevenLabs Agents taxonomy):
 *
 * 1. **Server** — External API calls (HTTP/REST). The AI invokes external
 *    endpoints with configurable URL, method, headers, auth, and params.
 *
 * 2. **Client** — Browser-side execution. The AI emits a structured action
 *    to the frontend via SSE for the UI to handle (display cards, navigate, etc.).
 *
 * 3. **System** — Built-in tools (query_database, analyze_trends, etc.).
 *    Defined in agent code, not stored in the custom_tools table.
 *
 * 4. **MCP** — Model Context Protocol servers (future).
 *    Reserved for MCP tool integrations.
 *
 * Only server and client tools are user-configurable via the Settings UI.
 */

import { db, customTools } from "@db/index";
import { eq, asc } from "drizzle-orm";
import { checkToolRateLimit } from "@lib/rate-limit";

// ── Types ──────────────────────────────────────────────────

export type ToolType = "server" | "client" | "system" | "mcp";

export interface CustomToolRow {
  id: string;
  toolType: ToolType;
  name: string;
  label: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  // Server tool fields (HTTP/API)
  webhookUrl: string | null;
  webhookMethod: string | null;
  webhookHeaders: Record<string, string> | null;
  webhookTimeoutSecs: number | null;
  authType: string | null;
  authConfig: Record<string, string> | null;
  pathParamsSchema: Array<Record<string, unknown>> | null;
  queryParamsSchema: Array<Record<string, unknown>> | null;
  requestBodySchema: Record<string, unknown> | null;
  // Client fields
  expectsResponse: boolean | null;
  // Shared behaviour (server + client)
  disableInterruptions: boolean | null;
  preToolSpeech: string | null;
  preToolSpeechText: string | null;
  executionMode: string | null;
  toolCallSound: string | null;
  dynamicVariables: Record<string, unknown> | null;
  dynamicVariableAssignments: Array<Record<string, unknown>> | null;
  // Common
  isActive: boolean;
  sortOrder: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateToolInput {
  toolType?: ToolType;
  name: string;
  label: string;
  description: string;
  parameterSchema?: Record<string, unknown>;
  // Server tool fields
  webhookUrl?: string;
  webhookMethod?: string;
  webhookHeaders?: Record<string, string>;
  webhookTimeoutSecs?: number;
  authType?: string;
  authConfig?: Record<string, string>;
  pathParamsSchema?: Array<Record<string, unknown>>;
  queryParamsSchema?: Array<Record<string, unknown>>;
  requestBodySchema?: Record<string, unknown>;
  // Client
  expectsResponse?: boolean;
  // Shared behaviour (server + client)
  disableInterruptions?: boolean;
  preToolSpeech?: string;
  preToolSpeechText?: string;
  executionMode?: string;
  toolCallSound?: string;
  dynamicVariables?: Record<string, unknown>;
  dynamicVariableAssignments?: Array<Record<string, unknown>>;
  // Common
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateToolInput extends Partial<CreateToolInput> {}

// ── CRUD ───────────────────────────────────────────────────

/** List all custom tools, ordered by sortOrder */
export async function listTools(): Promise<CustomToolRow[]> {
  const rows = await db.query.customTools.findMany({
    orderBy: [asc(customTools.sortOrder), asc(customTools.name)],
  });
  return rows as CustomToolRow[];
}

/** List tools filtered by toolType */
export async function listToolsByType(type: ToolType): Promise<CustomToolRow[]> {
  const rows = await db.query.customTools.findMany({
    where: eq(customTools.toolType, type),
    orderBy: [asc(customTools.sortOrder), asc(customTools.name)],
  });
  return rows as CustomToolRow[];
}

/** List only active tools (used by the agent at runtime) */
export async function listActiveTools(): Promise<CustomToolRow[]> {
  const rows = await db.query.customTools.findMany({
    where: eq(customTools.isActive, true),
    orderBy: [asc(customTools.sortOrder), asc(customTools.name)],
  });
  return rows as CustomToolRow[];
}

/** Get a single tool by ID */
export async function getToolById(id: string): Promise<CustomToolRow | null> {
  const row = await db.query.customTools.findFirst({
    where: eq(customTools.id, id),
  });
  return (row as CustomToolRow) ?? null;
}

/** Create a new custom tool */
export async function createTool(input: CreateToolInput): Promise<CustomToolRow> {
  const [row] = await db
    .insert(customTools)
    .values({
      toolType: input.toolType ?? "server",
      name: input.name,
      label: input.label,
      description: input.description,
      parameterSchema: input.parameterSchema ?? {},
      // Server tool fields
      webhookUrl: input.webhookUrl ?? "",
      webhookMethod: input.webhookMethod ?? "GET",
      webhookHeaders: input.webhookHeaders ?? {},
      webhookTimeoutSecs: input.webhookTimeoutSecs ?? 20,
      authType: input.authType ?? "none",
      authConfig: input.authConfig ?? {},
      pathParamsSchema: input.pathParamsSchema ?? [],
      queryParamsSchema: input.queryParamsSchema ?? [],
      requestBodySchema: input.requestBodySchema ?? {},
      // Client
      expectsResponse: input.expectsResponse ?? false,
      // Shared behaviour
      disableInterruptions: input.disableInterruptions ?? false,
      preToolSpeech: input.preToolSpeech ?? "auto",
      preToolSpeechText: input.preToolSpeechText ?? "",
      executionMode: input.executionMode ?? "immediate",
      toolCallSound: input.toolCallSound ?? "none",
      dynamicVariables: input.dynamicVariables ?? {},
      dynamicVariableAssignments: input.dynamicVariableAssignments ?? [],
      // Common
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return row as CustomToolRow;
}

/** Update an existing custom tool */
export async function updateTool(
  id: string,
  input: UpdateToolInput
): Promise<CustomToolRow | null> {
  const updates: Record<string, unknown> = {};
  if (input.toolType !== undefined) updates.toolType = input.toolType;
  if (input.name !== undefined) updates.name = input.name;
  if (input.label !== undefined) updates.label = input.label;
  if (input.description !== undefined) updates.description = input.description;
  if (input.parameterSchema !== undefined) updates.parameterSchema = input.parameterSchema;
  if (input.webhookUrl !== undefined) updates.webhookUrl = input.webhookUrl;
  if (input.webhookMethod !== undefined) updates.webhookMethod = input.webhookMethod;
  if (input.webhookHeaders !== undefined) updates.webhookHeaders = input.webhookHeaders;
  if (input.webhookTimeoutSecs !== undefined) updates.webhookTimeoutSecs = input.webhookTimeoutSecs;
  if (input.authType !== undefined) updates.authType = input.authType;
  if (input.authConfig !== undefined) updates.authConfig = input.authConfig;
  if (input.pathParamsSchema !== undefined) updates.pathParamsSchema = input.pathParamsSchema;
  if (input.queryParamsSchema !== undefined) updates.queryParamsSchema = input.queryParamsSchema;
  if (input.requestBodySchema !== undefined) updates.requestBodySchema = input.requestBodySchema;
  if (input.expectsResponse !== undefined) updates.expectsResponse = input.expectsResponse;
  if (input.disableInterruptions !== undefined) updates.disableInterruptions = input.disableInterruptions;
  if (input.preToolSpeech !== undefined) updates.preToolSpeech = input.preToolSpeech;
  if (input.preToolSpeechText !== undefined) updates.preToolSpeechText = input.preToolSpeechText;
  if (input.executionMode !== undefined) updates.executionMode = input.executionMode;
  if (input.toolCallSound !== undefined) updates.toolCallSound = input.toolCallSound;
  if (input.dynamicVariables !== undefined) updates.dynamicVariables = input.dynamicVariables;
  if (input.dynamicVariableAssignments !== undefined) updates.dynamicVariableAssignments = input.dynamicVariableAssignments;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  if (Object.keys(updates).length === 0) {
    return getToolById(id);
  }

  const [row] = await db
    .update(customTools)
    .set(updates)
    .where(eq(customTools.id, id))
    .returning();
  return (row as CustomToolRow) ?? null;
}

/** Delete a custom tool */
export async function deleteTool(id: string): Promise<boolean> {
  const result = await db.delete(customTools).where(eq(customTools.id, id)).returning();
  return result.length > 0;
}

// ── Server Tool Execution ──────────────────────────────────

/**
 * Execute a server tool by making an HTTP request to the configured endpoint.
 *
 * Supports:
 * - Authentication (api_key, bearer, basic, oauth2)
 * - Path parameter interpolation (e.g. /users/{user_id})
 * - Query parameters (merged from schema defaults + LLM params)
 * - Request body schema for POST/PUT/PATCH
 * - Dynamic variable substitution in URL, headers, and body
 *
 * @param tool - The tool definition (must have webhookUrl set)
 * @param params - Parameters passed by the LLM — sent as JSON body for POST/PUT/PATCH,
 *                 or as query params for GET/DELETE
 * @returns Parsed JSON response, or an error object
 */
export async function executeServerTool(
  tool: CustomToolRow,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!tool.webhookUrl) {
    return { error: `Server tool "${tool.label}" has no URL configured` };
  }

  const method = (tool.webhookMethod || "GET").toUpperCase();
  const timeoutMs = (tool.webhookTimeoutSecs ?? 20) * 1000;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(tool.webhookHeaders as Record<string, string> ?? {}),
  };

  // ── Authentication ──
  const authType = tool.authType ?? "none";
  const authCfg = (tool.authConfig ?? {}) as Record<string, string>;
  if (authType === "bearer" && authCfg.token) {
    headers["Authorization"] = `Bearer ${authCfg.token}`;
  } else if (authType === "api_key" && authCfg.headerName && authCfg.apiKey) {
    headers[authCfg.headerName] = authCfg.apiKey;
  } else if (authType === "basic" && authCfg.username) {
    const encoded = btoa(`${authCfg.username}:${authCfg.password ?? ""}`);
    headers["Authorization"] = `Basic ${encoded}`;
  }
  // OAuth2 with automatic token refresh
  if (authType === "oauth2") {
    let accessToken = authCfg.accessToken;
    const expiresAt = authCfg.tokenExpiresAt ? Number(authCfg.tokenExpiresAt) : 0;
    const needsRefresh = !accessToken || (expiresAt > 0 && Date.now() >= expiresAt - 30_000);

    if (needsRefresh && authCfg.refreshToken && authCfg.tokenUrl) {
      try {
        const refreshHeaders: Record<string, string> = {
          "Content-Type": "application/x-www-form-urlencoded",
        };
        // Client credentials for token endpoint (Basic auth)
        if (authCfg.clientId && authCfg.clientSecret) {
          refreshHeaders["Authorization"] = `Basic ${btoa(`${authCfg.clientId}:${authCfg.clientSecret}`)}`;
        }
        const body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: authCfg.refreshToken,
          ...(authCfg.clientId && !authCfg.clientSecret ? { client_id: authCfg.clientId } : {}),
        });
        const tokenRes = await fetch(authCfg.tokenUrl, {
          method: "POST",
          headers: refreshHeaders,
          body: body.toString(),
        });
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          accessToken = tokenData.access_token;
          // Persist refreshed tokens back to the tool's authConfig
          const updatedConfig = { ...authCfg };
          updatedConfig.accessToken = tokenData.access_token;
          if (tokenData.refresh_token) updatedConfig.refreshToken = tokenData.refresh_token;
          if (tokenData.expires_in) {
            updatedConfig.tokenExpiresAt = String(Date.now() + tokenData.expires_in * 1000);
          }
          // Fire-and-forget DB update for persisted token
          db.update(customTools)
            .set({ authConfig: updatedConfig })
            .where(eq(customTools.id, tool.id))
            .catch(() => {});
        }
      } catch {
        // Token refresh failed — try with existing token
      }
    }

    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }
  }

  // ── Dynamic variable resolution ──
  const dynVarValues: Record<string, string> = {};
  const assignments = (tool.dynamicVariableAssignments ?? []) as Array<{ var: string; source: string; default?: string }>;
  for (const asgn of assignments) {
    // For now, resolve from params or use default
    const val = params[asgn.var] ?? params[asgn.source] ?? asgn.default ?? "";
    dynVarValues[asgn.var] = String(val);
  }

  // Helper to substitute {{var}} placeholders
  const interpolate = (str: string): string =>
    str.replace(/\{\{(\w+)\}\}/g, (_, key) => dynVarValues[key] ?? params[key] as string ?? "");

  // ── Path parameter interpolation ──
  let url = interpolate(tool.webhookUrl);
  const pathParams = (tool.pathParamsSchema ?? []) as Array<{ name: string; default?: string }>;
  for (const pp of pathParams) {
    const val = params[pp.name] ?? dynVarValues[pp.name] ?? pp.default ?? "";
    url = url.replace(`{${pp.name}}`, encodeURIComponent(String(val)));
  }

  // ── Query parameters ──
  let body: string | undefined;
  if (method === "GET" || method === "DELETE") {
    const qs = new URLSearchParams();
    // Start with schema-defined query params (defaults)
    const qpSchema = (tool.queryParamsSchema ?? []) as Array<{ name: string; required?: boolean; default?: string }>;
    for (const qp of qpSchema) {
      const val = params[qp.name] ?? dynVarValues[qp.name] ?? qp.default;
      if (val !== undefined && val !== null && val !== "") qs.set(qp.name, String(val));
    }
    // Add remaining params not already in query
    for (const [k, v] of Object.entries(params)) {
      if (!qs.has(k)) qs.set(k, String(v));
    }
    const qsStr = qs.toString();
    if (qsStr) url += (url.includes("?") ? "&" : "?") + qsStr;
  } else {
    // POST/PUT/PATCH — use request body
    body = interpolate(JSON.stringify(params));
  }

  // Interpolate headers too
  for (const [k, v] of Object.entries(headers)) {
    headers[k] = interpolate(v);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    const text = await res.text();

    if (!res.ok) {
      return {
        error: `Server tool "${tool.label}" returned HTTP ${res.status}`,
        status: res.status,
        body: text.slice(0, 500),
      };
    }

    // Try to parse as JSON
    try {
      return JSON.parse(text);
    } catch {
      return { output: text.slice(0, 2000) };
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { error: `Server tool "${tool.label}" timed out after ${timeoutMs}ms` };
    }
    return { error: `Server tool execution failed: ${err.message || String(err)}` };
  }
}

// ── Client Tool Execution ──────────────────────────────────

/**
 * Build a client-side action payload for a client tool.
 *
 * Client tools don't execute on the server — instead, they produce a
 * structured action object that the chat route sends to the frontend
 * via SSE. The frontend UI handles the actual rendering/action.
 *
 * @param tool - The tool definition (type=client)
 * @param params - Parameters from the LLM
 * @returns A structured action payload for the frontend
 */
export function buildClientToolAction(
  tool: CustomToolRow,
  params: Record<string, unknown>
): Record<string, unknown> {
  return {
    __clientAction: true,
    toolName: tool.name,
    toolLabel: tool.label,
    description: tool.description,
    params,
    expectsResponse: tool.expectsResponse ?? false,
  };
}

// ── Unified Dispatcher ─────────────────────────────────────

/**
 * Execute a custom tool based on its type.
 *
 * - server → makes HTTP request to external URL (API call)
 * - client → returns a structured UI action payload (no server-side execution)
 *
 * System and MCP tools are handled by the agent directly, not through this dispatcher.
 *
 * @param tool - The tool definition
 * @param params - Parameters from the LLM
 */
export async function executeTool(
  tool: CustomToolRow,
  params: Record<string, unknown>,
  userId?: string
): Promise<Record<string, unknown>> {
  // Rate limit check for server tools (configurable per-tool)
  if (tool.toolType === "server" && userId) {
    const maxPerDay = (tool as any).rateLimitMax ?? 100;
    const { allowed, remaining } = checkToolRateLimit(tool.id, userId, maxPerDay);
    if (!allowed) {
      return {
        error: `Rate limit exceeded for tool "${tool.label}". Try again later.`,
        rateLimited: true,
        remaining,
      };
    }
  }

  switch (tool.toolType) {
    case "server":
      return executeServerTool(tool, params);

    case "client":
      return buildClientToolAction(tool, params);

    default:
      return { error: `Unsupported tool type "${tool.toolType}" for tool "${tool.label}"` };
  }
}

// ── Default Starter Tools ──────────────────────────────────
//
// Industry-agnostic tool templates that demonstrate the system.
// URLs are placeholders — each deployment configures their own
// endpoints via the Admin Console.
// ──────────────────────────────────────────────────────────

const DEFAULT_TOOLS: CreateToolInput[] = [
  // ── SERVER TOOLS (external API calls) ─────────────────────

  {
    toolType: "server",
    name: "send_webhook_notification",
    label: "Send Webhook Notification",
    description:
      "Send a notification to an external webhook endpoint (Slack, Discord, Microsoft Teams, Zapier, Make, n8n, etc.). Use when the user asks to notify a channel, send an alert, or trigger an external automation.",
    parameterSchema: {
      message: {
        type: "string",
        description: "The notification message text to send",
        required: true,
      },
      channel: {
        type: "string",
        description: "Target channel or topic (optional — depends on webhook config)",
      },
      priority: {
        type: "string",
        description: "Priority level: low, normal, high, urgent",
      },
    },
    webhookUrl: "https://hooks.example.com/webhook",
    webhookMethod: "POST",
    webhookHeaders: { "Content-Type": "application/json" },
    webhookTimeoutSecs: 10,
    authType: "none",
    authConfig: {},
    executionMode: "immediate",
    isActive: false, // Inactive until user configures their URL
    sortOrder: 1,
  },

  {
    toolType: "server",
    name: "send_email",
    label: "Send Email",
    description:
      "Send an email via the configured email API (SendGrid, Resend, Mailgun, Postmark, etc.). Use when the user asks to email a customer, send a report by email, or send a notification email.",
    parameterSchema: {
      to: {
        type: "string",
        description: "Recipient email address",
        required: true,
      },
      subject: {
        type: "string",
        description: "Email subject line",
        required: true,
      },
      body: {
        type: "string",
        description: "Email body content (plain text or HTML)",
        required: true,
      },
    },
    webhookUrl: "https://api.example.com/v1/emails/send",
    webhookMethod: "POST",
    webhookHeaders: { "Content-Type": "application/json" },
    webhookTimeoutSecs: 15,
    authType: "bearer",
    authConfig: { token: "" },
    executionMode: "confirm",
    isActive: false,
    sortOrder: 2,
  },

  {
    toolType: "server",
    name: "send_sms",
    label: "Send SMS",
    description:
      "Send an SMS text message to a phone number via the configured SMS provider (Twilio, Africa's Talking, Vonage, etc.). Use when the user asks to text a customer or send an SMS alert.",
    parameterSchema: {
      to: {
        type: "string",
        description: "Recipient phone number in international format (e.g. +254712345678)",
        required: true,
      },
      message: {
        type: "string",
        description: "SMS message text (max 160 characters for single SMS)",
        required: true,
      },
    },
    webhookUrl: "https://api.example.com/v1/sms/send",
    webhookMethod: "POST",
    webhookHeaders: { "Content-Type": "application/json" },
    webhookTimeoutSecs: 15,
    authType: "api_key",
    authConfig: { headerName: "X-API-Key", apiKey: "" },
    executionMode: "confirm",
    isActive: false,
    sortOrder: 3,
  },

  {
    toolType: "server",
    name: "check_external_price",
    label: "Check External Price",
    description:
      "Look up current pricing from an external pricing system, supplier API, or price comparison service. Use when the user asks about supplier prices, market rates, or wants to compare pricing.",
    parameterSchema: {
      query: {
        type: "string",
        description: "Product name, SKU, or search term to look up",
        required: true,
      },
      supplier: {
        type: "string",
        description: "Specific supplier to check (optional)",
      },
    },
    webhookUrl: "https://api.example.com/v1/pricing/lookup",
    webhookMethod: "GET",
    webhookHeaders: {},
    webhookTimeoutSecs: 20,
    authType: "bearer",
    authConfig: { token: "" },
    executionMode: "immediate",
    isActive: false,
    sortOrder: 4,
  },

  {
    toolType: "server",
    name: "sync_to_accounting",
    label: "Sync to Accounting System",
    description:
      "Push financial data (invoices, payments, expenses) to the external accounting system (QuickBooks, Xero, Zoho Books, etc.). Use when the user asks to sync data, export to accounting, or reconcile.",
    parameterSchema: {
      recordType: {
        type: "string",
        description: "Type of record to sync: invoice, payment, expense, credit_note",
        required: true,
      },
      recordId: {
        type: "string",
        description: "The ID of the record to sync",
        required: true,
      },
    },
    webhookUrl: "https://api.example.com/v1/accounting/sync",
    webhookMethod: "POST",
    webhookHeaders: { "Content-Type": "application/json" },
    webhookTimeoutSecs: 30,
    authType: "oauth2",
    authConfig: { accessToken: "" },
    executionMode: "confirm",
    isActive: false,
    sortOrder: 5,
  },

  {
    toolType: "server",
    name: "check_delivery_status",
    label: "Check Delivery Status",
    description:
      "Check the delivery/shipping status of an order from the logistics provider (DHL, FedEx, local courier, etc.). Use when the user asks about order delivery, tracking, or shipment status.",
    parameterSchema: {
      trackingNumber: {
        type: "string",
        description: "Tracking number or order reference",
        required: true,
      },
      carrier: {
        type: "string",
        description: "Carrier/courier name (optional — auto-detected if not specified)",
      },
    },
    webhookUrl: "https://api.example.com/v1/tracking/{trackingNumber}",
    webhookMethod: "GET",
    webhookHeaders: {},
    webhookTimeoutSecs: 15,
    authType: "api_key",
    authConfig: { headerName: "X-API-Key", apiKey: "" },
    pathParamsSchema: [
      { name: "trackingNumber", description: "The tracking number to look up", required: true },
    ],
    executionMode: "immediate",
    isActive: false,
    sortOrder: 6,
  },

  // ── CLIENT TOOLS (browser-side actions) ───────────────────

  {
    toolType: "client",
    name: "navigate_to_page",
    label: "Navigate to Page",
    description:
      "Navigate the user to a specific page in the platform. Use when the user mentions wanting to see a page, go somewhere, or you want to direct them to relevant content after answering their question. Available pages: dashboard, products, orders, customers, inventory, invoices, pos, reports, settings, admin.",
    parameterSchema: {
      page: {
        type: "string",
        description: "Page identifier: dashboard, products, orders, customers, inventory, invoices, pos, reports, settings, admin",
        required: true,
      },
      message: {
        type: "string",
        description: "Optional message to show after navigation",
      },
    },
    expectsResponse: false,
    executionMode: "immediate",
    isActive: true,
    sortOrder: 10,
  },

  {
    toolType: "client",
    name: "show_data_card",
    label: "Show Data Card",
    description:
      "Display a rich, interactive data card in the chat (product details, customer profile, order summary, etc.). Use when you want to present structured data visually rather than just as text. The frontend renders the card with appropriate formatting.",
    parameterSchema: {
      cardType: {
        type: "string",
        description: "Type of card: product, customer, order, invoice, alert, metric",
        required: true,
      },
      title: {
        type: "string",
        description: "Card title/heading",
        required: true,
      },
      data: {
        type: "string",
        description: "JSON string of key-value pairs to display in the card",
        required: true,
      },
      actions: {
        type: "string",
        description: "JSON array of action buttons, e.g. [{\"label\": \"View Details\", \"page\": \"products\"}]",
      },
    },
    expectsResponse: false,
    executionMode: "immediate",
    isActive: true,
    sortOrder: 11,
  },

  {
    toolType: "client",
    name: "generate_export",
    label: "Generate Export",
    description:
      "Trigger a data export/download in the browser. The frontend generates the file (CSV, PDF, Excel) from the provided data. Use when the user asks to export, download, or save data to a file.",
    parameterSchema: {
      format: {
        type: "string",
        description: "Export format: csv, pdf, json",
        required: true,
      },
      title: {
        type: "string",
        description: "Export file title/name",
        required: true,
      },
      data: {
        type: "string",
        description: "JSON string of the data to export (array of objects for CSV, or report content for PDF)",
        required: true,
      },
    },
    expectsResponse: false,
    executionMode: "immediate",
    isActive: true,
    sortOrder: 12,
  },

  {
    toolType: "client",
    name: "create_quick_order",
    label: "Create Quick Order",
    description:
      "Open the POS (point-of-sale) page with pre-filled items to create a quick order. Use when the user says things like 'create an order for...', 'ring up...', or 'add to cart...'. Pre-fills the order form so the user just needs to confirm.",
    parameterSchema: {
      customerName: {
        type: "string",
        description: "Customer name to pre-select (optional)",
      },
      items: {
        type: "string",
        description: "JSON array of items to add, e.g. [{\"productName\": \"Widget\", \"quantity\": 2}]",
        required: true,
      },
    },
    expectsResponse: false,
    executionMode: "confirm",
    isActive: true,
    sortOrder: 13,
  },

  {
    toolType: "client",
    name: "show_alert",
    label: "Show Alert",
    description:
      "Display a prominent alert banner or toast notification in the platform UI. Use when you need to draw the user's attention to something important — a critical stock warning, a deadline approaching, or an action confirmation.",
    parameterSchema: {
      severity: {
        type: "string",
        description: "Alert severity: info, success, warning, error",
        required: true,
      },
      title: {
        type: "string",
        description: "Alert title/heading",
        required: true,
      },
      message: {
        type: "string",
        description: "Alert message body",
        required: true,
      },
    },
    expectsResponse: false,
    executionMode: "immediate",
    isActive: true,
    sortOrder: 14,
  },
];

/**
 * Seed default starter tools (idempotent — skips tools whose name already exists).
 * Returns the count of newly created tools.
 */
export async function seedDefaultTools(): Promise<number> {
  let created = 0;
  for (const def of DEFAULT_TOOLS) {
    const existing = await db.query.customTools.findFirst({
      where: eq(customTools.name, def.name),
    });
    if (!existing) {
      await createTool(def);
      created++;
    }
  }
  return created;
}

/** Get the list of default tool names (for display in UI) */
export const DEFAULT_TOOL_NAMES = DEFAULT_TOOLS.map((t) => t.name);

// ── MCP Integration Tools ──────────────────────────────────
//
// Pre-configured Model Context Protocol integrations.
// These call external APIs directly and are tagged as "mcp" type
// so the UI can display them in a separate section.
// ──────────────────────────────────────────────────────────

const DEFAULT_MCP_TOOLS: CreateToolInput[] = [
  {
    toolType: "mcp",
    name: "mcp_weather",
    label: "Weather Data",
    description:
      "Get current weather conditions and forecast for any location. Uses Open-Meteo (free, no API key required). " +
      "Use when the user asks about weather, temperature, rain forecasts, or when weather context is relevant to business operations (e.g. safari conditions, outdoor events).",
    parameterSchema: {
      location: {
        type: "string",
        description: "City or location name (e.g. 'Nairobi', 'Masai Mara', 'Diani Beach')",
        required: true,
      },
    },
    webhookUrl: "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto",
    webhookMethod: "GET",
    webhookHeaders: {},
    webhookTimeoutSecs: 10,
    authType: "none",
    authConfig: {},
    executionMode: "immediate",
    isActive: true,
    sortOrder: 100,
    metadata: {
      mcpType: "weather",
      location: "Nairobi",
      description: "Open-Meteo weather API — free, no API key needed",
    },
  },
  {
    toolType: "mcp",
    name: "mcp_nse_stocks",
    label: "NSE Stock Market",
    description:
      "Look up current stock prices and market data from the Nairobi Securities Exchange (NSE) and global markets. " +
      "Uses Marketstack API. Use when the user asks about stock prices, market data, or financial market conditions.",
    parameterSchema: {
      symbol: {
        type: "string",
        description: "Stock ticker symbol (e.g. 'SCOM' for Safaricom, 'EQTY' for Equity Bank, 'KCB' for KCB Group)",
        required: true,
      },
    },
    webhookUrl: "http://api.marketstack.com/v1/eod/latest?access_key={apiKey}&symbols={symbol}.XNAI",
    webhookMethod: "GET",
    webhookHeaders: {},
    webhookTimeoutSecs: 15,
    authType: "api_key",
    authConfig: { headerName: "X-API-Key", apiKey: "" },
    executionMode: "immediate",
    isActive: false, // Inactive until user provides API key
    sortOrder: 101,
    metadata: {
      mcpType: "stocks",
      defaultSymbol: "SCOM",
      exchange: "XNAI",
      description: "Marketstack API — requires free API key from marketstack.com",
    },
  },
];

/**
 * Seed MCP integration tools (idempotent — skips tools whose name already exists).
 * Returns the count of newly created tools.
 */
export async function seedMcpTools(): Promise<number> {
  let created = 0;
  for (const def of DEFAULT_MCP_TOOLS) {
    const existing = await db.query.customTools.findFirst({
      where: eq(customTools.name, def.name),
    });
    if (!existing) {
      await createTool(def);
      created++;
    }
  }
  return created;
}
