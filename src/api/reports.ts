import { createRouter, validator } from "@agentuity/runtime";
import reportGenerator from "@agent/report-generator";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import { generateReportSchema } from "@lib/validation";
import { getReportTypes, getAnalysisTypes } from "@services/type-registry";
import {
  listReports,
  getReportById,
  getReportVersions,
  deleteReport,
  uploadReportToS3,
  getReportDownloadUrl,
  deleteReportFromS3,
  reportExistsInS3,
} from "@services/reports";

const reports = createRouter();
reports.use(errorMiddleware());
reports.use(authMiddleware());

/**
 * GET /reports/types — List available report and analysis types.
 * Used by the frontend to populate dropdowns dynamically.
 */
reports.get("/reports/types", async (c) => {
  const [reportTypes, analysisTypes] = await Promise.all([
    getReportTypes(),
    getAnalysisTypes(),
  ]);
  return c.json({
    data: { reportTypes, analysisTypes },
  });
});

/**
 * POST /reports/generate — Generate an AI-powered business report.
 *
 * The report-generator agent input schema:
 *   { reportType, startDate?, endDate?, format? }
 * Output schema:
 *   { title, reportType, period: { start, end }, content, generatedAt }
 */
reports.post("/reports/generate", validator({ input: generateReportSchema }), async (c) => {
  const { type, periodDays } = c.req.valid("json");

  // Calculate date range from periodDays (default 30)
  const days = periodDays ?? 30;
  const endDate = new Date().toISOString();
  const startDate = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();

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
      format: (result as any).format,
      savedId: (result as any).savedId,
      version: (result as any).version,
    },
  });
});

// ────────────────────────────────────────────────────────────
// Saved Reports — persistence & versioning endpoints
// ────────────────────────────────────────────────────────────

/**
 * GET /reports/saved — List saved reports with optional type filter.
 * Query params: reportType?, limit?, offset?
 */
reports.get("/reports/saved", async (c) => {
  const reportType = c.req.query("reportType") ?? undefined;
  const limit = Number(c.req.query("limit")) || 50;
  const offset = Number(c.req.query("offset")) || 0;

  const data = await listReports({ reportType, limit, offset });
  return c.json({ data });
});

/**
 * GET /reports/saved/:id — Get a full saved report by ID.
 */
reports.get("/reports/saved/:id", async (c) => {
  const id = c.req.param("id");
  const report = await getReportById(id);
  if (!report) {
    return c.json({ error: "Report not found" }, 404);
  }
  return c.json({ data: report });
});

/**
 * GET /reports/versions — Get all versions of a report type + period.
 * Query params: reportType (required), periodStart (required), periodEnd (required)
 */
reports.get("/reports/versions", async (c) => {
  const reportType = c.req.query("reportType");
  const periodStart = c.req.query("periodStart");
  const periodEnd = c.req.query("periodEnd");

  if (!reportType || !periodStart || !periodEnd) {
    return c.json(
      { error: "reportType, periodStart, and periodEnd are required" },
      400
    );
  }

  const data = await getReportVersions(reportType, periodStart, periodEnd);
  return c.json({ data });
});

/**
 * DELETE /reports/saved/:id — Delete a saved report.
 */
reports.delete("/reports/saved/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await deleteReport(id);
  if (!deleted) {
    return c.json({ error: "Report not found" }, 404);
  }
  return c.json({ data: { success: true } });
});

// ────────────────────────────────────────────────────────────
// Export — Durable stream downloads (Phase 6.3)
// ────────────────────────────────────────────────────────────

/** Map report format to MIME content type */
function formatToContentType(format: string): string {
  switch (format) {
    case "csv": return "text/csv";
    case "json": return "application/json";
    case "html": return "text/html";
    case "plain": return "text/plain";
    default: return "text/markdown";
  }
}

/** Map format to file extension */
function formatToExtension(format: string): string {
  switch (format) {
    case "csv": return "csv";
    case "json": return "json";
    case "html": return "html";
    case "plain": return "txt";
    default: return "md";
  }
}

/**
 * POST /reports/saved/:id/export — Export a saved report as a downloadable stream.
 * Returns a durable stream URL that can be shared or downloaded.
 * The stream persists for 7 days.
 */
reports.post("/reports/saved/:id/export", async (c) => {
  const id = c.req.param("id");
  const report = await getReportById(id);
  if (!report) {
    return c.json({ error: "Report not found" }, 404);
  }

  const stream = c.var.stream as any;
  if (!stream?.create) {
    return c.json({ error: "Durable streams not available" }, 501);
  }

  const format = report.format ?? "markdown";
  const contentType = formatToContentType(format);
  const ext = formatToExtension(format);
  const filename = `${report.reportType}-${report.periodStart?.toISOString().slice(0, 10) ?? "report"}.${ext}`;

  const durableStream = await stream.create("report-exports", {
    contentType,
    compress: true,
    metadata: {
      reportId: report.id,
      reportType: report.reportType,
      title: report.title,
      format,
      filename,
      version: report.version,
    },
    ttl: 86400 * 7, // 7 days
  });

  // Write content and close immediately (reports are already generated)
  await durableStream.write(report.content);
  await durableStream.close();

  return c.json({
    data: {
      streamId: durableStream.id,
      url: durableStream.url,
      filename,
      contentType,
      expiresIn: "7 days",
    },
  });
});

/**
 * GET /reports/exports — List all exported report streams.
 * Query params: limit?, offset?
 */
reports.get("/reports/exports", async (c) => {
  const stream = c.var.stream as any;
  if (!stream?.list) {
    return c.json({ error: "Durable streams not available" }, 501);
  }

  const limit = Number(c.req.query("limit")) || 50;
  const offset = Number(c.req.query("offset")) || 0;

  const result = await stream.list({
    namespace: "report-exports",
    limit,
    offset,
  });

  return c.json({ data: result });
});

// ────────────────────────────────────────────────────────────
// S3 Archival — permanent report storage (Phase 6.4)
// ────────────────────────────────────────────────────────────

/**
 * POST /reports/saved/:id/archive — Archive a saved report to S3.
 * Stores the report content permanently in S3 object storage.
 * Returns a presigned download URL (1h expiry).
 */
reports.post("/reports/saved/:id/archive", async (c) => {
  const id = c.req.param("id");
  const report = await getReportById(id);
  if (!report) {
    return c.json({ error: "Report not found" }, 404);
  }

  const { key, presignedUrl } = await uploadReportToS3(
    report.id,
    report.content,
    report.format ?? "markdown",
    { title: report.title, reportType: report.reportType }
  );

  return c.json({
    data: {
      reportId: report.id,
      s3Key: key,
      downloadUrl: presignedUrl,
      expiresIn: "1 hour",
    },
  });
});

/**
 * GET /reports/saved/:id/download — Get a presigned S3 download URL.
 * Query params: expiresIn? (seconds, default 3600)
 */
reports.get("/reports/saved/:id/download", async (c) => {
  const id = c.req.param("id");
  const report = await getReportById(id);
  if (!report) {
    return c.json({ error: "Report not found" }, 404);
  }

  const expiresIn = Number(c.req.query("expiresIn")) || 3600;
  const url = await getReportDownloadUrl(
    report.id,
    report.format ?? "markdown",
    expiresIn
  );

  if (!url) {
    return c.json(
      { error: "Report not archived. Use POST /reports/saved/:id/archive first." },
      404
    );
  }

  return c.json({
    data: {
      reportId: report.id,
      downloadUrl: url,
      expiresIn: `${expiresIn} seconds`,
    },
  });
});

/**
 * DELETE /reports/saved/:id/archive — Remove a report from S3.
 */
reports.delete("/reports/saved/:id/archive", async (c) => {
  const id = c.req.param("id");
  const report = await getReportById(id);
  if (!report) {
    return c.json({ error: "Report not found" }, 404);
  }

  await deleteReportFromS3(report.id, report.format ?? "markdown");
  return c.json({ data: { success: true } });
});

export default reports;
