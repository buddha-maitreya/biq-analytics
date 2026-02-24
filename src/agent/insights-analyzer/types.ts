/**
 * Insights Analyzer Agent -- Types, schemas, and constants
 */

import { s } from "@agentuity/schema";
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
  /** Sandbox runtime (default: "python:3.14") */
  sandboxRuntime?: string;
  /** @deprecated Use snapshots instead. Pre-install dependencies if no snapshot. */
  sandboxDeps?: string[];
  /** Sandbox memory limit (default: "256Mi") */
  sandboxMemory?: string;
}

// ────────────────────────────────────────────────────────────
// Schemas -- Zod with .describe() for LLM-facing clarity
// ────────────────────────────────────────────────────────────

export const inputSchema = s.object({
  analysis: s
    .string()
    .describe("Type of statistical analysis to perform (e.g. demand-forecast, anomaly-detection, restock-recommendations, sales-trends, or custom types)"),
  timeframeDays: s
    .number()
    .describe("Number of days of historical data to analyze (1-365, default: 30)"),
  productId: s.optional(
    s.string().describe("Optional product ID (UUID) to focus the analysis on")
  ),
  limit: s
    .number()
    .describe("Maximum number of items to include in results (1-50, default: 10)"),
});

export const insightSchema = s.object({
  title: s.string().describe("Concise headline for the insight"),
  severity: s
    .enum(["info", "warning", "critical"])
    .describe("Business impact severity"),
  description: s
    .string()
    .describe("Plain-English explanation of the finding"),
  recommendation: s
    .string()
    .describe("Specific, actionable next step"),
  affectedItems: s.optional(
    s.array(s.string()).describe("Product names/SKUs affected")
  ),
  confidence: s
    .number()
    .describe("Computation-based confidence score derived from sample size, data completeness, and statistical significance (0-1)"),
  dataPoints: s.optional(
    s.record(s.string(), s.unknown()).describe("Supporting numeric data")
  ),
});

/** TypeScript type for a single insight item. */
export interface InsightItem {
  title: string;
  severity: "info" | "warning" | "critical";
  description: string;
  recommendation: string;
  affectedItems?: string[];
  confidence: number;
  dataPoints?: Record<string, unknown>;
}

/** Chart generated in the sandbox via save_chart() */
export interface InsightChart {
  /** Base64-encoded PNG image data */
  data: string;
  /** Chart title */
  title: string;
  /** Display width in pixels */
  width: number;
  /** Display height in pixels */
  height: number;
}

export const outputSchema = s.object({
  analysisType: s.string().describe("The analysis type that was performed"),
  generatedAt: s.string().describe("ISO timestamp of generation"),
  insights: s.array(insightSchema).describe("Structured business insights"),
  summary: s.string().describe("Executive summary paragraph"),
  charts: s.optional(
    s.array(
      s.object({
        data: s.string().describe("Base64-encoded PNG chart image"),
        title: s.string().describe("Chart title"),
        width: s.number().describe("Display width in pixels"),
        height: s.number().describe("Display height in pixels"),
      })
    ).describe("Publication-quality charts generated via matplotlib/seaborn")
  ),
});
