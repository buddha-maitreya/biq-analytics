/**
 * Sandbox Execution Helper — shared utility for running LLM-generated
 * code in isolated Agentuity sandboxes.
 *
 * Architecture:
 *   1. LLM generates code + optional SQL query
 *   2. If SQL is provided, we execute it against the DB first
 *   3. Data is serialized as JSON and injected into the sandbox
 *   4. The sandbox runs the code in the chosen runtime (default: bun:1)
 *   5. The sandbox must write its JSON result to stdout
 *   6. We parse stdout and return structured results
 *
 * Phase 4 Enhancements:
 *   4.1 — Error classification (syntax/runtime/timeout/resource/import)
 *          Output size limits (configurable, default 512KB)
 *          Retry with LLM correction (up to N retries, structured error feedback)
 *          Explicit sandbox.destroy() in finally blocks
 *   4.2 — Snapshot support (snapshotId config, create/restore)
 *   4.3 — Interactive session management (multi-step execution in one sandbox)
 *   4.4 — Multi-runtime support (bun:1, python, node)
 *
 * Security:
 *   - Network is ALWAYS disabled (no exfiltration)
 *   - Only SELECT queries are allowed (safety-checked)
 *   - Execution timeout: configurable (default 30s)
 *   - Memory limit: configurable (default 256MB)
 *   - Code runs in full isolation — no host access
 */

import { db } from "@db/index";
import { sql } from "drizzle-orm";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/** Maximum stdout size before truncation (bytes) */
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024; // 512KB

/** Maximum data rows to pass to sandbox */
const MAX_DATA_ROWS = 500;

/** Supported sandbox runtimes */
export type SandboxRuntime = "bun:1" | "python" | "node";

// ────────────────────────────────────────────────────────────
// Error Classification
// ────────────────────────────────────────────────────────────

/**
 * Classified error types for structured LLM feedback.
 * The LLM can use these to decide how to self-correct:
 * - syntax: Fix the code syntax (typos, missing brackets, etc.)
 * - runtime: Fix logic errors (null access, type errors, etc.)
 * - timeout: Simplify the code or reduce data scope
 * - resource: Reduce memory usage or data size
 * - import: Remove the unavailable import/require
 * - sql: Fix the SQL query
 * - output: Reduce output size or aggregate results
 * - unknown: Unclassifiable error
 */
export type SandboxErrorType =
  | "syntax"
  | "runtime"
  | "timeout"
  | "resource"
  | "import"
  | "sql"
  | "output"
  | "unknown";

/**
 * Classify an error based on stderr/stdout/error message.
 * Returns both the type and a human-readable hint for the LLM.
 */
export function classifyError(
  stderr: string,
  stdout: string,
  error?: string
): { type: SandboxErrorType; hint: string } {
  const combined = `${stderr}\n${stdout}\n${error ?? ""}`.toLowerCase();

  // Syntax errors
  if (
    combined.includes("syntaxerror") ||
    combined.includes("unexpected token") ||
    combined.includes("unexpected end of input") ||
    combined.includes("unterminated string") ||
    combined.includes("missing )") ||
    combined.includes("parse error")
  ) {
    return {
      type: "syntax",
      hint: "The code has a syntax error. Check for missing brackets, semicolons, or typos.",
    };
  }

  // Import/require failures
  if (
    combined.includes("cannot find module") ||
    combined.includes("module not found") ||
    combined.includes("cannot find package") ||
    (combined.includes("is not defined") &&
      (combined.includes("require") || combined.includes("import")))
  ) {
    return {
      type: "import",
      hint: "The code tries to import/require a module that is not available. Use only built-in APIs.",
    };
  }

  // Timeout
  if (
    combined.includes("timeout") ||
    combined.includes("timed out") ||
    combined.includes("execution time")
  ) {
    return {
      type: "timeout",
      hint: "Execution timed out. Simplify the algorithm, reduce data scope, or use more efficient methods.",
    };
  }

  // Resource limits (OOM, disk, cpu)
  if (
    combined.includes("out of memory") ||
    combined.includes("heap out of memory") ||
    combined.includes("allocation failed") ||
    combined.includes("memory limit") ||
    combined.includes("killed") ||
    combined.includes("oom")
  ) {
    return {
      type: "resource",
      hint: "Exceeded memory limit. Reduce data size, avoid large arrays/objects, or aggregate in SQL instead.",
    };
  }

  // Output too large
  if (
    combined.includes("output truncated") ||
    combined.includes("output size exceeded")
  ) {
    return {
      type: "output",
      hint: "Output is too large. Aggregate or summarize results instead of returning raw data.",
    };
  }

  // Runtime errors (TypeError, ReferenceError, RangeError, etc.)
  if (
    combined.includes("typeerror") ||
    combined.includes("referenceerror") ||
    combined.includes("rangeerror") ||
    combined.includes("cannot read properties") ||
    combined.includes("is not a function") ||
    combined.includes("is not defined") ||
    combined.includes("undefined is not")
  ) {
    return {
      type: "runtime",
      hint: "Runtime error in the code. Check for null/undefined access, wrong types, or undefined variables.",
    };
  }

  // SQL errors
  if (
    combined.includes("sql") &&
    (combined.includes("error") || combined.includes("failed"))
  ) {
    return {
      type: "sql",
      hint: "The SQL query failed. Check table/column names, syntax, and data types.",
    };
  }

  return {
    type: "unknown",
    hint: "An unexpected error occurred. Review the error message and try a different approach.",
  };
}

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface SandboxInput {
  /** Code to execute in the sandbox (JavaScript for bun:1/node, Python for python) */
  code: string;
  /** Optional SQL SELECT query to run first — results are passed as DATA to the sandbox */
  sqlQuery?: string;
  /** Plain text explanation of what this analysis does */
  explanation: string;
  /** Optional pre-built data to pass directly (bypasses SQL) */
  data?: unknown;
  /** Execution timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Maximum output size in bytes (default: 512KB) */
  maxOutputBytes?: number;
  /** Runtime to use (default: "bun:1") */
  runtime?: SandboxRuntime;
  /** Snapshot ID to restore from (faster cold start with pre-installed deps) */
  snapshotId?: string;
  /** Dependencies to pre-install (e.g. ["simple-statistics", "date-fns"]) */
  dependencies?: string[];
  /** Memory limit (e.g. "256MB", "512MB") */
  memory?: string;
}

export interface SandboxResult {
  /** Whether execution succeeded */
  success: boolean;
  /** The parsed JSON result from the sandbox (stdout) */
  result?: unknown;
  /** Raw stdout from the sandbox (may be truncated) */
  stdout?: string;
  /** Stderr output (errors, warnings) */
  stderr?: string;
  /** Exit code from the sandbox process */
  exitCode?: number;
  /** Number of data rows passed to the sandbox */
  dataRowCount?: number;
  /** Error message if something failed */
  error?: string;
  /** What this analysis does */
  explanation: string;
  /** Classified error type for LLM self-correction */
  errorType?: SandboxErrorType;
  /** Human-readable hint for fixing the error */
  errorHint?: string;
  /** Whether stdout was truncated due to size limits */
  outputTruncated?: boolean;
  /** Runtime that was used */
  runtime?: SandboxRuntime;
}

/**
 * Options for retry-with-correction behavior.
 */
export interface RetryOptions {
  /** Maximum number of retries (default: 2) */
  maxRetries?: number;
  /** Function that receives the failed result and returns corrected code,
   *  or null to stop retrying. */
  correctCode?: (
    failedResult: SandboxResult,
    attempt: number
  ) => Promise<string | null>;
}

/**
 * Interactive sandbox session for multi-step execution.
 * Wraps a persistent sandbox instance with lifecycle management.
 */
export interface SandboxSession {
  /** Execute code in the session's sandbox */
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Write a file to the session's sandbox filesystem */
  writeFile(path: string, content: string): Promise<void>;
  /** Take a snapshot of the current session state */
  snapshot(): Promise<{ id: string }>;
  /** Destroy the session (cleanup) */
  destroy(): Promise<void>;
  /** The runtime this session uses */
  readonly runtime: SandboxRuntime;
  /** Whether the session has been destroyed */
  readonly destroyed: boolean;
}

// ────────────────────────────────────────────────────────────
// SQL safety check
// ────────────────────────────────────────────────────────────

function isSafeSelect(query: string): boolean {
  const trimmed = query.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) return false;
  const dangerous = [
    "DROP", "DELETE", "INSERT", "UPDATE", "ALTER",
    "TRUNCATE", "GRANT", "REVOKE", "CREATE",
  ];
  for (const keyword of dangerous) {
    const pattern = new RegExp(`\\b${keyword}\\b`, "i");
    const withoutStrings = query.replace(/'[^']*'/g, "");
    if (pattern.test(withoutStrings)) return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────
// Script builders (per-runtime)
// ────────────────────────────────────────────────────────────

/**
 * Builds the wrapper script for Bun/Node runtime.
 * Reads DATA from stdin, runs analysis code, outputs JSON to stdout.
 */
function buildBunScript(analysisCode: string): string {
  return `
// ── Sandbox wrapper ──────────────────────────────
const chunks = [];
const reader = Bun.stdin.stream().getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
}
const rawInput = Buffer.concat(chunks).toString("utf-8");
const DATA = rawInput ? JSON.parse(rawInput) : [];

// ── Analysis code (LLM-generated) ────────────────
try {
  const __analysisResult = await (async () => {
    ${analysisCode}
  })();
  if (__analysisResult !== undefined) {
    console.log(JSON.stringify(__analysisResult));
  }
} catch (err) {
  console.error("Analysis error: " + (err?.message || String(err)));
  process.exit(1);
}
`;
}

/**
 * Builds the wrapper script for Python runtime.
 * Reads DATA from stdin as JSON, runs analysis code, outputs JSON to stdout.
 */
function buildPythonScript(analysisCode: string): string {
  return `
import sys
import json

# Read DATA from stdin
raw_input = sys.stdin.read()
DATA = json.loads(raw_input) if raw_input.strip() else []

# Analysis code (LLM-generated)
try:
    def __run_analysis():
${analysisCode.split("\n").map((line) => `        ${line}`).join("\n")}

    __result = __run_analysis()
    if __result is not None:
        print(json.dumps(__result))
except Exception as e:
    print(f"Analysis error: {e}", file=sys.stderr)
    sys.exit(1)
`;
}

/** Build the appropriate wrapper script for the given runtime. */
function buildScript(runtime: SandboxRuntime, code: string): string {
  switch (runtime) {
    case "python":
      return buildPythonScript(code);
    case "bun:1":
    case "node":
    default:
      return buildBunScript(code);
  }
}

/** Get the execution command for the given runtime. */
function getExecCommand(runtime: SandboxRuntime, scriptFile: string): string {
  switch (runtime) {
    case "python":
      return `cat data.json | python3 ${scriptFile}`;
    case "node":
      return `cat data.json | node ${scriptFile}`;
    case "bun:1":
    default:
      return `cat data.json | bun run ${scriptFile}`;
  }
}

/** Get the script file extension for the given runtime. */
function getScriptExt(runtime: SandboxRuntime): string {
  switch (runtime) {
    case "python":
      return "py";
    case "node":
      return "js";
    case "bun:1":
    default:
      return "ts";
  }
}

// ────────────────────────────────────────────────────────────
// Output processing
// ────────────────────────────────────────────────────────────

/** Truncate stdout if it exceeds the size limit. */
function truncateOutput(
  stdout: string,
  maxBytes: number
): { output: string; truncated: boolean } {
  const byteLength = new TextEncoder().encode(stdout).length;
  if (byteLength <= maxBytes) {
    return { output: stdout, truncated: false };
  }
  const ratio = maxBytes / byteLength;
  const approxChars = Math.floor(stdout.length * ratio * 0.95);
  return {
    output: stdout.slice(0, approxChars) + "\n\n[OUTPUT TRUNCATED — output size exceeded limit]",
    truncated: true,
  };
}

// ────────────────────────────────────────────────────────────
// Data fetching (shared between execution modes)
// ────────────────────────────────────────────────────────────

interface FetchedData {
  data: unknown;
  dataRowCount: number;
  error?: SandboxResult;
}

async function fetchData(
  sqlQuery: string | undefined,
  directData: unknown | undefined,
  explanation: string
): Promise<FetchedData> {
  let data: unknown = directData ?? [];
  let dataRowCount = 0;

  if (sqlQuery?.trim()) {
    if (!isSafeSelect(sqlQuery)) {
      return {
        data: [],
        dataRowCount: 0,
        error: {
          success: false,
          error: "Only SELECT/WITH queries are allowed. Dangerous SQL keywords detected.",
          errorType: "sql",
          errorHint: "Rewrite the query as a SELECT or WITH statement. DML/DDL is not allowed.",
          explanation,
        },
      };
    }

    try {
      const result = await db.execute(sql.raw(sqlQuery));
      const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
      data = rows.slice(0, MAX_DATA_ROWS);
      dataRowCount = rows.length;
    } catch (err: any) {
      const { type, hint } = classifyError("", "", err.message);
      return {
        data: [],
        dataRowCount: 0,
        error: {
          success: false,
          error: `SQL query failed: ${err.message}`,
          errorType: type === "unknown" ? "sql" : type,
          errorHint: hint,
          explanation,
        },
      };
    }
  } else if (Array.isArray(directData)) {
    dataRowCount = directData.length;
  }

  return { data, dataRowCount };
}

// ────────────────────────────────────────────────────────────
// Main execution function
// ────────────────────────────────────────────────────────────

/**
 * Execute LLM-generated code in an isolated sandbox.
 *
 * Supports bun:1 (default), python, and node runtimes.
 * Includes error classification, output size limits, and optional
 * snapshot restore for faster cold starts.
 *
 * @param sandboxApi - The sandbox API from the agent context (`ctx.sandbox`)
 * @param input - The code, optional SQL, and configuration
 * @returns Structured result with parsed output, error classification, or retry hints
 */
export async function executeSandbox(
  sandboxApi: any,
  input: SandboxInput
): Promise<SandboxResult> {
  const {
    code,
    sqlQuery,
    explanation,
    data: directData,
    timeoutMs = 30_000,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    runtime = "bun:1",
    snapshotId,
    dependencies,
    memory = "256MB",
  } = input;

  // ── Step 1: Get data (from SQL or direct) ───────────────
  const fetched = await fetchData(sqlQuery, directData, explanation);
  if (fetched.error) return fetched.error;
  const { data, dataRowCount } = fetched;

  // ── Step 2: Build and execute in sandbox ────────────────
  const scriptExt = getScriptExt(runtime);
  const scriptFile = `analysis.${scriptExt}`;
  const script = buildScript(runtime, code);
  const dataJson = JSON.stringify(data);

  let sandbox: any = null;
  try {
    // Create sandbox with optional snapshot restore and dependencies
    const createOpts: Record<string, any> = {
      runtime,
      resources: { memory, cpu: 1, disk: "256MB" },
      network: { enabled: false },
      timeout: {
        idle: timeoutMs + 5_000,
        execution: timeoutMs + 5_000,
      },
    };

    if (snapshotId) {
      createOpts.snapshot = snapshotId;
    }
    if (dependencies?.length) {
      createOpts.dependencies = dependencies;
    }

    sandbox = await sandboxApi.create(createOpts);

    // Write files to sandbox
    await sandbox.writeFile(scriptFile, script);
    await sandbox.writeFile("data.json", dataJson);

    // Execute
    const execCommand = getExecCommand(runtime, scriptFile);
    const result = await sandbox.exec(execCommand);

    let stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    const exitCode = result.exitCode ?? 0;

    // ── Step 3: Process output ──────────────────────────────
    const { output: processedStdout, truncated } = truncateOutput(stdout, maxOutputBytes);
    stdout = processedStdout;

    if (truncated) {
      return {
        success: false,
        stdout,
        stderr,
        exitCode,
        dataRowCount,
        error: "Output size exceeded limit. Aggregate or summarize results instead of returning raw data.",
        errorType: "output",
        errorHint: "The output is too large. Return aggregated summaries instead of full datasets.",
        outputTruncated: true,
        explanation,
        runtime,
      };
    }

    if (exitCode !== 0) {
      const { type, hint } = classifyError(stderr, stdout);
      return {
        success: false,
        stdout,
        stderr,
        exitCode,
        dataRowCount,
        error: `Sandbox exited with code ${exitCode}: ${stderr || stdout}`,
        errorType: type,
        errorHint: hint,
        explanation,
        runtime,
      };
    }

    // Parse the last line of stdout as JSON
    let parsed: unknown;
    try {
      const lines = stdout.split("\n");
      const lastLine = lines[lines.length - 1];
      parsed = JSON.parse(lastLine);
    } catch {
      parsed = stdout;
    }

    return {
      success: true,
      result: parsed,
      stdout,
      stderr: stderr || undefined,
      exitCode,
      dataRowCount,
      explanation,
      runtime,
    };
  } catch (err: any) {
    const errMsg = err.message || String(err);
    const { type, hint } = classifyError("", "", errMsg);
    return {
      success: false,
      error: `Sandbox execution failed: ${errMsg}`,
      errorType: type,
      errorHint: hint,
      explanation,
      runtime,
    };
  } finally {
    // Always clean up the sandbox
    if (sandbox) {
      try {
        await sandbox.destroy?.();
      } catch {
        // Sandbox may already be destroyed by timeout — ignore
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// Retry-with-correction wrapper
// ────────────────────────────────────────────────────────────

/**
 * Execute sandbox code with automatic retry on failure.
 * When execution fails, calls the `correctCode` function with the
 * error details so the LLM can fix the code and retry.
 *
 * @param sandboxApi - The sandbox API from the agent context
 * @param input - The initial code and configuration
 * @param retryOptions - Retry configuration with correction function
 * @returns The final result (success or last failure after retries exhausted)
 */
export async function executeSandboxWithRetry(
  sandboxApi: any,
  input: SandboxInput,
  retryOptions: RetryOptions
): Promise<SandboxResult & { attempts: number }> {
  const { maxRetries = 2, correctCode } = retryOptions;

  let currentInput = { ...input };
  let lastResult: SandboxResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await executeSandbox(sandboxApi, currentInput);

    if (result.success) {
      return { ...result, attempts: attempt + 1 };
    }

    lastResult = result;

    // Don't retry on errors that can't be fixed by code correction
    if (
      result.errorType === "sql" ||
      result.errorType === "output" ||
      result.errorType === "resource"
    ) {
      return { ...result, attempts: attempt + 1 };
    }

    // If we have retries left and a correction function, try to fix
    if (attempt < maxRetries && correctCode) {
      const correctedCode = await correctCode(result, attempt + 1);
      if (!correctedCode) {
        return { ...result, attempts: attempt + 1 };
      }
      currentInput = { ...currentInput, code: correctedCode };
    }
  }

  return { ...lastResult!, attempts: maxRetries + 1 };
}

// ────────────────────────────────────────────────────────────
// Interactive Sandbox Sessions
// ────────────────────────────────────────────────────────────

/**
 * Create a persistent interactive sandbox session.
 *
 * Sessions allow multiple commands to be executed in the same sandbox,
 * which is more efficient for multi-step analyses (load data once,
 * run multiple computations).
 *
 * The caller is responsible for calling `session.destroy()` when done.
 */
export async function createSandboxSession(
  sandboxApi: any,
  options: {
    runtime?: SandboxRuntime;
    snapshotId?: string;
    dependencies?: string[];
    memory?: string;
    idleTimeoutMs?: number;
    executionTimeoutMs?: number;
  } = {}
): Promise<SandboxSession> {
  const {
    runtime = "bun:1",
    snapshotId,
    dependencies,
    memory = "256MB",
    idleTimeoutMs = 300_000,
    executionTimeoutMs = 60_000,
  } = options;

  const createOpts: Record<string, any> = {
    runtime,
    resources: { memory, cpu: 1, disk: "256MB" },
    network: { enabled: false },
    timeout: { idle: idleTimeoutMs, execution: executionTimeoutMs },
  };

  if (snapshotId) createOpts.snapshot = snapshotId;
  if (dependencies?.length) createOpts.dependencies = dependencies;

  const sandbox = await sandboxApi.create(createOpts);
  let isDestroyed = false;

  return {
    get runtime() { return runtime; },
    get destroyed() { return isDestroyed; },

    async exec(command: string) {
      if (isDestroyed) throw new Error("Sandbox session has been destroyed");
      const result = await sandbox.exec(command);
      return {
        stdout: (result.stdout || "").trim(),
        stderr: (result.stderr || "").trim(),
        exitCode: result.exitCode ?? 0,
      };
    },

    async writeFile(path: string, content: string) {
      if (isDestroyed) throw new Error("Sandbox session has been destroyed");
      await sandbox.writeFile(path, content);
    },

    async snapshot() {
      if (isDestroyed) throw new Error("Sandbox session has been destroyed");
      return sandbox.snapshot();
    },

    async destroy() {
      if (isDestroyed) return;
      isDestroyed = true;
      try { await sandbox.destroy?.(); } catch { /* ignore */ }
    },
  };
}

// ────────────────────────────────────────────────────────────
// Snapshot helpers
// ────────────────────────────────────────────────────────────

/** Default dependencies for the analysis snapshot. */
export const ANALYSIS_DEPENDENCIES = [
  "simple-statistics",
  "date-fns",
  "lodash",
];

/**
 * Create a base analysis snapshot with common statistical dependencies.
 * Run once (e.g., during setup or via admin action) and store the
 * returned snapshot ID in agent_configs for reuse.
 */
export async function createAnalysisSnapshot(
  sandboxApi: any,
  runtime: SandboxRuntime = "bun:1",
  extraDeps: string[] = []
): Promise<{ snapshotId: string }> {
  const deps = [...ANALYSIS_DEPENDENCIES, ...extraDeps];
  const sandbox = await sandboxApi.create({
    runtime,
    resources: { memory: "512MB", cpu: 1, disk: "512MB" },
    network: { enabled: true }, // Need network to install packages
    timeout: { idle: 120_000, execution: 120_000 },
  });

  try {
    if (runtime === "bun:1") {
      await sandbox.exec(`bun add ${deps.join(" ")}`);
    } else if (runtime === "python") {
      await sandbox.exec(`pip install ${deps.join(" ")}`);
    } else if (runtime === "node") {
      await sandbox.exec(`npm install ${deps.join(" ")}`);
    }

    const snapshot = await sandbox.snapshot();
    return { snapshotId: snapshot.id };
  } finally {
    try { await sandbox.destroy?.(); } catch { /* ignore */ }
  }
}
