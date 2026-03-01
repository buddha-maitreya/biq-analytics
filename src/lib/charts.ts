/**
 * Chart Rendering Library — Server-side chart generation
 *
 * Uses Vega-Lite (declarative JSON specs) → Vega (SVG rendering) → Sharp (SVG→PNG)
 * to produce enterprise-grade charts embeddable in PDF, DOCX, XLSX, PPTX.
 *
 * Architecture:
 *   1. LLM generates chart specs as structured JSON alongside report markdown
 *   2. This library renders specs to PNG buffers (or SVG strings)
 *   3. report-export.ts embeds the chart images in each format
 *
 * Supported chart types (via Vega-Lite marks):
 *   bar, line, area, point (scatter), arc (pie/donut), rect (heatmap),
 *   tick, trail, circle, square, rule, text
 *
 * No DOM, no Canvas, no browser required — runs on Bun server-side.
 */

// Heavy deps loaded lazily to avoid bloating cold start time.
// vega-lite, vega, and sharp are only needed when actually rendering charts.
import type { TopLevelSpec } from "vega-lite";

let _vl: typeof import("vega-lite") | null = null;
let _vega: typeof import("vega") | null = null;
let _sharp: any = null;

async function getVl() {
  if (!_vl) _vl = await import("vega-lite");
  return _vl;
}
async function getVega() {
  if (!_vega) _vega = await import("vega");
  return _vega;
}
async function getSharp(): Promise<typeof import("sharp")> {
  if (!_sharp) {
    const mod = await import("sharp");
    _sharp = (mod as any).default ?? mod;
  }
  return _sharp;
}

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** Chart specification — what the LLM generates. */
export interface ChartSpec {
  /** Chart type hint (bar, line, area, pie, scatter, heatmap, donut, grouped_bar, stacked_bar) */
  type: string;
  /** Chart title */
  title: string;
  /** Inline data rows */
  data: Record<string, unknown>[];
  /** X-axis field name */
  xField?: string;
  /** Y-axis field name */
  yField?: string;
  /** Color/group field name (for multi-series, pie slices, etc.) */
  colorField?: string;
  /** X-axis label override */
  xLabel?: string;
  /** Y-axis label override */
  yLabel?: string;
  /** Width in pixels (default: 600) */
  width?: number;
  /** Height in pixels (default: 400) */
  height?: number;
}

/** Rendered chart output */
export interface RenderedChart {
  /** PNG image buffer (for embedding in PDF/DOCX/XLSX) */
  png: Buffer;
  /** SVG string (for PPTX fallback or direct use) */
  svg: string;
  /** Chart title */
  title: string;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/** The full output schema the LLM should return for a report with charts. */
export interface ReportWithCharts {
  /** Markdown report content */
  content: string;
  /** Chart specifications to render and embed */
  charts?: ChartSpec[];
}

// ────────────────────────────────────────────────────────────
// Brand-aware color palettes
// ────────────────────────────────────────────────────────────

/** Generate a professional color palette from a brand color. */
function buildPalette(brandColor: string): string[] {
  // Enterprise palette — brand color + professional complements
  return [
    brandColor,
    "#34d399", // emerald
    "#f59e0b", // amber
    "#8b5cf6", // violet
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#f97316", // orange
    "#6366f1", // indigo
    "#14b8a6", // teal
    "#e11d48", // rose
  ];
}

// ────────────────────────────────────────────────────────────
// Vega-Lite spec builder
// ────────────────────────────────────────────────────────────

/**
 * Convert a simplified ChartSpec into a full Vega-Lite specification.
 * Handles chart type mapping, axis labels, colors, and data binding.
 */
function buildVegaLiteSpec(
  chart: ChartSpec,
  brandColor: string = "#3b82f6"
): Record<string, unknown> {
  const w = chart.width ?? 700;
  const h = chart.height ?? 420;
  const palette = buildPalette(brandColor);

  // Common config for enterprise styling
  const vegaConfig = {
    background: "#ffffff",
    font: "Helvetica, Arial, sans-serif",
    padding: { left: 8, right: 8, top: 8, bottom: 8 },
    title: {
      fontSize: 16,
      fontWeight: 600,
      color: "#1f2937",
      anchor: "start" as const,
      offset: 12,
    },
    axis: {
      labelFontSize: 11,
      titleFontSize: 12,
      titleColor: "#4b5563",
      labelColor: "#6b7280",
      gridColor: "#e5e7eb",
      domainColor: "#d1d5db",
      tickColor: "#d1d5db",
    },
    legend: {
      labelFontSize: 11,
      titleFontSize: 12,
      symbolSize: 120,
    },
    view: {
      stroke: "transparent",
    },
    range: {
      category: palette,
    },
  };

  const type = chart.type.toLowerCase().replace(/[_\s-]+/g, "");

  // Pie / Donut — arc mark
  if (type === "pie" || type === "donut" || type === "arc") {
    const thetaField = chart.yField ?? "value";
    const colorField = chart.colorField ?? chart.xField ?? "label";
    return {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      title: chart.title,
      width: w,
      height: h,
      data: { values: chart.data },
      mark: {
        type: "arc",
        innerRadius: type === "donut" ? Math.min(w, h) * 0.25 : 0,
        stroke: "#ffffff",
        strokeWidth: 2,
      },
      encoding: {
        theta: { field: thetaField, type: "quantitative", stack: true },
        color: {
          field: colorField,
          type: "nominal",
          legend: { title: chart.xLabel ?? colorField },
        },
        tooltip: [
          { field: colorField, type: "nominal" },
          { field: thetaField, type: "quantitative", format: ",.2f" },
        ],
      },
      config: vegaConfig,
    };
  }

  // Scatter / Point
  if (type === "scatter" || type === "point") {
    const spec: Record<string, unknown> = {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      title: chart.title,
      width: w,
      height: h,
      data: { values: chart.data },
      mark: { type: "point", filled: true, size: 80, opacity: 0.8 },
      encoding: {
        x: {
          field: chart.xField ?? "x",
          type: "quantitative",
          title: chart.xLabel ?? chart.xField ?? "X",
        },
        y: {
          field: chart.yField ?? "y",
          type: "quantitative",
          title: chart.yLabel ?? chart.yField ?? "Y",
        },
        tooltip: [
          { field: chart.xField ?? "x", type: "quantitative" },
          { field: chart.yField ?? "y", type: "quantitative" },
        ],
      },
      config: vegaConfig,
    };
    if (chart.colorField) {
      (spec.encoding as any).color = {
        field: chart.colorField,
        type: "nominal",
      };
      (spec.encoding as any).tooltip.push({
        field: chart.colorField,
        type: "nominal",
      });
    }
    return spec;
  }

  // Heatmap / Rect
  if (type === "heatmap" || type === "rect") {
    return {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      title: chart.title,
      width: w,
      height: h,
      data: { values: chart.data },
      mark: "rect",
      encoding: {
        x: {
          field: chart.xField ?? "x",
          type: "ordinal",
          title: chart.xLabel ?? chart.xField ?? "X",
        },
        y: {
          field: chart.yField ?? "y",
          type: "ordinal",
          title: chart.yLabel ?? chart.yField ?? "Y",
        },
        color: {
          field: chart.colorField ?? "value",
          type: "quantitative",
          scale: { scheme: "blues" },
        },
        tooltip: [
          { field: chart.xField ?? "x" },
          { field: chart.yField ?? "y" },
          { field: chart.colorField ?? "value", type: "quantitative" },
        ],
      },
      config: vegaConfig,
    };
  }

  // Bar / Grouped Bar / Stacked Bar / Line / Area
  // Determine x encoding type — temporal if the data looks like dates
  const xField = chart.xField ?? "x";
  const sampleVal = chart.data[0]?.[xField];
  const isDate =
    typeof sampleVal === "string" &&
    /^\d{4}-\d{2}(-\d{2})?$/.test(sampleVal);
  const xType = isDate ? "temporal" : "ordinal";

  // Determine Vega-Lite mark type
  let mark: string | Record<string, unknown>;
  if (type === "bar" || type === "groupedbar" || type === "stackedbar") {
    mark = { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 };
  } else if (type === "line") {
    // Use area mark with line overlay for gradient fill effect on time-series
    mark = {
      type: "area",
      line: { strokeWidth: 3.5, color: brandColor },
      opacity: 0.12,
      point: { size: 70, filled: true, color: brandColor },
      color: brandColor,
    };
  } else if (type === "area") {
    mark = {
      type: "area",
      opacity: 0.6,
      line: { strokeWidth: 2.5 },
      point: { size: 50, filled: true },
    };
  } else {
    // Default to bar for unknown types
    mark = { type: "bar", cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 };
  }

  const spec: Record<string, unknown> = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: chart.title,
    width: w,
    height: h,
    data: { values: chart.data },
    mark,
    encoding: {
      x: {
        field: xField,
        type: xType,
        title: chart.xLabel ?? xField,
        axis: {
          labelAngle: xType === "temporal" ? -35 : -40,
        },
      },
      y: {
        field: chart.yField ?? "y",
        type: "quantitative",
        title: chart.yLabel ?? chart.yField ?? "Value",
        axis: { format: ",.0f" },
      },
      tooltip: [
        { field: xField, type: xType },
        { field: chart.yField ?? "y", type: "quantitative", format: ",.2f" },
      ],
    },
    config: vegaConfig,
  };

  // Add color encoding for multi-series / grouped / stacked
  if (chart.colorField) {
    (spec.encoding as any).color = {
      field: chart.colorField,
      type: "nominal",
      legend: { title: chart.colorField },
    };
    (spec.encoding as any).tooltip.push({
      field: chart.colorField,
      type: "nominal",
    });

    // Grouped bar — use xOffset encoding
    if (type === "groupedbar") {
      (spec.encoding as any).xOffset = {
        field: chart.colorField,
        type: "nominal",
      };
    }
  }

  // Single-color bar without grouping — use brand color
  if (!chart.colorField && (type === "bar" || type === "")) {
    (spec.encoding as any).color = { value: brandColor };
  }

  return spec;
}

// ────────────────────────────────────────────────────────────
// Rendering pipeline
// ────────────────────────────────────────────────────────────

/**
 * Render a single ChartSpec to PNG buffer + SVG string.
 *
 * Pipeline: ChartSpec → Vega-Lite compile → Vega parse → SVG → Sharp → PNG
 */
export async function renderChart(
  chart: ChartSpec,
  options: {
    brandColor?: string;
    /** Scale factor for higher DPI (default: 2 for retina) */
    scale?: number;
  } = {}
): Promise<RenderedChart> {
  const { brandColor = "#3b82f6", scale = 2 } = options;
  const w = chart.width ?? 700;
  const h = chart.height ?? 420;

  // Lazy-load heavy deps
  const vl = await getVl();
  const vega = await getVega();
  const sharp = await getSharp();

  // 1. Build Vega-Lite spec
  const vlSpec = buildVegaLiteSpec(chart, brandColor) as unknown as TopLevelSpec;

  // 2. Compile Vega-Lite → Vega
  const compiled = vl.compile(vlSpec);

  // 3. Parse Vega spec → create View
  const runtime = vega.parse(compiled.spec);
  const view = new vega.View(runtime, { renderer: "none" });

  // 4. Render to SVG
  const svg = await view.toSVG();

  // 5. Convert SVG → PNG via Sharp (2x scale for crisp output)
  const png = await sharp(Buffer.from(svg))
    .resize(w * scale, h * scale)
    .png({ quality: 90, compressionLevel: 6 })
    .toBuffer();

  // Cleanup
  view.finalize();

  return { png, svg, title: chart.title, width: w, height: h };
}

/**
 * Render multiple chart specs in parallel.
 * Returns all rendered charts, skipping any that fail (with warnings logged).
 */
export async function renderCharts(
  charts: ChartSpec[],
  options: {
    brandColor?: string;
    scale?: number;
    logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void };
  } = {}
): Promise<RenderedChart[]> {
  const results = await Promise.allSettled(
    charts.map((chart) => renderChart(chart, options))
  );

  const rendered: RenderedChart[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      rendered.push(result.value);
    } else {
      const errMsg = String(result.reason);
      options.logger?.warn("Chart rendering failed", {
        chartTitle: charts[i].title,
        chartType: charts[i].type,
        error: errMsg,
      });
      console.error(`[charts] renderChart failed for "${charts[i].title}" (${charts[i].type}):`, errMsg);
    }
  }
  return rendered;
}

// ────────────────────────────────────────────────────────────
// PPTX native chart data builder
// ────────────────────────────────────────────────────────────

/**
 * Convert a ChartSpec to PptxGenJS-compatible chart data.
 * PptxGenJS has native chart support — produces editable Office charts.
 *
 * Returns null for chart types that PptxGenJS doesn't support natively
 * (in which case, use the PNG image fallback).
 */
export function toPptxChartData(chart: ChartSpec): {
  type: string;
  data: Array<{ name: string; labels: string[]; values: number[] }>;
  options: Record<string, unknown>;
} | null {
  const type = chart.type.toLowerCase().replace(/[_\s-]+/g, "");

  // PptxGenJS chart type mapping
  const pptxTypeMap: Record<string, string> = {
    bar: "bar",
    groupedbar: "bar",
    stackedbar: "bar",
    line: "line",
    area: "area",
    pie: "pie",
    donut: "doughnut",
    scatter: "scatter",
  };

  const pptxType = pptxTypeMap[type];
  if (!pptxType) return null; // Unsupported — fall back to PNG

  const xField = chart.xField ?? "x";
  const yField = chart.yField ?? "y";

  // Single series (no color grouping)
  if (!chart.colorField) {
    const labels = chart.data.map((d) => String(d[xField] ?? ""));
    const values = chart.data.map((d) => Number(d[yField]) || 0);

    return {
      type: pptxType,
      data: [{ name: chart.yLabel ?? yField, labels, values }],
      options: {
        x: 0.5,
        y: 1.8,
        w: 9,
        h: 5,
        showTitle: true,
        title: chart.title,
        titleFontSize: 14,
        showValue: false,
        showLegend: chart.colorField ? true : false,
        legendPos: "b",
        catAxisLabelFontSize: 10,
        valAxisLabelFontSize: 10,
        dataLabelFontSize: 8,
        ...(type === "stackedbar" ? { barGrouping: "stacked" } : {}),
      },
    };
  }

  // Multi-series (grouped by colorField)
  const groups = new Map<string, { labels: string[]; values: number[] }>();
  const allLabels = [...new Set(chart.data.map((d) => String(d[xField] ?? "")))];

  for (const row of chart.data) {
    const groupName = String(row[chart.colorField] ?? "");
    if (!groups.has(groupName)) {
      groups.set(groupName, { labels: allLabels, values: new Array(allLabels.length).fill(0) });
    }
    const group = groups.get(groupName)!;
    const idx = allLabels.indexOf(String(row[xField] ?? ""));
    if (idx >= 0) {
      group.values[idx] = Number(row[yField]) || 0;
    }
  }

  const data = Array.from(groups.entries()).map(([name, { labels, values }]) => ({
    name,
    labels,
    values,
  }));

  return {
    type: pptxType,
    data,
    options: {
      x: 0.5,
      y: 1.8,
      w: 9,
      h: 5,
      showTitle: true,
      title: chart.title,
      titleFontSize: 14,
      showValue: false,
      showLegend: true,
      legendPos: "b",
      catAxisLabelFontSize: 10,
      valAxisLabelFontSize: 10,
      dataLabelFontSize: 8,
      ...(type === "stackedbar" ? { barGrouping: "stacked" } : {}),
    },
  };
}
