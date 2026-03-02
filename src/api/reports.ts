import { createRouter, validator } from "@agentuity/runtime";
import { s } from "@agentuity/schema";
import reportGenerator from "@agent/report-generator";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware, getAppUser } from "@lib/auth";
import { dynamicRateLimit } from "@lib/rate-limit";
import { listReports, getReportById, deleteReport, getReportDownloadUrl } from "@services/reports";
import { exportReport, type ExportFormat, EXPORT_FORMATS, tempExportCache, extractChartBlocksFromContent } from "@lib/report-export";
import { renderChartsViaPython, isPythonChartsAvailable } from "@lib/python-charts";

// ── Request schema ────────────────────────────────────────
export const generateReportSchema = s.object({
  type: s.enum([
    "sales-summary",
    "inventory-health",
    "customer-activity",
    "financial-overview",
  ]),
  periodDays: s.optional(s.number()),
});

const reports = createRouter();
reports.use(errorMiddleware());
reports.use(sessionMiddleware());

// ════════════════════════════════════════════════════════════
// TEMP EXPORT DOWNLOAD (fallback when S3 is unavailable)
// ════════════════════════════════════════════════════════════

/**
 * GET /reports/download-temp/:id — Serve an export from the in-memory temp cache.
 * Used when S3 storage is unavailable. Entries expire after 1 hour.
 */
reports.get("/reports/download-temp/:id", (c) => {
  const id = c.req.param("id");
  const entry = tempExportCache.get(id);
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) tempExportCache.delete(id);
    return c.json({ error: "Download expired or not found. Please re-export the report." }, 404);
  }
  // Serve binary with proper headers
  c.header("Content-Type", entry.contentType);
  c.header("Content-Disposition", `attachment; filename="${entry.filename}"`);
  c.header("Content-Length", String(entry.buffer.length));
  c.header("Cache-Control", "private, max-age=3600");
  return c.body(new Uint8Array(entry.buffer) as any);
});

/**
 * POST /reports/generate — Generate an AI-powered business report.
 *
 * Request body validated by generateReportSchema:
 *   { type: ReportType, periodDays?: number }
 * The handler maps this to the report-generator agent’s input schema.
 */
reports.post("/reports/generate",
  dynamicRateLimit("rateLimitReport", { windowMs: 60_000, prefix: "report-gen", message: "Report generation rate limit reached. Please wait." }),
  validator({ input: generateReportSchema }),
  async (c) => {
  const { type, periodDays } = c.req.valid("json");

  // Calculate date range from periodDays (default 30)
  const days = periodDays ?? 30;
  const endDate = new Date().toISOString();
  const startDate = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    // Agent input uses `reportType` (not `type`) and date strings
    const result = await reportGenerator.run({
      reportType: type,
      startDate,
      endDate,
      format: "markdown" as const,
    });

    return c.json({
      data: {
        title: result.title,
        reportType: result.reportType,
        period: result.period,
        content: result.content,
        generatedAt: result.generatedAt,
      },
    });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    return c.json(
      { error: `Report generation failed: ${message}` },
      500
    );
  }
});

// ════════════════════════════════════════════════════════════
// REPORT HISTORY
// ════════════════════════════════════════════════════════════

/** GET /reports/history — List saved reports (newest first) */
reports.get("/reports/history", async (c) => {
  const type = c.req.query("type") || undefined;
  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 50;
  const items = await listReports({ reportType: type, limit });
  return c.json({ data: items });
});

/** GET /reports/:id — Get a single saved report by ID */
reports.get("/reports/:id", async (c) => {
  const id = c.req.param("id");
  const report = await getReportById(id);
  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json({ data: report });
});

/** DELETE /reports/:id — Delete a saved report */
reports.delete("/reports/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await deleteReport(id);
  if (!deleted) return c.json({ error: "Report not found" }, 404);
  return c.json({ data: { deleted: true } });
});

/** GET /reports/:id/download — Get a presigned S3 download URL */
reports.get("/reports/:id/download", async (c) => {
  const id = c.req.param("id");
  const report = await getReportById(id);
  if (!report) return c.json({ error: "Report not found" }, 404);

  const url = await getReportDownloadUrl(id, report.format);
  if (!url) {
    // Fallback: return content directly as download
    return c.json({ data: { content: report.content, format: report.format } });
  }
  return c.json({ data: { downloadUrl: url, format: report.format } });
});

// ════════════════════════════════════════════════════════════
// REPORT EXPORT (PDF / Excel / PowerPoint)
// ════════════════════════════════════════════════════════════

export const exportSchema = s.object({
  content: s.string(),
  title: s.string(),
  format: s.enum(["pdf", "xlsx", "pptx"]),
  subtitle: s.optional(s.string()),
});

/** GET /reports/export/formats — List available export formats */
reports.get("/reports/export/formats", (c) => {
  return c.json({ data: EXPORT_FORMATS });
});

/**
 * POST /reports/export — Convert report content to a downloadable binary file.
 *
 * Request body: { content: string, title: string, format: "pdf"|"xlsx"|"docx"|"pptx", subtitle?: string }
 * Returns: { downloadUrl, filename, format, sizeBytes, contentType }
 *
 * Branding (company name, logo, colors) is applied automatically from business_settings.
 */
reports.post("/reports/export",
  dynamicRateLimit("rateLimitReport", { windowMs: 60_000, prefix: "report-export", message: "Export rate limit reached. Please wait." }),
  validator({ input: exportSchema }),
  async (c) => {
  const { content, title, format, subtitle } = c.req.valid("json");
  const user = getAppUser(c);

  try {
    // ── Python-first chart rendering ──────────────────────
    let exportContent = content;
    let preRenderedImages: Array<{ title: string; data: string; width?: number; height?: number }> | undefined;

    if (isPythonChartsAvailable()) {
      try {
        const sandboxApi = c.var.sandbox;
        const { content: stripped, charts: chartSpecs } = extractChartBlocksFromContent(content);
        if (chartSpecs.length > 0 && sandboxApi) {
          const pythonCharts = await renderChartsViaPython(sandboxApi, chartSpecs);
          if (pythonCharts.length > 0) {
            preRenderedImages = pythonCharts;
            exportContent = stripped;
          }
        }
      } catch (err) {
        console.error("[reports/export] Python chart rendering failed, falling back to Vega-Lite:", err);
      }
    }

    const result = await exportReport({
      content: exportContent,
      title,
      format: format as ExportFormat,
      subtitle,
      preparedBy: user?.name ?? undefined,
      preRenderedImages,
    });

    return c.json({ data: result });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error("[reports/export] Export failed:", message, err);
    return c.json(
      { error: `Export failed: ${message}` },
      500
    );
  }
});

/**
 * POST /reports/:id/export — Export an existing saved report to a binary format.
 *
 * Query param: ?format=pdf|xlsx|pptx
 */
reports.post("/reports/:id/export", async (c) => {
  const id = c.req.param("id");
  const format = (c.req.query("format") || "pdf") as ExportFormat;

  if (!["pdf", "xlsx", "pptx"].includes(format)) {
    return c.json({ error: "Invalid format. Use: pdf, xlsx, pptx" }, 400);
  }

  const report = await getReportById(id);
  if (!report) return c.json({ error: "Report not found" }, 404);
  const user = getAppUser(c);

  // ── Python-first chart rendering for saved reports ──────
  let exportContent = report.content;
  let preRenderedImages: Array<{ title: string; data: string; width?: number; height?: number }> | undefined;

  if (isPythonChartsAvailable()) {
    try {
      const sandboxApi = c.var.sandbox;
      const { content: stripped, charts: chartSpecs } = extractChartBlocksFromContent(report.content);
      if (chartSpecs.length > 0 && sandboxApi) {
        const pythonCharts = await renderChartsViaPython(sandboxApi, chartSpecs);
        if (pythonCharts.length > 0) {
          preRenderedImages = pythonCharts;
          exportContent = stripped;
        }
      }
    } catch (err) {
      console.error("[reports/:id/export] Python chart rendering failed, falling back to Vega-Lite:", err);
    }
  }

  const result = await exportReport({
    content: exportContent,
    title: report.title,
    format,
    subtitle: report.reportType,
    preparedBy: user?.name ?? undefined,
    preRenderedImages,
  });

  return c.json({ data: result });
});

export default reports;
