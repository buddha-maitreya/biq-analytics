/**
 * Custom Tools Service
 *
 * CRUD operations for user-defined tools and execution.
 * Three tool types are supported:
 *
 * 1. **Sandbox** — Code runs in an isolated Agentuity sandbox (bun:1/node/python).
 *    Uses ctx.sandbox.run() for one-shot execution.
 *
 * 2. **Webhook** — AI invokes an external HTTP endpoint.
 *    Uses fetch() with configurable URL, method, headers, and timeout.
 *
 * 3. **Client** — AI emits a UI action (display card, navigate, show notification).
 *    The result is sent to the frontend via SSE for the UI to handle.
 */

import { db, customTools } from "@db/index";
import { eq, asc } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────

export type ToolType = "sandbox" | "webhook" | "client";

export interface CustomToolRow {
  id: string;
  toolType: ToolType;
  name: string;
  label: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  // Sandbox fields
  code: string;
  runtime: string;
  timeoutMs: number;
  networkEnabled: boolean;
  // Webhook fields
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
  // Shared behaviour (webhook + client)
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
  // Sandbox
  code?: string;
  runtime?: string;
  timeoutMs?: number;
  networkEnabled?: boolean;
  // Webhook
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
  // Shared behaviour (webhook + client)
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
      toolType: input.toolType ?? "sandbox",
      name: input.name,
      label: input.label,
      description: input.description,
      parameterSchema: input.parameterSchema ?? {},
      // Sandbox
      code: input.code ?? "",
      runtime: input.runtime ?? "bun:1",
      timeoutMs: input.timeoutMs ?? 30000,
      networkEnabled: input.networkEnabled ?? false,
      // Webhook
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
  if (input.code !== undefined) updates.code = input.code;
  if (input.runtime !== undefined) updates.runtime = input.runtime;
  if (input.timeoutMs !== undefined) updates.timeoutMs = input.timeoutMs;
  if (input.networkEnabled !== undefined) updates.networkEnabled = input.networkEnabled;
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

// ── Sandbox Execution ──────────────────────────────────────

/**
 * Build the execution script for a custom tool.
 *
 * The tool code runs inside a bun:1 sandbox. We wrap the user's code
 * in a standard harness that:
 * 1. Parses the input params from a JSON env var
 * 2. Calls the user's function
 * 3. Outputs the result as JSON to stdout
 *
 * The user's code should export or define a function called `execute`
 * that receives (params) and returns a result.
 */
export function buildSandboxScript(
  toolCode: string,
  params: Record<string, unknown>
): string {
  // Escape the JSON params and code for safe embedding
  const paramsJson = JSON.stringify(params);

  // The harness wraps the user code and calls it
  return `
// ── Sandbox harness ──
const __params = ${paramsJson};

// User-defined tool code (inlined)
${toolCode}

// Execute and output result
(async () => {
  try {
    if (typeof execute !== 'function') {
      console.log(JSON.stringify({ error: "Tool must define an 'execute' function" }));
      process.exit(1);
    }
    const result = await execute(__params);
    console.log(JSON.stringify(result ?? { success: true }));
  } catch (err) {
    console.log(JSON.stringify({ error: String(err.message || err) }));
    process.exit(1);
  }
})();
`.trim();
}

/**
 * Execute a custom tool in an Agentuity sandbox.
 *
 * @param sandbox - The sandbox API (ctx.sandbox from an agent context)
 * @param tool - The tool definition from the database
 * @param params - The parameters passed by the LLM
 * @returns Parsed JSON result from the tool, or an error object
 */
export async function executeToolInSandbox(
  sandbox: { run: (opts: Record<string, unknown>) => Promise<{ stdout: string; stderr: string; exitCode: number }> },
  tool: CustomToolRow,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const script = buildSandboxScript(tool.code, params);

  try {
    const result = await sandbox.run({
      runtime: tool.runtime || "bun:1",
      command: `bun eval ${JSON.stringify(script)}`,
      timeout: { execution: tool.timeoutMs || 30000 },
      network: { enabled: tool.networkEnabled ?? false },
      resources: {
        memory: "256MB",
        cpu: 1,
        disk: "256MB",
      },
    });

    if (result.exitCode !== 0) {
      return {
        error: `Tool "${tool.label}" failed (exit code ${result.exitCode})`,
        stderr: result.stderr?.slice(0, 500) || "",
      };
    }

    // Parse stdout as JSON
    const stdout = result.stdout?.trim() || "";
    try {
      return JSON.parse(stdout);
    } catch {
      // If output isn't valid JSON, return it as text
      return { output: stdout };
    }
  } catch (err: any) {
    return {
      error: `Sandbox execution failed: ${err.message || String(err)}`,
    };
  }
}

// ── Webhook Execution ──────────────────────────────────────

/**
 * Execute a webhook tool by making an HTTP request to the configured endpoint.
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
export async function executeWebhookTool(
  tool: CustomToolRow,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!tool.webhookUrl) {
    return { error: `Webhook tool "${tool.label}" has no URL configured` };
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
  // oauth2 would require a token exchange flow — stored token used as bearer
  if (authType === "oauth2" && authCfg.accessToken) {
    headers["Authorization"] = `Bearer ${authCfg.accessToken}`;
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
        error: `Webhook "${tool.label}" returned HTTP ${res.status}`,
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
      return { error: `Webhook "${tool.label}" timed out after ${timeoutMs}ms` };
    }
    return { error: `Webhook execution failed: ${err.message || String(err)}` };
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
 * - sandbox → runs code in isolated container via ctx.sandbox.run()
 * - webhook → makes HTTP request to external URL
 * - client → returns a structured UI action payload (no server-side execution)
 *
 * @param tool - The tool definition
 * @param params - Parameters from the LLM
 * @param sandbox - Sandbox API (required for sandbox tools, optional otherwise)
 */
export async function executeTool(
  tool: CustomToolRow,
  params: Record<string, unknown>,
  sandbox?: { run: (opts: Record<string, unknown>) => Promise<{ stdout: string; stderr: string; exitCode: number }> } | null
): Promise<Record<string, unknown>> {
  switch (tool.toolType) {
    case "webhook":
      return executeWebhookTool(tool, params);

    case "client":
      return buildClientToolAction(tool, params);

    case "sandbox":
    default:
      if (!sandbox) {
        return { error: `Sandbox not available — cannot execute tool "${tool.label}"` };
      }
      return executeToolInSandbox(sandbox, tool, params);
  }
}
