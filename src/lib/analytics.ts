/**
 * Analytics Engine — Typed sandbox runner for Python analytics.
 *
 * This is the bridge between TypeScript agents/routes and the Python
 * analytics modules. It calls the Agentuity Sandbox SDK directly.
 *
 * Architecture (correct — per SDK docs):
 *   1. Agent queries DB for data (TypeScript — fast, typed)
 *   2. Agent calls runAnalytics(sandboxApi, { action, data, params })
 *   3. This module assembles all Python files + input.json
 *   4. Calls sandboxApi.run() with command.files (all Python modules
 *      + data payload uploaded per-call)
 *   5. Sandbox boots from snapshot (packages pre-installed), runs
 *      main.py which dispatches to the right module
 *   6. Module returns JSON (summary + optional base64 charts) via stdout
 *   7. Sandbox is destroyed automatically (one-shot)
 *
 * WHY NOT executeSandbox()? That function wraps code through
 * buildPythonScript() — designed for LLM-generated one-off scripts.
 * Our analytics engine is a structured Python project with a dispatcher
 * and module imports. Using executeSandbox() would:
 *   - Wrap code inside def __run_analysis(): with broken indentation
 *   - Add redundant venv bootstrap logic
 *   - Duplicate data loading (it reads data.json into DATA variable)
 *   - Conflict error handling (both layers have try/except + sys.exit)
 *   - NOT include the chart/forecast/etc modules in the sandbox
 *
 * The snapshot (ANALYTICS_SNAPSHOT_ID env var) has all Python packages
 * pre-installed: pandas, numpy, scipy, scikit-learn, matplotlib, seaborn,
 * plotly, statsmodels, prophet, lifetimes, mlxtend, squarify, etc.
 */

import { getAnalyticsConfig } from "@services/analytics-configs";
import type { AnalyticsCategory } from "@lib/analytics-defaults";
import { getAnalyticsFiles } from "@lib/analytics-scripts";
import { logAnalyticsMetric } from "@lib/analytics-metrics";
import type { KVStore } from "@lib/cache";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** All supported analytics actions — maps to Python modules */
export type AnalyticsAction =
  // Charts
  | "chart.sales_trends"
  | "chart.heatmap"
  | "chart.scatter"
  | "chart.treemap"
  | "chart.pareto"
  | "chart.waterfall"
  | "chart.forecast"
  | "chart.geo_map"
  | "chart.render"
  // Forecasting
  | "forecast.prophet"
  | "forecast.arima"
  | "forecast.holt_winters"
  | "forecast.safety_stock"
  // Classification
  | "classify.abc_xyz"
  | "classify.rfm"
  | "classify.clv"
  | "classify.bundles"
  // Anomaly Detection
  | "anomaly.transactions"
  | "anomaly.shrinkage";

/**
 * Map action prefixes to their analytics category for config lookup.
 *
 * ABC-XYZ is inventory classification, not customer analytics.
 * We check specific actions FIRST, then fall back to prefix matching.
 */
const ACTION_TO_CATEGORY: Record<string, AnalyticsCategory> = {
  // Specific overrides (checked first via exact match)
  "classify.abc_xyz": "classification",
  // Prefix-based (checked second via startsWith)
  "chart.": "charts",
  "forecast.": "forecasting",
  "classify.": "customer", // RFM, CLV, bundles = customer analytics
  "anomaly.": "anomaly",
};

/** Resolve an action to its analytics category */
function getActionCategory(action: AnalyticsAction): AnalyticsCategory {
  // Check exact match first (handles overrides like classify.abc_xyz → classification)
  if (action in ACTION_TO_CATEGORY) {
    return ACTION_TO_CATEGORY[action];
  }
  // Then check prefix match
  for (const [prefix, category] of Object.entries(ACTION_TO_CATEGORY)) {
    if (prefix.endsWith(".") && action.startsWith(prefix)) return category;
  }
  return "charts"; // fallback
}

/** Input to the analytics engine */
export interface AnalyticsRequest {
  /** Which analytics module to run */
  action: AnalyticsAction;
  /** Data rows to analyze (from DB query) */
  data: Record<string, unknown>[];
  /** Optional override params (merged with category config) */
  params?: Record<string, unknown>;
}

/** A single chart image returned from Python */
export interface AnalyticsChart {
  /** Chart title */
  title: string;
  /** Image format */
  format: "png" | "svg";
  /** Base64-encoded image data */
  data: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
}

/** Structured result from any analytics action */
export interface AnalyticsResult {
  /** Whether the analytics ran successfully */
  success: boolean;
  /** Structured summary/results from the algorithm */
  summary?: Record<string, unknown>;
  /** Optional chart images (for chart.* and some forecast actions) */
  charts?: AnalyticsChart[];
  /** Table data for UI display */
  table?: {
    columns: string[];
    rows: Record<string, unknown>[];
  };
  /** Error message if something failed */
  error?: string;
  /** Python traceback (for debugging — never shown to end users) */
  traceback?: string;
  /** Execution metadata */
  meta?: {
    /** Sandbox ID for debugging */
    sandboxId?: string;
    /** Execution time in ms */
    durationMs?: number;
    /** Number of data rows sent to Python */
    dataRowCount: number;
    /** Action that was executed */
    action: AnalyticsAction;
  };
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/** Maximum data rows to send to the sandbox (prevents OOM on large datasets) */
const MAX_DATA_ROWS = 10_000;

/** Default execution timeout (string format per SDK docs) */
const DEFAULT_TIMEOUT = "120s";

/** Default memory limit */
const DEFAULT_MEMORY = "512Mi";

/** Default CPU limit */
const DEFAULT_CPU = "500m";

// ────────────────────────────────────────────────────────────
// Main Entry Point
// ────────────────────────────────────────────────────────────

/**
 * Run a Python analytics action in an isolated sandbox.
 *
 * Calls sandboxApi.run() directly per the Agentuity Sandbox SDK.
 * All Python files are uploaded via command.files on every call.
 * The snapshot provides pre-installed packages (fast cold start).
 *
 * @param sandboxApi - The sandbox API (`ctx.sandbox` in agents, `c.var.sandbox` in routes)
 * @param request - The action, data, and optional params
 * @returns Structured result with summary, charts, and/or table data
 *
 * @example
 * ```ts
 * // In an agent handler:
 * const result = await runAnalytics(ctx.sandbox, {
 *   action: "chart.sales_trends",
 *   data: salesRows,
 *   params: { movingAverageWindow: 14 },
 * });
 * if (result.success && result.charts) {
 *   // Embed base64 chart in response
 * }
 * ```
 *
 * @example
 * ```ts
 * // In a route handler:
 * const result = await runAnalytics(c.var.sandbox, {
 *   action: "classify.abc_xyz",
 *   data: productSalesData,
 * });
 * return c.json(result);
 * ```
 */
export async function runAnalytics(
  sandboxApi: { run: (opts: Record<string, unknown>) => Promise<SandboxRunResult> },
  request: AnalyticsRequest,
  /** Optional KV store for logging execution metrics */
  kv?: KVStore
): Promise<AnalyticsResult> {
  const { action, data, params: overrideParams } = request;

  // ── Step 1: Validate snapshot is configured ───────────────
  const snapshotId = process.env.ANALYTICS_SNAPSHOT_ID;
  if (!snapshotId) {
    return {
      success: false,
      error:
        "ANALYTICS_SNAPSHOT_ID not configured. " +
        "Create a Python analytics snapshot and set the env var.",
    };
  }

  // ── Step 2: Get category config (defaults + DB overrides) ─
  const category = getActionCategory(action);
  let categoryConfig: Record<string, unknown> = {};
  let chartConfig: Record<string, unknown> = {};

  try {
    const config = await getAnalyticsConfig(category);
    if (!config.isEnabled) {
      return {
        success: false,
        error: `Analytics category "${category}" is disabled. Enable it in Admin → Analytics Settings.`,
      };
    }
    categoryConfig = config.params;
  } catch {
    // If DB is unavailable, proceed with empty overrides (TS defaults used in Python)
  }

  // Always get chart config for styling (even non-chart actions may return charts)
  if (category !== "charts") {
    try {
      const chartCfg = await getAnalyticsConfig("charts");
      chartConfig = chartCfg.params;
    } catch {
      // Non-critical — charts will use matplotlib defaults
    }
  } else {
    chartConfig = categoryConfig;
  }

  // ── Step 3: Build input payload ───────────────────────────
  // Truncate data to prevent OOM in sandbox
  const truncatedData =
    data.length > MAX_DATA_ROWS ? data.slice(0, MAX_DATA_ROWS) : data;

  const inputPayload = {
    action,
    data: truncatedData,
    params: {
      ...categoryConfig,
      ...overrideParams,
    },
    chartConfig,
  };

  const inputJson = JSON.stringify(inputPayload);

  // ── Step 4: Assemble Python files ─────────────────────────
  // All Python source code is embedded in analytics-scripts.ts
  // and uploaded to the sandbox via command.files (per SDK docs)
  const pythonFiles = getAnalyticsFiles();

  const commandFiles = [
    // Python modules
    ...pythonFiles.map((f) => ({
      path: f.path,
      content: Buffer.from(f.content),
    })),
    // Data payload (the input for main.py to read)
    {
      path: "input.json",
      content: Buffer.from(inputJson),
    },
  ];

  // ── Step 5: Execute in sandbox (SDK one-shot pattern) ─────
  try {
    const result: SandboxRunResult = await sandboxApi.run({
      command: {
        exec: ["python3", "main.py"],
        files: commandFiles,
      },
      runtime: "python:3.13",
      snapshot: snapshotId,
      resources: {
        memory: DEFAULT_MEMORY,
        cpu: DEFAULT_CPU,
      },
      timeout: { execution: DEFAULT_TIMEOUT },
      network: { enabled: false }, // No network needed — all packages in snapshot
    });

    // ── Step 6: Parse and validate result ───────────────────
    const meta: AnalyticsResult["meta"] = {
      sandboxId: result.sandboxId,
      durationMs: result.durationMs,
      dataRowCount: truncatedData.length,
      action,
    };

    // ── Log execution metrics (fire-and-forget) ─────────────
    if (kv) {
      logAnalyticsMetric(kv, {
        action,
        success: result.exitCode === 0,
        durationMs: result.durationMs,
        cpuTimeMs: result.cpuTimeMs,
        memoryByteSec: result.memoryByteSec,
        exitCode: result.exitCode,
        dataRowCount: truncatedData.length,
        timestamp: Date.now(),
        sandboxId: result.sandboxId,
      }).catch(() => {}); // Non-critical — never block on metrics
    }

    // Non-zero exit = Python error
    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `Analytics failed (exit ${result.exitCode}): ${result.stderr || result.stdout || "unknown error"}`,
        traceback: result.stderr || undefined,
        meta,
      };
    }

    // Parse stdout as JSON (main.py prints JSON to stdout)
    const stdout = (result.stdout || "").trim();
    if (!stdout) {
      return {
        success: false,
        error: "Analytics returned no output",
        meta,
      };
    }

    let parsed: Record<string, unknown>;
    try {
      // main.py outputs a single JSON line to stdout
      const lines = stdout.split("\n");
      const lastLine = lines[lines.length - 1];
      parsed = JSON.parse(lastLine);
    } catch {
      return {
        success: false,
        error: "Failed to parse analytics output as JSON",
        traceback: stdout,
        meta,
      };
    }

    // Python module returned an error
    if (parsed.error) {
      return {
        success: false,
        error: parsed.error as string,
        traceback: parsed.traceback as string | undefined,
        meta,
      };
    }

    // ── Step 7: Validate output structure ───────────────────
    // Python modules should return { summary, charts?, table? }
    // This validation ensures malformed output is caught early
    const validatedResult = validateAnalyticsOutput(parsed);

    return {
      success: true,
      ...validatedResult,
      meta,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Log failure metric
    if (kv) {
      logAnalyticsMetric(kv, {
        action,
        success: false,
        durationMs: 0,
        exitCode: -1,
        dataRowCount: truncatedData.length,
        timestamp: Date.now(),
      }).catch(() => {});
    }

    return {
      success: false,
      error: `Sandbox execution failed: ${errMsg}`,
      meta: {
        dataRowCount: truncatedData.length,
        action,
      },
    };
  }
}

// ────────────────────────────────────────────────────────────
// Output Validation
// ────────────────────────────────────────────────────────────

/**
 * Validate and normalize Python analytics output.
 *
 * This is our proactive quality layer — instead of blindly trusting
 * whatever Python returns, we validate the structure and provide
 * sensible defaults. This catches:
 * - Missing summary object
 * - Charts with missing required fields
 * - Unexpected data types
 * - Malformed table data
 */
function validateAnalyticsOutput(
  raw: Record<string, unknown>
): Pick<AnalyticsResult, "summary" | "charts" | "table"> {
  const result: Pick<AnalyticsResult, "summary" | "charts" | "table"> = {};

  // Summary — accept any object, default to the raw output itself
  if (raw.summary && typeof raw.summary === "object") {
    result.summary = raw.summary as Record<string, unknown>;
  } else {
    // If no explicit summary, use the whole output as summary
    const { charts: _c, table: _t, ...rest } = raw;
    result.summary = rest;
  }

  // Charts — validate each chart has required fields
  if (Array.isArray(raw.charts)) {
    result.charts = (raw.charts as Record<string, unknown>[])
      .filter(
        (c) =>
          typeof c === "object" &&
          c !== null &&
          typeof c.data === "string" &&
          (c.data as string).length > 0
      )
      .map((c) => ({
        title: (c.title as string) ?? "Chart",
        format: (c.format as "png" | "svg") ?? "png",
        data: c.data as string,
        width: typeof c.width === "number" ? c.width : 800,
        height: typeof c.height === "number" ? c.height : 400,
      }));
  }

  // Table — validate structure
  if (raw.table && typeof raw.table === "object") {
    const t = raw.table as Record<string, unknown>;
    if (Array.isArray(t.columns) && Array.isArray(t.rows)) {
      result.table = {
        columns: t.columns as string[],
        rows: t.rows as Record<string, unknown>[],
      };
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// SDK Type (subset of SandboxRunResult from Agentuity docs)
// ────────────────────────────────────────────────────────────

/** Subset of the Agentuity SandboxRunResult we actually consume */
interface SandboxRunResult {
  sandboxId: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  cpuTimeMs?: number;
  memoryByteSec?: number;
  networkEgressBytes?: number;
}

// ────────────────────────────────────────────────────────────
// Convenience wrappers for common operations
// ────────────────────────────────────────────────────────────

/** Generate a chart image */
export async function generateChart(
  sandboxApi: Parameters<typeof runAnalytics>[0],
  chartType: Extract<AnalyticsAction, `chart.${string}`>,
  data: Record<string, unknown>[],
  params?: Record<string, unknown>,
  kv?: KVStore
): Promise<AnalyticsResult> {
  return runAnalytics(sandboxApi, { action: chartType, data, params }, kv);
}

/** Run a forecast */
export async function runForecast(
  sandboxApi: Parameters<typeof runAnalytics>[0],
  model: "prophet" | "arima" | "holt_winters" | "safety_stock",
  data: Record<string, unknown>[],
  params?: Record<string, unknown>,
  kv?: KVStore
): Promise<AnalyticsResult> {
  return runAnalytics(sandboxApi, {
    action: `forecast.${model}` as AnalyticsAction,
    data,
    params,
  }, kv);
}

/** Run a classification */
export async function runClassification(
  sandboxApi: Parameters<typeof runAnalytics>[0],
  type: "abc_xyz" | "rfm" | "clv" | "bundles",
  data: Record<string, unknown>[],
  params?: Record<string, unknown>,
  kv?: KVStore
): Promise<AnalyticsResult> {
  return runAnalytics(sandboxApi, {
    action: `classify.${type}` as AnalyticsAction,
    data,
    params,
  }, kv);
}

/** Run anomaly detection */
export async function runAnomalyDetection(
  sandboxApi: Parameters<typeof runAnalytics>[0],
  type: "transactions" | "shrinkage",
  data: Record<string, unknown>[],
  params?: Record<string, unknown>,
  kv?: KVStore
): Promise<AnalyticsResult> {
  return runAnalytics(sandboxApi, {
    action: `anomaly.${type}` as AnalyticsAction,
    data,
    params,
  }, kv);
}
