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
} from "./types";

/**
 * Static tools map (sandbox-independent, safe to reuse across requests).
 */
export const sharedTools = {
  query_database: queryDatabaseTool,
  analyze_trends: analyzeTrendsTool,
  generate_report: generateReportTool,
  search_knowledge: searchKnowledgeTool,
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
  kv?: KVStore
): Promise<Record<string, any>> {
  const dynamic = await buildDynamicTools();
  return {
    ...sharedTools,
    // Use cached snapshot when KV is available
    ...(kv ? { get_business_snapshot: createCachedSnapshotTool(kv) } : {}),
    ...(sandboxOpts?.sandboxApi
      ? {
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
