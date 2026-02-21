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
    runtime = "python:3.14",
    dependencies,
    memory,
  } = options;

  const isPython = runtime === "python" || runtime.startsWith("python:");
  const runtimeLabel = isPython ? "Python 3 (numpy/pandas/scipy/sklearn/statsmodels)"
    : runtime === "node" || runtime.startsWith("node:") ? "Node.js" : "Bun 1.x";
  const depsNote = snapshotId
    ? `Packages pre-installed in snapshot${dependencies?.length ? ` (${dependencies.join(", ")})` : isPython ? " (numpy, pandas, scipy, scikit-learn, statsmodels)" : ""}.`
    : isPython
      ? "You have the Python standard library. For advanced analytics, prefer a snapshot with numpy/pandas/scipy/sklearn/statsmodels pre-installed."
      : "You have NO npm packages -- use only built-in JavaScript APIs.";

  return tool({
    description: `Execute ${runtimeLabel} code in an isolated sandbox to perform sophisticated data analysis.
Use this tool for computations BEYOND simple SQL: statistical calculations, moving averages, standard deviations, trend projections, percentage changes, data transformations, ranking algorithms, time-series analysis, anomaly scoring, forecasting, cohort analysis, etc.

HOW IT WORKS:
1. You write a SQL query to fetch the raw data you need
2. You write ${isPython ? "Python" : runtimeLabel} code that processes that data
3. The SQL results are available as DATA (${isPython ? "a list of dicts" : "an array of row objects"})${isPython ? " and DF (a pandas DataFrame)" : ""}
4. Your code MUST return a result (${isPython ? "use return {...}" : "the last expression or an explicit return"})
5. The sandbox has NO network access and a ${sandboxTimeoutMs / 1000}-second timeout

${isPython ? `PYTHON ENVIRONMENT:
- DATA: list of dicts (SQL rows), e.g. [{"name": "Widget", "total_sold": 150}, ...]
- DF: pandas DataFrame of the same data (date columns auto-parsed)
- Pre-imported: numpy (np), pandas (pd), scipy.stats, sklearn, statsmodels, datetime, math, json
- Use vectorized pandas/numpy ops over loops for performance
- All numpy/pandas types auto-serialize to JSON` : `IMPORTANT RULES:
- DATA is an array of objects (SQL result rows), e.g. [{name: "Widget", total_sold: 150}, ...]
- Your code MUST return a value -- this is what gets sent back as the result`}
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
          `${isPython ? "Python" : runtimeLabel} code to execute. DATA is ${isPython ? "a list of dicts (SQL rows). DF is a pandas DataFrame" : "an array of row objects from SQL"}. Must RETURN a result.`
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
