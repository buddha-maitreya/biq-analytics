/**
 * Data Science Agent -- Tools barrel
 *
 * Combines static tools, per-request sandbox tool, and dynamic custom tools.
 * All tools return typed result interfaces from `./types.ts`.
 */

import { queryDatabaseTool, getBusinessSnapshotTool, createCachedSnapshotTool } from "./query";
import {
  analyzeTrendsTool,
  generateReportTool,
  searchKnowledgeTool,
  ingestKnowledgeTool,
  scanDocumentTool,
  createExportReportTool,
  createPredictiveAnalyticsTool,
} from "./specialists";
import { createRunAnalysisTool } from "./sandbox";
import { buildDynamicTools } from "./custom";
import type { KVStore } from "@lib/cache";
import type { SandboxRuntime } from "@lib/sandbox";

// Re-export for agent.ts and other consumers
export { buildCustomToolsPromptSection } from "./custom";

// Re-export tool result types for consumers
export type {
  ToolErrorResult,
  QueryDatabaseResult,
  BusinessSnapshotResult,
  RunAnalysisResult,
  AnalyzeTrendsResult,
  GenerateReportResult,
  SearchKnowledgeResult,
  ScanDocumentResult,
  ExportReportResult,
  PredictiveAnalyticsResult,
} from "./types";

// Re-export ingestKnowledgeTool for direct use
export { ingestKnowledgeTool } from "./specialists";

/**
 * Static tools map (sandbox-independent, safe to reuse across requests).
 * NOTE: export_report is no longer here — it's created per-request in
 * getAllTools() to inject the sandbox API for Python chart rendering.
 */
export const sharedTools = {
  query_database: queryDatabaseTool,
  analyze_trends: analyzeTrendsTool,
  generate_report: generateReportTool,
  search_knowledge: searchKnowledgeTool,
  ingest_knowledge: ingestKnowledgeTool,
  scan_document: scanDocumentTool,
  get_business_snapshot: getBusinessSnapshotTool,
};

/**
 * Sandbox configuration options passed through to the sandbox tool.
 */
export interface SandboxToolOptions {
  sandboxApi?: any;
  sandboxTimeoutMs?: number;
  snapshotId?: string;
  runtime?: SandboxRuntime;
  dependencies?: string[];
  memory?: string;
}

/**
 * Build a complete tools map for a specific request.
 * The run_analysis tool is created per-request with the sandbox API
 * captured via closure -- no shared mutable state.
 *
 * When a KV store is provided, the business snapshot tool uses
 * KV caching for faster repeated aggregate queries (60s TTL).
 */
export async function getAllTools(
  sandboxOpts?: SandboxToolOptions,
  kv?: KVStore,
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }
): Promise<Record<string, any>> {
  const dynamic = await buildDynamicTools();
  return {
    ...sharedTools,
    // Use cached snapshot when KV is available
    ...(kv ? { get_business_snapshot: createCachedSnapshotTool(kv) } : {}),
    // Export report — always available, uses sandbox for Python chart rendering when possible
    export_report: createExportReportTool(sandboxOpts?.sandboxApi, logger),
    // Pre-built predictive analytics (ALWAYS available when sandbox is configured)
    ...(sandboxOpts?.sandboxApi
      ? {
          run_predictive_analytics: createPredictiveAnalyticsTool(
            sandboxOpts.sandboxApi,
            kv
          ),
          run_analysis: createRunAnalysisTool(
            sandboxOpts.sandboxApi,
            sandboxOpts.sandboxTimeoutMs,
            {
              snapshotId: sandboxOpts.snapshotId,
              runtime: sandboxOpts.runtime,
              dependencies: sandboxOpts.dependencies,
              memory: sandboxOpts.memory,
            }
          ),
        }
      : {}),
    ...dynamic,
  };
}
