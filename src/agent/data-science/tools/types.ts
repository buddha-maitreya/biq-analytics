/**
 * Data Science Agent -- Tool result types
 *
 * Typed interfaces for every tool's return value. Provides type safety
 * for tool consumers and explicit schemas the LLM can rely on.
 */

import type { SandboxErrorType } from "@lib/sandbox";

// ────────────────────────────────────────────────────────────
// Common
// ────────────────────────────────────────────────────────────

/** Base shape for any tool that can fail. */
export interface ToolErrorResult {
  error: string;
  /** Structured error category for LLM self-correction. */
  errorType?: SandboxErrorType | "agent" | "validation" | "database";
  /** Human-readable hint on how to fix the issue. */
  errorHint?: string;
}

// ────────────────────────────────────────────────────────────
// query_database
// ────────────────────────────────────────────────────────────

export interface QueryDatabaseSuccess {
  explanation: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export interface QueryDatabaseError extends ToolErrorResult {
  rows: never[] | [];
  rowCount: 0;
}

export type QueryDatabaseResult = QueryDatabaseSuccess | QueryDatabaseError;

// ────────────────────────────────────────────────────────────
// get_business_snapshot
// ────────────────────────────────────────────────────────────

export interface BusinessSnapshotResult {
  totalProducts: number;
  totalOrders: number;
  totalCustomers: number;
  totalRevenue: number;
  currency: string;
  lowStockItems?: Array<{
    productName: string;
    sku: string;
    quantity: number;
    reorderPoint: number | null;
  }>;
  recentOrders?: Array<Record<string, unknown>>;
}

// ────────────────────────────────────────────────────────────
// run_analysis (sandbox)
// ────────────────────────────────────────────────────────────

export interface RunAnalysisSuccess {
  result: unknown;
  dataRowCount: number;
  explanation: string;
}

export interface RunAnalysisError extends ToolErrorResult {
  stderr?: string;
  dataRowCount?: number;
  explanation: string;
}

export type RunAnalysisResult = RunAnalysisSuccess | RunAnalysisError;

// ────────────────────────────────────────────────────────────
// analyze_trends (specialist delegation)
// ────────────────────────────────────────────────────────────

export interface AnalyzeTrendsSuccess {
  analysisType: string;
  summary: string;
  insights: Array<Record<string, unknown>>;
  generatedAt: string;
}

export interface AnalyzeTrendsError extends ToolErrorResult {}

export type AnalyzeTrendsResult = AnalyzeTrendsSuccess | AnalyzeTrendsError;

// ────────────────────────────────────────────────────────────
// generate_report (specialist delegation)
// ────────────────────────────────────────────────────────────

export interface GenerateReportSuccess {
  title: string;
  content: string;
  period: { start: string; end: string };
  generatedAt: string;
}

export interface GenerateReportError extends ToolErrorResult {}

export type GenerateReportResult = GenerateReportSuccess | GenerateReportError;

// ────────────────────────────────────────────────────────────
// search_knowledge (specialist delegation)
// ────────────────────────────────────────────────────────────

export interface SearchKnowledgeSuccess {
  answer: string;
  sources: Array<{
    title: string;
    category: string;
    filename: string;
    chunkIndex: number;
    similarity: number;
  }>;
  found: boolean;
}

export interface SearchKnowledgeError extends ToolErrorResult {}

export type SearchKnowledgeResult = SearchKnowledgeSuccess | SearchKnowledgeError;
