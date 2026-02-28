/**
 * Python Chart Rendering Service — Routes ChartSpec[] through Python/matplotlib.
 *
 * This is the Python-first replacement for the Vega-Lite rendering pipeline.
 * Instead of ChartSpec → Vega-Lite → SVG → Sharp → basic PNG, this routes
 * chart specs to the Python sandbox where matplotlib renders enterprise-grade
 * charts with gradient fills, confidence bands, currency formatting, trend
 * lines, and watermarks.
 *
 * Usage:
 *   const charts = await renderChartsViaPython(sandboxApi, chartSpecs);
 *   // charts is PreRenderedImage[] — pass directly to exportReport()
 *
 * Falls back gracefully: returns empty array if sandbox is unavailable,
 * so callers can fall back to Vega-Lite rendering.
 */

import type { ChartSpec } from "@lib/charts";
import type { PreRenderedImage } from "@lib/report-export";
import { getAnalyticsFiles } from "@lib/analytics-scripts";
import { getAnalyticsConfig } from "@services/analytics-configs";

/** Sandbox API shape (same as analytics.ts) */
type SandboxApi = {
  run: (opts: Record<string, unknown>) => Promise<SandboxRunResult>;
};

/** Subset of SandboxRunResult we consume */
interface SandboxRunResult {
  sandboxId: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/**
 * Render an array of ChartSpec objects through Python/matplotlib.
 *
 * All chart specs are batched into a SINGLE sandbox call for efficiency
 * (one sandbox boot, one Python process, all charts rendered in sequence).
 *
 * @param sandboxApi - The sandbox API (`ctx.sandbox` or `c.var.sandbox`)
 * @param chartSpecs - Array of chart specifications (same format LLM generates)
 * @param options - Optional config overrides
 * @returns Array of pre-rendered images, or empty array on failure
 */
export async function renderChartsViaPython(
  sandboxApi: SandboxApi,
  chartSpecs: ChartSpec[],
  options?: {
    /** Override chart styling config */
    chartConfig?: Record<string, unknown>;
    /** Timeout override (default: "120s") */
    timeout?: string;
  }
): Promise<PreRenderedImage[]> {
  if (!chartSpecs.length) return [];

  // ── Check sandbox availability ────────────────────────────
  const snapshotId = process.env.ANALYTICS_SNAPSHOT_ID;
  if (!snapshotId) {
    console.warn(
      "[python-charts] ANALYTICS_SNAPSHOT_ID not set — falling back to Vega-Lite"
    );
    return [];
  }

  // ── Load chart config from DB (brand colors, currency, etc.) ──
  let chartConfig: Record<string, unknown> = options?.chartConfig ?? {};
  if (!options?.chartConfig) {
    try {
      const config = await getAnalyticsConfig("charts");
      chartConfig = config.params;
    } catch {
      // Non-critical — matplotlib will use defaults
    }
  }

  // ── Build input payload ───────────────────────────────────
  // chart.render uses params.charts instead of data[] (chart data
  // is embedded inside each spec)
  const inputPayload = {
    action: "chart.render",
    data: [], // Not used — chart data is in params.charts
    params: {
      charts: chartSpecs.map((spec) => ({
        type: spec.type,
        title: spec.title,
        data: spec.data,
        xField: spec.xField,
        yField: spec.yField,
        colorField: spec.colorField,
        xLabel: spec.xLabel,
        yLabel: spec.yLabel,
        width: spec.width ?? 1000,
        height: spec.height ?? 500,
      })),
    },
    chartConfig,
  };

  // ── Assemble Python files ─────────────────────────────────
  const pythonFiles = getAnalyticsFiles();
  const commandFiles = [
    ...pythonFiles.map((f) => ({
      path: f.path,
      content: Buffer.from(f.content),
    })),
    {
      path: "input.json",
      content: Buffer.from(JSON.stringify(inputPayload)),
    },
  ];

  // ── Execute in sandbox ────────────────────────────────────
  try {
    const result: SandboxRunResult = await sandboxApi.run({
      command: {
        exec: ["python3", "main.py"],
        files: commandFiles,
      },
      runtime: "python:3.13",
      snapshot: snapshotId,
      resources: {
        memory: "512Mi",
        cpu: "500m",
      },
      timeout: { execution: options?.timeout ?? "120s" },
      network: { enabled: false },
    });

    if (result.exitCode !== 0) {
      console.error(
        `[python-charts] Sandbox failed (exit ${result.exitCode}):`,
        result.stderr || result.stdout
      );
      return [];
    }

    // Parse stdout — last line is JSON output
    const stdout = (result.stdout || "").trim();
    if (!stdout) return [];

    const lines = stdout.split("\n");
    const parsed = JSON.parse(lines[lines.length - 1]);

    if (parsed.error) {
      console.error("[python-charts] Python error:", parsed.error);
      return [];
    }

    // Convert Python chart output to PreRenderedImage[]
    const charts: unknown[] = parsed.charts ?? [];
    return charts.map((c: any) => ({
      title: c.title ?? "Chart",
      data: c.data,
      width: c.width ?? 1000,
      height: c.height ?? 500,
    }));
  } catch (err) {
    console.error("[python-charts] Sandbox execution failed:", err);
    return [];
  }
}

/**
 * Check if Python chart rendering is available.
 * Returns true if ANALYTICS_SNAPSHOT_ID is configured.
 */
export function isPythonChartsAvailable(): boolean {
  return !!process.env.ANALYTICS_SNAPSHOT_ID;
}
