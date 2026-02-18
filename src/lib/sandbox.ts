/**
 * Sandbox Execution Helper — shared utility for running LLM-generated
 * JavaScript code in isolated Agentuity Bun sandboxes.
 *
 * Architecture:
 *   1. LLM generates JavaScript code + optional SQL query
 *   2. If SQL is provided, we execute it against the DB first
 *   3. Data is serialized as JSON and injected into the sandbox
 *   4. The sandbox runs the code in `bun:1` with NO network access
 *   5. The sandbox must write its JSON result to stdout
 *   6. We parse stdout and return structured results
 *
 * Security:
 *   - Network is ALWAYS disabled (no exfiltration)
 *   - Only SELECT queries are allowed (safety-checked)
 *   - Execution timeout: 30 seconds
 *   - Memory limit: 256MB
 *   - Code runs in full isolation — no host access
 */

import { db } from "@db/index";
import { sql } from "drizzle-orm";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface SandboxInput {
  /** JavaScript code to execute in the Bun sandbox.
   *  The code receives `DATA` as a global variable (parsed JSON of the query results).
   *  It MUST call `console.log(JSON.stringify(result))` to output its result. */
  code: string;
  /** Optional SQL SELECT query to run first — results are passed as DATA to the sandbox */
  sqlQuery?: string;
  /** Plain text explanation of what this analysis does */
  explanation: string;
  /** Optional pre-built data to pass directly (bypasses SQL) */
  data?: unknown;
  /** Execution timeout in ms (default: 30000) */
  timeoutMs?: number;
}

export interface SandboxResult {
  /** Whether execution succeeded */
  success: boolean;
  /** The parsed JSON result from the sandbox (stdout) */
  result?: unknown;
  /** Raw stdout from the sandbox */
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
}

// ────────────────────────────────────────────────────────────
// SQL safety check
// ────────────────────────────────────────────────────────────

function isSafeSelect(query: string): boolean {
  const trimmed = query.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) return false;
  const dangerous = ["DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "TRUNCATE", "GRANT", "REVOKE", "CREATE"];
  for (const keyword of dangerous) {
    // Check for the keyword as a standalone word (not inside a string literal)
    const pattern = new RegExp(`\\b${keyword}\\b`, "i");
    // Remove string literals before checking
    const withoutStrings = query.replace(/'[^']*'/g, "");
    if (pattern.test(withoutStrings)) return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────
// Sandbox wrapper code
// ────────────────────────────────────────────────────────────

/**
 * Builds the wrapper script that executes inside the Bun sandbox.
 *
 * The wrapper:
 *   1. Reads DATA from stdin (piped as JSON)
 *   2. Parses it into a global `DATA` variable
 *   3. Executes the user's analysis code
 *   4. Catches errors and reports them cleanly
 */
function buildSandboxScript(analysisCode: string): string {
  // We use a wrapper that reads stdin, sets DATA, runs the analysis code,
  // and ensures the result is output as JSON to stdout.
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

// ────────────────────────────────────────────────────────────
// Main execution function
// ────────────────────────────────────────────────────────────

/**
 * Execute LLM-generated JavaScript code in an isolated Bun sandbox.
 *
 * @param sandboxApi - The sandbox API from the agent context (`ctx.sandbox`)
 * @param input - The code, optional SQL, and explanation
 * @returns Structured result with parsed output or error details
 */
export async function executeSandbox(
  sandboxApi: any, // ctx.sandbox — typed as any since the SDK types aren't exported
  input: SandboxInput
): Promise<SandboxResult> {
  const { code, sqlQuery, explanation, data: directData, timeoutMs = 30000 } = input;

  // ── Step 1: Get data (from SQL or direct) ───────────────
  let data: unknown = directData ?? [];
  let dataRowCount = 0;

  if (sqlQuery?.trim()) {
    if (!isSafeSelect(sqlQuery)) {
      return {
        success: false,
        error: "Only SELECT/WITH queries are allowed. Dangerous SQL keywords detected.",
        explanation,
      };
    }

    try {
      const result = await db.execute(sql.raw(sqlQuery));
      const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
      data = rows.slice(0, 500); // Cap at 500 rows to avoid sandbox memory issues
      dataRowCount = rows.length;
    } catch (err: any) {
      return {
        success: false,
        error: `SQL query failed: ${err.message}`,
        explanation,
      };
    }
  } else if (Array.isArray(directData)) {
    dataRowCount = directData.length;
  }

  // ── Step 2: Build and execute in sandbox ────────────────
  const script = buildSandboxScript(code);
  const dataJson = JSON.stringify(data);

  try {
    // Use the one-shot sandbox.run() API with bun:1 runtime
    // We write a temp script file, pipe data via stdin
    const sandbox = await sandboxApi.create({
      runtime: "bun:1",
      resources: {
        memory: "256MB",
        cpu: 1,
        disk: "256MB",
      },
      network: {
        enabled: false, // NO network — maximum safety
      },
      timeout: {
        idle: timeoutMs + 5000,
        execution: timeoutMs + 5000,
      },
    });

    // Write the analysis script to the sandbox filesystem
    await sandbox.writeFile("analysis.ts", script);

    // Write the data to a file (stdin piping approach)
    await sandbox.writeFile("data.json", dataJson);

    // Execute: read data from file and pipe to script via bun
    const result = await sandbox.exec(
      `cat data.json | bun run analysis.ts`
    );

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    const exitCode = result.exitCode ?? 0;

    // ── Step 3: Parse result ────────────────────────────────
    if (exitCode !== 0) {
      return {
        success: false,
        stdout,
        stderr,
        exitCode,
        dataRowCount,
        error: `Sandbox exited with code ${exitCode}: ${stderr || stdout}`,
        explanation,
      };
    }

    // Try to parse the last line of stdout as JSON
    let parsed: unknown;
    try {
      // The analysis may log multiple things; the last line should be the JSON result
      const lines = stdout.split("\n");
      const lastLine = lines[lines.length - 1];
      parsed = JSON.parse(lastLine);
    } catch {
      // If it's not JSON, return the raw stdout
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
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Sandbox execution failed: ${err.message || String(err)}`,
      explanation,
    };
  }
}

/**
 * Execute a simple one-shot sandbox run (for simpler use cases).
 * Uses sandbox.run() directly — no interactive session needed.
 */
export async function executeSandboxOneShot(
  sandboxApi: any,
  input: SandboxInput
): Promise<SandboxResult> {
  const { code, sqlQuery, explanation, data: directData, timeoutMs = 30000 } = input;

  // ── Step 1: Get data ────────────────────────────────────
  let data: unknown = directData ?? [];
  let dataRowCount = 0;

  if (sqlQuery?.trim()) {
    if (!isSafeSelect(sqlQuery)) {
      return {
        success: false,
        error: "Only SELECT/WITH queries are allowed.",
        explanation,
      };
    }

    try {
      const result = await db.execute(sql.raw(sqlQuery));
      const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
      data = rows.slice(0, 500);
      dataRowCount = rows.length;
    } catch (err: any) {
      return {
        success: false,
        error: `SQL query failed: ${err.message}`,
        explanation,
      };
    }
  } else if (Array.isArray(directData)) {
    dataRowCount = directData.length;
  }

  // ── Step 2: Build inline script ─────────────────────────
  // For one-shot, we embed the data directly into the script
  // (works for smaller payloads)
  const inlineScript = `
const DATA = ${JSON.stringify(data)};
try {
  const __result = await (async () => {
    ${code}
  })();
  if (__result !== undefined) {
    console.log(JSON.stringify(__result));
  }
} catch (err) {
  console.error("Analysis error: " + (err?.message || String(err)));
  process.exit(1);
}
`;

  try {
    const result = await sandboxApi.run({
      runtime: "bun:1",
      command: `bun eval '${inlineScript.replace(/'/g, "'\\''")}'`,
      timeout: { execution: timeoutMs },
      network: { enabled: false },
      resources: { memory: "256MB", cpu: 1 },
    });

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    const exitCode = result.exitCode ?? 0;

    if (exitCode !== 0) {
      return {
        success: false,
        stdout,
        stderr,
        exitCode,
        dataRowCount,
        error: `Sandbox exited with code ${exitCode}: ${stderr || stdout}`,
        explanation,
      };
    }

    let parsed: unknown;
    try {
      const lines = stdout.split("\n");
      parsed = JSON.parse(lines[lines.length - 1]);
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
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Sandbox execution failed: ${err.message || String(err)}`,
      explanation,
    };
  }
}
