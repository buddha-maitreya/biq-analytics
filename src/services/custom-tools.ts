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
  metadata?: Record<string, unknown>;
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
      metadata: input.metadata ?? {},
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
  if (input.metadata !== undefined) updates.metadata = input.metadata;

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

// Phase 6.2: OAuth2 token cache (in-memory per deployment instance)
const oauthTokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Exchange OAuth2 credentials for an access token.
 * Supports client_credentials grant (most common for server-to-server).
 * Tokens are cached in-memory until 60s before expiry.
 */
async function getOAuth2Token(
  authCfg: Record<string, string>
): Promise<string | null> {
  const cacheKey = `${authCfg.tokenUrl}:${authCfg.clientId}`;
  const cached = oauthTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  // If we have a stored access token but no tokenUrl, use it directly
  if (authCfg.accessToken && !authCfg.tokenUrl) {
    return authCfg.accessToken;
  }

  if (!authCfg.tokenUrl || !authCfg.clientId || !authCfg.clientSecret) {
    return authCfg.accessToken ?? null;
  }

  try {
    const body = new URLSearchParams({
      grant_type: authCfg.grantType ?? "client_credentials",
      client_id: authCfg.clientId,
      client_secret: authCfg.clientSecret,
    });
    if (authCfg.scope) body.set("scope", authCfg.scope);

    const res = await fetch(authCfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      return authCfg.accessToken ?? null;
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };
    const expiresIn = data.expires_in ?? 3600;
    // Cache until 60s before expiry
    oauthTokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    });
    return data.access_token;
  } catch {
    return authCfg.accessToken ?? null;
  }
}

// Phase 6.2: Rate limiting via in-memory counters (per-tool)
const rateLimitCounters = new Map<string, { count: number; windowStart: number }>();

/** Default rate limit: 60 requests per minute per tool */
const DEFAULT_RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Check and increment rate limit counter for a tool.
 * Returns true if the request is allowed, false if rate-limited.
 */
function checkRateLimit(toolId: string, maxRequests?: number): boolean {
  const limit = maxRequests ?? DEFAULT_RATE_LIMIT;
  const now = Date.now();
  const counter = rateLimitCounters.get(toolId);

  if (!counter || now - counter.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitCounters.set(toolId, { count: 1, windowStart: now });
    return true;
  }

  if (counter.count >= limit) return false;
  counter.count++;
  return true;
}

/**
 * Execute a server tool by making an HTTP request to the configured endpoint.
 *
 * Supports:
 * - Authentication (api_key, bearer, basic, oauth2 with token exchange)
 * - Path parameter interpolation (e.g. /users/{user_id})
 * - Query parameters (merged from schema defaults + LLM params)
 * - Request body schema for POST/PUT/PATCH
 * - Dynamic variable substitution in URL, headers, and body
 * - Rate limiting (per-tool, configurable via metadata.rateLimit)
 * - Retry with exponential backoff for transient failures (5xx, network errors)
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

  // Phase 6.2: Rate limiting
  const rateLimit = (tool.metadata as Record<string, unknown>)?.rateLimit as number | undefined;
  if (!checkRateLimit(tool.id, rateLimit)) {
    return {
      error: `Server tool "${tool.label}" is rate-limited. Try again later.`,
      rateLimited: true,
    };
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
  } else if (authType === "oauth2") {
    // Phase 6.2: Full OAuth2 token exchange with caching
    const token = await getOAuth2Token(authCfg);
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
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
    // Phase 6.2: Retry with exponential backoff for transient failures
    const maxRetries = ((tool.metadata as Record<string, unknown>)?.retries as number) ?? 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 500ms, 1000ms, 2000ms, ...
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
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

        // Don't retry client errors (4xx) — only server errors (5xx)
        if (!res.ok) {
          if (res.status >= 500 && attempt < maxRetries) {
            lastError = new Error(`HTTP ${res.status}`);
            continue; // retry
          }
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
          if (attempt < maxRetries) {
            lastError = err;
            continue; // retry timeouts
          }
          return { error: `Server tool "${tool.label}" timed out after ${timeoutMs}ms` };
        }
        // Network errors are retryable
        if (attempt < maxRetries) {
          lastError = err;
          continue;
        }
        return { error: `Server tool execution failed: ${err.message || String(err)}` };
      }
    }

    return { error: `Server tool "${tool.label}" failed after ${maxRetries + 1} attempts: ${lastError?.message ?? "unknown"}` };
  } catch (err: any) {
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
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  switch (tool.toolType) {
    case "server":
      return executeServerTool(tool, params);

    case "client":
      return buildClientToolAction(tool, params);

    case "mcp":
      return executeMcpTool(tool, params);

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

// ── MCP Tool Execution ─────────────────────────────────────
//
// MCP (Model Context Protocol) tools are pre-configured external
// integrations with specialized request building and response
// formatting. Each mcpType has a dedicated handler. Unknown types
// fall back to standard HTTP execution (executeServerTool).
// ──────────────────────────────────────────────────────────

/** WMO standard weather codes used by Open-Meteo */
const WMO_WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Depositing rime fog",
  51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
  56: "Freezing light drizzle", 57: "Freezing dense drizzle",
  61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
  66: "Freezing light rain", 67: "Freezing heavy rain",
  71: "Slight snow fall", 73: "Moderate snow fall", 75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
  85: "Slight snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
};

/** Kenyan city coordinates for quick location resolution */
const KENYA_LOCATIONS: Record<string, { lat: number; lon: number }> = {
  nairobi: { lat: -1.2921, lon: 36.8219 },
  mombasa: { lat: -4.0435, lon: 39.6682 },
  kisumu: { lat: -0.1022, lon: 34.7617 },
  nakuru: { lat: -0.3031, lon: 36.0800 },
  eldoret: { lat: 0.5143, lon: 35.2698 },
  thika: { lat: -1.0396, lon: 37.0900 },
  malindi: { lat: -3.2138, lon: 40.1169 },
  nanyuki: { lat: 0.0067, lon: 37.0722 },
  kitale: { lat: 1.0187, lon: 35.0020 },
  garissa: { lat: -0.4532, lon: 39.6461 },
  lamu: { lat: -2.2717, lon: 40.9020 },
  nyeri: { lat: -0.4197, lon: 36.9511 },
  machakos: { lat: -1.5177, lon: 37.2634 },
  naivasha: { lat: -0.7172, lon: 36.4310 },
  meru: { lat: 0.0480, lon: 37.6559 },
};

/** Common NSE (Nairobi Securities Exchange) stock symbols */
const NSE_SYMBOLS: Record<string, string> = {
  SCOM: "Safaricom PLC",
  EQTY: "Equity Group Holdings",
  KCB: "KCB Group PLC",
  COOP: "Co-operative Bank",
  ABSA: "ABSA Bank Kenya",
  SBIC: "Stanbic Holdings",
  EABL: "East African Breweries",
  BAT: "BAT Kenya",
  BAMB: "Bamburi Cement",
  KQ: "Kenya Airways",
  SCAN: "ScanGroup",
  JUB: "Jubilee Holdings",
  NCBA: "NCBA Group",
  DTK: "Diamond Trust Bank Kenya",
  NBK: "National Bank of Kenya",
};

/**
 * Execute an MCP-type tool.
 * MCP tools are pre-configured integrations with specialized request building
 * and response formatting. Unknown MCP types fall back to standard HTTP execution.
 */
export async function executeMcpTool(
  tool: CustomToolRow,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const meta = (tool.metadata ?? {}) as Record<string, unknown>;
  const mcpType = meta.mcpType as string;

  switch (mcpType) {
    case "weather":
      return executeMcpWeather(tool, params);
    case "stock_market":
      return executeMcpStockMarket(tool, params);
    default:
      // Unknown MCP type — fall back to standard HTTP execution
      return executeServerTool(tool, params);
  }
}

/**
 * Execute weather MCP tool using Open-Meteo API (free, no auth required).
 * Supports configurable location via tool metadata or runtime params.
 * @param tool - MCP tool with metadata.location, metadata.latitude, metadata.longitude
 * @param params - Optional: location (city name), latitude, longitude overrides
 */
async function executeMcpWeather(
  tool: CustomToolRow,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const meta = (tool.metadata ?? {}) as Record<string, unknown>;

  // Resolve location: runtime params override > tool metadata defaults
  let lat = Number(meta.latitude ?? -1.2921);
  let lon = Number(meta.longitude ?? 36.8219);
  let location = String(meta.location ?? "Nairobi");
  const tz = String(meta.timezone ?? "Africa/Nairobi");
  const forecastDays = Number(meta.forecastDays ?? 7);

  // If a city name was provided, try to resolve coordinates from our Kenya lookup
  if (params.location && typeof params.location === "string") {
    const cityKey = params.location.toLowerCase().trim();
    const cityCoords = KENYA_LOCATIONS[cityKey];
    if (cityCoords) {
      lat = cityCoords.lat;
      lon = cityCoords.lon;
      location = params.location as string;
    } else {
      // Use provided name but keep configured coords unless lat/lon also provided
      location = params.location as string;
    }
  }

  // Allow explicit lat/lon overrides
  if (params.latitude !== undefined) lat = Number(params.latitude);
  if (params.longitude !== undefined) lon = Number(params.longitude);

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
    `&timezone=${encodeURIComponent(tz)}&forecast_days=${forecastDays}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      return { error: `Weather API returned HTTP ${res.status}`, status: res.status };
    }

    const data = await res.json() as Record<string, any>;
    const current = data.current;

    // Format the forecast
    const forecast: Array<Record<string, string>> = [];
    if (data.daily) {
      for (let i = 0; i < (data.daily.time?.length ?? 0); i++) {
        forecast.push({
          date: data.daily.time[i],
          high: `${data.daily.temperature_2m_max[i]}°C`,
          low: `${data.daily.temperature_2m_min[i]}°C`,
          precipitation: `${data.daily.precipitation_sum[i]} mm`,
          maxWind: `${data.daily.wind_speed_10m_max[i]} km/h`,
          description: WMO_WEATHER_CODES[data.daily.weather_code[i]] ?? "Unknown",
        });
      }
    }

    return {
      location,
      coordinates: { latitude: lat, longitude: lon },
      current: {
        temperature: `${current.temperature_2m}°C`,
        feelsLike: `${current.apparent_temperature}°C`,
        humidity: `${current.relative_humidity_2m}%`,
        windSpeed: `${current.wind_speed_10m} km/h`,
        windDirection: `${current.wind_direction_10m}°`,
        precipitation: `${current.precipitation} mm`,
        description: WMO_WEATHER_CODES[current.weather_code] ?? "Unknown",
      },
      forecast,
      timestamp: current.time,
      timezone: tz,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { error: "Weather API request timed out" };
    }
    return { error: `Weather fetch failed: ${err.message ?? String(err)}` };
  }
}

/**
 * Execute NSE stock market MCP tool.
 * Uses the Marketstack API (free tier available) to fetch stock quotes
 * from the Nairobi Securities Exchange (XNAI).
 * @param tool - MCP tool with metadata.apiUrl, authConfig.apiKey
 * @param params - symbol or company name to look up
 */
async function executeMcpStockMarket(
  tool: CustomToolRow,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const meta = (tool.metadata ?? {}) as Record<string, unknown>;
  const apiKey =
    (tool.authConfig as Record<string, string>)?.apiKey ||
    (meta.apiKey as string) ||
    "";

  if (!apiKey) {
    return {
      error:
        "NSE stock tool requires an API key. Sign up for a free Marketstack API key at https://marketstack.com/signup/free and configure it in Admin → Custom Tools → MCP Tools.",
      setup: {
        provider: "Marketstack",
        signupUrl: "https://marketstack.com/signup/free",
        freeTier: "100 requests/month",
        instructions:
          "After signup, copy your API key and paste it in the MCP tool's Auth Config → apiKey field.",
      },
      availableSymbols: NSE_SYMBOLS,
    };
  }

  // Resolve symbol(s) — accept ticker, company name, or partial match
  const symbolInput = String(
    params.symbol ?? params.stock ?? params.company ?? meta.defaultSymbol ?? "SCOM"
  );
  const symbolUpper = symbolInput.toUpperCase().trim();

  let symbol = symbolUpper;

  // Direct ticker match
  if (!NSE_SYMBOLS[symbol]) {
    // Try partial company name match
    const match = Object.entries(NSE_SYMBOLS).find(([_, name]) =>
      name.toLowerCase().includes(symbolInput.toLowerCase())
    );
    if (match) symbol = match[0];
  }

  // Marketstack uses .XNAI suffix for Nairobi Securities Exchange
  const exchangeSymbol = `${symbol}.XNAI`;
  const baseUrl = String(meta.apiUrl ?? "http://api.marketstack.com/v1");
  const url = `${baseUrl}/eod?access_key=${apiKey}&symbols=${exchangeSymbol}&limit=5`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        error: `Stock API returned HTTP ${res.status}`,
        status: res.status,
        details: errText.slice(0, 500),
      };
    }

    const data = (await res.json()) as Record<string, any>;

    if (data.error) {
      return { error: data.error.message ?? "API error", code: data.error.code };
    }

    const quotes = ((data.data ?? []) as Array<Record<string, any>>).map(
      (q: Record<string, any>) => ({
        date: q.date?.split("T")[0],
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
        exchange: q.exchange,
      })
    );

    const latest = quotes[0];
    const previous = quotes[1];
    const change =
      latest && previous
        ? {
            amount: (latest.close - previous.close).toFixed(2),
            percent:
              (((latest.close - previous.close) / previous.close) * 100).toFixed(2) + "%",
          }
        : null;

    return {
      symbol: symbol.toUpperCase(),
      company: NSE_SYMBOLS[symbol.toUpperCase()] ?? symbol,
      exchange: "NSE (Nairobi Securities Exchange)",
      latest: latest ?? null,
      change,
      history: quotes,
      currency: "KES",
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { error: "Stock API request timed out" };
    }
    return { error: `Stock data fetch failed: ${err.message ?? String(err)}` };
  }
}

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

// ── MCP Default Integrations ───────────────────────────────
//
// Pre-configured MCP tool integrations. These are "official" external
// service integrations that ship with the platform. Unlike custom tools
// (which are user-defined), MCP tools have specialized execution handlers
// with built-in request building and response formatting.
// ──────────────────────────────────────────────────────────

const MCP_DEFAULT_TOOLS: CreateToolInput[] = [
  {
    toolType: "mcp",
    name: "mcp_weather",
    label: "Weather Data (Kenya)",
    description:
      "Get real-time weather data and forecast for any location in Kenya. " +
      "Powered by Open-Meteo (free, no API key required). Forecast range is configurable " +
      "(default 7 days). Use when the user asks about weather, temperature, rain, or " +
      "climate conditions for business planning, logistics, or general information.",
    parameterSchema: {
      location: {
        type: "string",
        description:
          "City name in Kenya (Nairobi, Mombasa, Kisumu, Nakuru, Eldoret, Thika, Malindi, " +
          "Nanyuki, Kitale, Garissa, Lamu, Nyeri, Machakos, Naivasha, Meru). " +
          "Defaults to configured business location.",
      },
      latitude: {
        type: "number",
        description: "Custom latitude (optional — overrides city lookup)",
      },
      longitude: {
        type: "number",
        description: "Custom longitude (optional — overrides city lookup)",
      },
    },
    webhookUrl: "https://api.open-meteo.com/v1/forecast",
    webhookMethod: "GET",
    webhookHeaders: {},
    webhookTimeoutSecs: 15,
    authType: "none",
    authConfig: {},
    executionMode: "immediate",
    isActive: true, // Works immediately — no API key required
    sortOrder: 100,
    metadata: {
      mcpType: "weather",
      provider: "Open-Meteo",
      location: "Nairobi",
      latitude: -1.2921,
      longitude: 36.8219,
      timezone: "Africa/Nairobi",
      forecastDays: 7,
      category: "weather",
      noApiKeyRequired: true,
      supportedCities: Object.keys(KENYA_LOCATIONS),
    },
  },
  {
    toolType: "mcp",
    name: "mcp_nse_stocks",
    label: "NSE Stock Market Data",
    description:
      "Get stock market data from the Nairobi Securities Exchange (NSE). " +
      "Supports major Kenyan stocks: Safaricom (SCOM), Equity (EQTY), KCB, Co-op Bank (COOP), " +
      "ABSA, Stanbic (SBIC), EABL, BAT, and more. Requires a free Marketstack API key. " +
      "Use when the user asks about stock prices, market performance, or financial data " +
      "for Kenyan companies.",
    parameterSchema: {
      symbol: {
        type: "string",
        description:
          "Stock ticker symbol (e.g. SCOM for Safaricom, EQTY for Equity, KCB for KCB Group) " +
          "or company name",
        required: true,
      },
    },
    webhookUrl: "http://api.marketstack.com/v1/eod",
    webhookMethod: "GET",
    webhookHeaders: {},
    webhookTimeoutSecs: 20,
    authType: "api_key",
    authConfig: { headerName: "access_key", apiKey: "" },
    executionMode: "immediate",
    isActive: false, // Inactive until API key is configured
    sortOrder: 101,
    metadata: {
      mcpType: "stock_market",
      provider: "Marketstack",
      exchange: "XNAI",
      exchangeName: "Nairobi Securities Exchange",
      category: "finance",
      apiUrl: "http://api.marketstack.com/v1",
      defaultSymbol: "SCOM",
      setupUrl: "https://marketstack.com/signup/free",
      freeTier: "100 requests/month",
      symbols: NSE_SYMBOLS,
    },
  },
];

/**
 * Seed default MCP integrations (idempotent — skips tools whose name already exists).
 * Returns the count of newly created tools.
 */
export async function seedMcpTools(): Promise<number> {
  let created = 0;
  for (const def of MCP_DEFAULT_TOOLS) {
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

/** List only MCP-type tools */
export async function listMcpTools(): Promise<CustomToolRow[]> {
  const rows = await db.query.customTools.findMany({
    where: eq(customTools.toolType, "mcp"),
    orderBy: [asc(customTools.sortOrder), asc(customTools.name)],
  });
  return rows as CustomToolRow[];
}

/** Get the list of default MCP tool names */
export const MCP_DEFAULT_TOOL_NAMES = MCP_DEFAULT_TOOLS.map((t) => t.name);
