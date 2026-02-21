/**
 * Reports Service — persistence, versioning, and retrieval for saved reports.
 *
 * Reports are stored durably in the `saved_reports` table with automatic
 * version tracking per reportType + period combination.
 *
 * Phase 6.4: S3 object storage for permanent report archival.
 * Reports can be uploaded to S3 with presigned download URLs
 * for sharing and long-term storage.
 */

import { db, savedReports } from "@db/index";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { s3 } from "bun";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface SaveReportInput {
  reportType: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  format: string;
  content: string;
  generatedBy?: string;
  isScheduled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SavedReport {
  id: string;
  reportType: string;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  format: string;
  content: string;
  version: number;
  generatedBy: string | null;
  isScheduled: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportListItem {
  id: string;
  reportType: string;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  format: string;
  version: number;
  isScheduled: boolean;
  createdAt: Date;
}

// ────────────────────────────────────────────────────────────
// Save (with auto-versioning)
// ────────────────────────────────────────────────────────────

/**
 * Save a report with automatic version tracking.
 * If a report with the same type + period already exists,
 * the version number is incremented.
 */
export async function saveReport(input: SaveReportInput): Promise<SavedReport> {
  // Find latest version for this type+period
  const existing = await db
    .select({ maxVersion: sql<number>`COALESCE(MAX(${savedReports.version}), 0)` })
    .from(savedReports)
    .where(
      and(
        eq(savedReports.reportType, input.reportType),
        eq(savedReports.periodStart, new Date(input.periodStart)),
        eq(savedReports.periodEnd, new Date(input.periodEnd))
      )
    );

  const nextVersion = (existing[0]?.maxVersion ?? 0) + 1;

  const [saved] = await db
    .insert(savedReports)
    .values({
      reportType: input.reportType,
      title: input.title,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      format: input.format,
      content: input.content,
      version: nextVersion,
      generatedBy: input.generatedBy ?? null,
      isScheduled: input.isScheduled ?? false,
      metadata: input.metadata ?? null,
    })
    .returning();

  // Phase 6.4: Also persist to S3 for permanent archival (fire-and-forget)
  uploadReportToS3(saved.id, input.content, input.format, {
    title: input.title,
    reportType: input.reportType,
  }).catch(() => {
    // S3 upload is best-effort — DB is the primary store
  });

  return saved as SavedReport;
}

// ────────────────────────────────────────────────────────────
// Retrieve
// ────────────────────────────────────────────────────────────

/** Get a single report by ID. */
export async function getReportById(id: string): Promise<SavedReport | null> {
  const [report] = await db
    .select()
    .from(savedReports)
    .where(eq(savedReports.id, id))
    .limit(1);

  return (report as SavedReport) ?? null;
}

/** List reports with optional filters, ordered by most recent first. */
export async function listReports(opts?: {
  reportType?: string;
  limit?: number;
  offset?: number;
}): Promise<ReportListItem[]> {
  const conditions = [];
  if (opts?.reportType) {
    conditions.push(eq(savedReports.reportType, opts.reportType));
  }

  const query = db
    .select({
      id: savedReports.id,
      reportType: savedReports.reportType,
      title: savedReports.title,
      periodStart: savedReports.periodStart,
      periodEnd: savedReports.periodEnd,
      format: savedReports.format,
      version: savedReports.version,
      isScheduled: savedReports.isScheduled,
      createdAt: savedReports.createdAt,
    })
    .from(savedReports)
    .orderBy(desc(savedReports.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  if (conditions.length) {
    return (await query.where(and(...conditions))) as ReportListItem[];
  }
  return (await query) as ReportListItem[];
}

/**
 * Get all versions of a specific report type + period.
 * Returns versions in descending order (newest first).
 */
export async function getReportVersions(
  reportType: string,
  periodStart: string,
  periodEnd: string
): Promise<ReportListItem[]> {
  return (await db
    .select({
      id: savedReports.id,
      reportType: savedReports.reportType,
      title: savedReports.title,
      periodStart: savedReports.periodStart,
      periodEnd: savedReports.periodEnd,
      format: savedReports.format,
      version: savedReports.version,
      isScheduled: savedReports.isScheduled,
      createdAt: savedReports.createdAt,
    })
    .from(savedReports)
    .where(
      and(
        eq(savedReports.reportType, reportType),
        eq(savedReports.periodStart, new Date(periodStart)),
        eq(savedReports.periodEnd, new Date(periodEnd))
      )
    )
    .orderBy(desc(savedReports.version))) as ReportListItem[];
}

/** Delete a report by ID (and its S3 copy). */
export async function deleteReport(id: string): Promise<boolean> {
  // Get format before deletion for S3 cleanup
  const [report] = await db
    .select({ format: savedReports.format })
    .from(savedReports)
    .where(eq(savedReports.id, id))
    .limit(1);

  const result = await db
    .delete(savedReports)
    .where(eq(savedReports.id, id))
    .returning({ id: savedReports.id });

  // Clean up S3 copy (fire-and-forget)
  if (result.length > 0 && report?.format) {
    deleteReportFromS3(id, report.format).catch(() => {});
  }

  return result.length > 0;
}

// ────────────────────────────────────────────────────────────
// S3 Object Storage — permanent report archival (Phase 6.4)
// ────────────────────────────────────────────────────────────

/** S3 prefix for all stored reports */
const S3_REPORTS_PREFIX = "reports";

/** Map report format to MIME type */
function formatToMime(format: string): string {
  switch (format) {
    case "csv": return "text/csv";
    case "json": return "application/json";
    case "html": return "text/html";
    case "plain": return "text/plain";
    default: return "text/markdown";
  }
}

/** Map report format to file extension */
function formatToExt(format: string): string {
  switch (format) {
    case "csv": return "csv";
    case "json": return "json";
    case "html": return "html";
    case "plain": return "txt";
    default: return "md";
  }
}

/** Build the S3 key for a report */
function reportS3Key(reportId: string, format: string): string {
  return `${S3_REPORTS_PREFIX}/${reportId}.${formatToExt(format)}`;
}

/**
 * Upload a report to S3 for permanent archival.
 *
 * @returns The S3 key and a presigned download URL (1h expiry).
 */
export async function uploadReportToS3(
  reportId: string,
  content: string,
  format: string,
  metadata?: { title?: string; reportType?: string }
): Promise<{ key: string; presignedUrl: string }> {
  const key = reportS3Key(reportId, format);
  const mime = formatToMime(format);

  await s3.file(key).write(content, { type: mime });

  const presignedUrl = s3.presign(key, {
    expiresIn: 3600, // 1 hour
  });

  return { key, presignedUrl };
}

/**
 * Get a presigned download URL for an archived report.
 *
 * @param reportId - Report ID
 * @param format - Report format (for key construction)
 * @param expiresIn - URL expiry in seconds (default: 3600 = 1h)
 * @returns Presigned URL or null if file doesn't exist
 */
export async function getReportDownloadUrl(
  reportId: string,
  format: string,
  expiresIn = 3600
): Promise<string | null> {
  const key = reportS3Key(reportId, format);
  const exists = await s3.file(key).exists();
  if (!exists) return null;

  return s3.presign(key, { expiresIn });
}

/**
 * Delete a report from S3.
 */
export async function deleteReportFromS3(
  reportId: string,
  format: string
): Promise<void> {
  const key = reportS3Key(reportId, format);
  try {
    await s3.file(key).delete();
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Check if a report exists in S3.
 */
export async function reportExistsInS3(
  reportId: string,
  format: string
): Promise<boolean> {
  const key = reportS3Key(reportId, format);
  return s3.file(key).exists();
}
