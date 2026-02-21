import { createRouter, validator } from "@agentuity/runtime";
import { s } from "@agentuity/schema";
import reportGenerator from "@agent/report-generator";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware, getAppUser } from "@lib/auth";
import { dynamicRateLimit } from "@lib/rate-limit";
import { listReports, getReportById, deleteReport, getReportDownloadUrl } from "@services/reports";
import { exportReport, type ExportFormat, EXPORT_FORMATS } from "@lib/report-export";

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

/**
 * POST /reports/generate — Generate an AI-powered business report.
 *
 * Request body validated by generateReportSchema:
 *   { type: ReportType, periodDays?: number }
 * The handler maps this to the report-generator agent’s input schema.
 */
reports.post("/generate",
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
reports.get("/history", async (c) => {
  const type = c.req.query("type") || undefined;
  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 50;
  const items = await listReports({ reportType: type, limit });
  return c.json({ data: items });
});

/** GET /reports/:id — Get a single saved report by ID */
reports.get("/:id", async (c) => {
  const id = c.req.param("id");
  const report = await getReportById(id);
  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json({ data: report });
});

/** DELETE /reports/:id — Delete a saved report */
reports.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await deleteReport(id);
  if (!deleted) return c.json({ error: "Report not found" }, 404);
  return c.json({ data: { deleted: true } });
});

/** GET /reports/:id/download — Get a presigned S3 download URL */
reports.get("/:id/download", async (c) => {
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
// REPORT EXPORT (PDF / Excel / Word / PowerPoint)
// ════════════════════════════════════════════════════════════

export const exportSchema = s.object({
  content: s.string(),
  title: s.string(),
  format: s.enum(["pdf", "xlsx", "docx", "pptx"]),
  subtitle: s.optional(s.string()),
});

/** GET /reports/export/formats — List available export formats */
reports.get("/export/formats", (c) => {
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
reports.post("/export",
  dynamicRateLimit("rateLimitReport", { windowMs: 60_000, prefix: "report-export", message: "Export rate limit reached. Please wait." }),
  validator({ input: exportSchema }),
  async (c) => {
  const { content, title, format, subtitle } = c.req.valid("json");
  const user = getAppUser(c);

  const result = await exportReport({
    content,
    title,
    format: format as ExportFormat,
    subtitle,
    preparedBy: user?.name ?? undefined,
  });

  return c.json({ data: result });
});

/**
 * POST /reports/:id/export — Export an existing saved report to a binary format.
 *
 * Query param: ?format=pdf|xlsx|docx|pptx
 */
reports.post("/:id/export", async (c) => {
  const id = c.req.param("id");
  const format = (c.req.query("format") || "pdf") as ExportFormat;

  if (!["pdf", "xlsx", "docx", "pptx"].includes(format)) {
    return c.json({ error: "Invalid format. Use: pdf, xlsx, docx, pptx" }, 400);
  }

  const report = await getReportById(id);
  if (!report) return c.json({ error: "Report not found" }, 404);
  const user = getAppUser(c);

  const result = await exportReport({
    content: report.content,
    title: report.title,
    format,
    subtitle: report.reportType,
    preparedBy: user?.name ?? undefined,
  });

  return c.json({ data: result });
});

export default reports;
