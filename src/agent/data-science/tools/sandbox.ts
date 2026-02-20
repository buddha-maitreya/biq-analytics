/**
 * Data Science Agent -- Sandbox execution tool
 *
 * createRunAnalysisTool: Factory that creates a per-request sandbox
 * tool with the sandbox API captured via closure. This ensures
 * concurrent requests never share sandbox references.
 *
 * Phase 4 enhancements:
 * - Structured error classification (errorType, errorHint) for LLM self-correction
 * - Optional snapshot ID for pre-installed dependencies
 * - Runtime selection (bun:1, python, node)
 */

import { tool } from "ai";
import { z } from "zod";
import { executeSandbox } from "@lib/sandbox";
import type { SandboxRuntime } from "@lib/sandbox";

export function createRunAnalysisTool(
  sandboxApi: any,
  sandboxTimeoutMs: number = 30_000,
  options: {
    snapshotId?: string;
    runtime?: SandboxRuntime;
    dependencies?: string[];
    memory?: string;
  } = {}
) {
  const {
    snapshotId,
    runtime = "bun:1",
    dependencies,
    memory,
  } = options;

  const runtimeLabel = runtime === "python" ? "Python 3" : runtime === "node" ? "Node.js" : "Bun 1.x";
  const depsNote = snapshotId || dependencies?.length
    ? `Available packages: ${dependencies?.join(", ") ?? "pre-installed in snapshot"}.`
    : "You have NO npm packages -- use only built-in JavaScript/Bun APIs.";

  return tool({
    description: `Execute ${runtimeLabel} code in an isolated sandbox to perform sophisticated data analysis.
Use this tool for computations BEYOND simple SQL: statistical calculations, moving averages, standard deviations, trend projections, percentage changes, data transformations, ranking algorithms, time-series analysis, anomaly scoring, forecasting, cohort analysis, etc.

HOW IT WORKS:
1. You write a SQL query to fetch the raw data you need
2. You write ${runtimeLabel} code that processes that data
3. The SQL results are available as the variable DATA (an array of row objects)
4. Your code MUST return a result (the last expression or an explicit return)
5. The sandbox has NO network access and a ${sandboxTimeoutMs / 1000}-second timeout

IMPORTANT RULES:
- DATA is an array of objects (SQL result rows), e.g. [{name: "Widget", total_sold: 150}, ...]
- Your code MUST return a value -- this is what gets sent back as the result
- ${depsNote}
- Keep computations efficient -- you have ${sandboxTimeoutMs / 1000} seconds max
- For large datasets, work with aggregated SQL data rather than raw rows
- If execution fails, you'll receive an error type and fix hint -- use them to correct your code`,
    parameters: z.object({
      sqlQuery: z
        .string()
        .optional()
        .describe(
          "PostgreSQL SELECT query to fetch data. Results become the DATA variable in the sandbox."
        ),
      code: z
        .string()
        .describe(
          `${runtimeLabel} code to execute in the sandbox. Receives DATA (array of row objects from SQL). Must RETURN a result.`
        ),
      explanation: z
        .string()
        .describe(
          "Plain English description of what this analysis does and why"
        ),
    }),
    execute: async ({ sqlQuery, code, explanation }) => {
      if (!sandboxApi) {
        return {
          error:
            "Sandbox not available -- falling back to query_database for this request.",
          explanation,
        };
      }

      const result = await executeSandbox(sandboxApi, {
        code,
        sqlQuery,
        explanation,
        timeoutMs: sandboxTimeoutMs,
        runtime,
        snapshotId,
        dependencies,
        memory,
      });

      if (!result.success) {
        return {
          error: result.error,
          errorType: result.errorType,
          errorHint: result.errorHint,
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
