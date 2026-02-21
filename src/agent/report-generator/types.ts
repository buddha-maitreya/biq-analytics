/**
 * Report Generator Agent -- Types, schemas, and constants
 */

import { z } from "zod";
import type { AgentConfigRow } from "@services/agent-configs";

// ────────────────────────────────────────────────────────────
// Config type (returned from setup(), available as ctx.config)
// ────────────────────────────────────────────────────────────

export interface ReportConfig {
  agentConfig: AgentConfigRow;
  maxSqlSteps: number;
  defaultFormat: string;
  temperature: number | undefined;
}

// ────────────────────────────────────────────────────────────
// Export format — supported output formats
// ────────────────────────────────────────────────────────────

/** Supported report output formats. */
export const REPORT_FORMATS = ["markdown", "plain", "csv", "json", "html"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

// ────────────────────────────────────────────────────────────
// Schemas -- Zod with .describe() for LLM-facing clarity
// ────────────────────────────────────────────────────────────

export const inputSchema = z.object({
  reportType: z
    .string()
    .describe("Type of business report to generate (e.g. sales-summary, inventory-health, customer-activity, financial-overview, or custom types)")
    .refine((v) => v.length > 0, "Report type is required"),
  startDate: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), "Invalid date")
    .describe("Start of the reporting period (ISO 8601 date or datetime, e.g. 2024-01-01 or 2024-01-01T00:00:00Z). Defaults to 30 days ago."),
  endDate: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), "Invalid date")
    .describe("End of the reporting period (ISO 8601 date or datetime, e.g. 2024-01-31 or 2024-01-31T23:59:59Z). Defaults to now."),
  format: z
    .enum(REPORT_FORMATS)
    .default("markdown")
    .describe("Output format for the report content (markdown, plain, csv, json, html)"),
  computedData: z
    .string()
    .optional()
    .describe("Pre-computed data from the orchestrator -- when provided, skips SQL for fastest path"),
});

export const outputSchema = z.object({
  title: z.string().describe("Report title"),
  reportType: z.string().describe("Type of report generated"),
  period: z.object({
    start: z.string().describe("Period start (ISO 8601)"),
    end: z.string().describe("Period end (ISO 8601)"),
  }),
  content: z.string().describe("The full report content"),
  generatedAt: z.string().describe("Generation timestamp (ISO 8601)"),
  format: z.string().optional().describe("Output format used"),
  savedId: z.string().uuid().optional().describe("ID of the saved report in the database"),
  version: z.number().optional().describe("Version number of the saved report"),
});
