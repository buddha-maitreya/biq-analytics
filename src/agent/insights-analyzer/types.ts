/**
 * Insights Analyzer Agent -- Types, schemas, and constants
 */

import { z } from "zod";
import type { AgentConfigRow } from "@services/agent-configs";

// ────────────────────────────────────────────────────────────
// Config type (returned from setup(), available as ctx.config)
// ────────────────────────────────────────────────────────────

export interface InsightsConfig {
  agentConfig: AgentConfigRow;
  sandboxTimeoutMs: number;
  /** @deprecated No longer used -- single-pass architecture eliminates structuring step */
  structuringModel: string;
  maxSteps: number;
  temperature: number | undefined;
  /** Snapshot ID for pre-installed sandbox dependencies */
  sandboxSnapshotId?: string;
  /** Sandbox runtime (default: "bun:1") */
  sandboxRuntime?: string;
  /** Pre-install dependencies if no snapshot */
  sandboxDeps?: string[];
  /** Sandbox memory limit (default: "256MB") */
  sandboxMemory?: string;
}

// ────────────────────────────────────────────────────────────
// Schemas -- Zod with .describe() for LLM-facing clarity
// ────────────────────────────────────────────────────────────

export const inputSchema = z.object({
  analysis: z
    .string()
    .describe("Type of statistical analysis to perform (e.g. demand-forecast, anomaly-detection, restock-recommendations, sales-trends, or custom types)")
    .refine((v) => v.length > 0, "Analysis type is required"),
  timeframeDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30)
    .describe("Number of days of historical data to analyze"),
  productId: z
    .string()
    .uuid()
    .optional()
    .describe("Optional product ID to focus the analysis on"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum number of items to include in results"),
});

export const insightSchema = z.object({
  title: z.string().describe("Concise headline for the insight"),
  severity: z
    .enum(["info", "warning", "critical"])
    .describe("Business impact severity"),
  description: z
    .string()
    .describe("Plain-English explanation of the finding"),
  recommendation: z
    .string()
    .describe("Specific, actionable next step"),
  affectedItems: z
    .array(z.string())
    .optional()
    .describe("Product names/SKUs affected"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Computation-based confidence score derived from sample size, data completeness, and statistical significance"),
  dataPoints: z
    .record(z.unknown())
    .optional()
    .describe("Supporting numeric data"),
});

/** TypeScript type for a single insight item. */
export type InsightItem = z.infer<typeof insightSchema>;

export const outputSchema = z.object({
  analysisType: z.string().describe("The analysis type that was performed"),
  generatedAt: z.string().describe("ISO timestamp of generation"),
  insights: z.array(insightSchema).describe("Structured business insights"),
  summary: z.string().describe("Executive summary paragraph"),
});
