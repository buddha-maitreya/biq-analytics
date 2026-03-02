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
import type { SandboxRunOptions, SandboxRunResult, SandboxService } from "@agentuity/core";
import { getAnalyticsFiles } from "@lib/analytics-scripts";
import { getAnalyticsConfig } from "@services/analytics-configs";

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
  sandboxApi: Pick<SandboxService, "run">,
  chartSpecs: ChartSpec[],
  options?: {
    /** Override chart styling config */
    chartConfig?: Record<string, unknown>;
    /** Timeout override (default: "120s") */
    timeout?: string;
  }
): Promise<PreRenderedImage[]> {
  if (!chartSpecs.length) return [];

  // ── Snapshot resolution (platform concern, not per-tenant) ──────────────
  // ANALYTICS_SNAPSHOT_ID is set ONCE by the platform operator (you, the SaaS
  // developer) in your Agentuity project's environment variables. It is NOT a
  // per-client/tenant config. All tenants share the same universal Python
  // runtime image (numpy, pandas, matplotlib, scipy, sklearn) because every
  // industry needs the same data-science packages. What differs per tenant is
  // the DATA and the LLM-generated code — both handled dynamically.
  //
  // Without a snapshot: sandbox still runs via python:3.13 + uv pip install
  // (~10-15s cold start vs ~0s with snapshot). Works correctly, just slower.
  // Set up the snapshot once per Agentuity project:
  //   agentuity sandbox snapshot create --runtime python:3.13 \
  //     --packages "numpy pandas matplotlib seaborn scipy scikit-learn statsmodels psycopg2-binary"
  //   agentuity cloud env set ANALYTICS_SNAPSHOT_ID=<snapshot_id>
  const snapshotId = process.env.ANALYTICS_SNAPSHOT_ID || undefined;

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
    const result = await sandboxApi.run({
      command: {
        exec: ["python3", "main.py"],
        files: commandFiles,
      },
      ...(snapshotId
        ? { snapshot: snapshotId }
        : { runtime: "python:3.13" as const }),
      resources: {
        memory: "512Mi",
        cpu: "500m",
      },
      timeout: { execution: options?.timeout ?? "120s" },
      network: { enabled: !snapshotId },
    });

    if (result.exitCode !== 0) {
      console.error(
        `[python-charts] Sandbox failed (exit ${result.exitCode}):`,
        result.stderr || result.stdout
      );
      return [];
    }

    // Parse stdout — scan backward for last line that is valid JSON.
    // Python may print warnings or debug text after the JSON output, so
    // taking only the last line fails when non-JSON text follows the payload.
    //
    // IMPORTANT: The Agentuity sandbox prepends a nanosecond ISO timestamp to
    // every line of stdout, e.g.:
    //   "2026-03-01T14:58:14.686553200Z {"charts": [...]}"
    // Strip that prefix before checking whether a line starts with { or [.
    const stdout = (result.stdout || "").trim();
    if (!stdout) return [];

    const sandboxTsPrefix = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/;
    const lines = stdout.split("\n");
    let parsed: any = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim().replace(sandboxTsPrefix, "");
      if (line.startsWith("{") || line.startsWith("[")) {
        try { parsed = JSON.parse(line); break; } catch { /* try previous line */ }
      }
    }
    if (!parsed) throw new Error(`No valid JSON in sandbox output. Preview: ${stdout.slice(0, 300)}`);

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
 * Currently disabled — tables-only mode to avoid sandbox cold-start latency.
 * Re-enable by returning true when Python/matplotlib sandbox is ready.
 */
export function isPythonChartsAvailable(): boolean {
  return false;
}
