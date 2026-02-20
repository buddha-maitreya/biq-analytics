/**
 * Data Science Agent -- Specialist delegation tools
 *
 * analyzeTrendsTool: Delegates to The Analyst (insights-analyzer)
 * generateReportTool: Delegates to The Writer (report-generator)
 * searchKnowledgeTool: Delegates to The Librarian (knowledge-base)
 *
 * All tools return structured error objects with errorType + errorHint
 * so the LLM can report failures clearly to the user.
 */

import { tool } from "ai";
import { z } from "zod";
import insightsAnalyzer from "@agent/insights-analyzer";
import reportGenerator from "@agent/report-generator";
import knowledgeBase from "@agent/knowledge-base";
import type {
  AnalyzeTrendsResult,
  GenerateReportResult,
  SearchKnowledgeResult,
} from "./types";

/**
 * Classify an agent delegation error into a structured response.
 * Provides the LLM with enough detail to report the failure to the user.
 */
function agentError(
  agentName: string,
  err: unknown
): { error: string; errorType: "agent"; errorHint: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const isTimeout = /timeout|timed?\s*out|deadline/i.test(msg);
  const isAuth = /auth|permission|forbidden|unauthorized/i.test(msg);
  const hint = isTimeout
    ? `The ${agentName} agent timed out. Try a simpler request or narrower time range.`
    : isAuth
      ? `The ${agentName} agent encountered a permission error. This may require admin attention.`
      : `The ${agentName} agent encountered an error. Report this to the user and suggest trying again or rephrasing.`;

  return { error: `${agentName} failed: ${msg}`, errorType: "agent", errorHint: hint };
}

export const analyzeTrendsTool = tool({
  description:
    "Delegate to The Analyst (insights-analyzer) for statistical analysis that requires COMPUTATION: demand forecasting, anomaly detection (z-scores), restock recommendations (safety stock calculations), or sales trend analysis (moving averages, growth rates). Use when users ask about trends, forecasts, anomalies, patterns, or restocking. This agent dynamically generates and executes JavaScript code in a sandbox for computations beyond SQL.",
  parameters: z.object({
    analysis: z
      .string()
      .describe("Type of analysis to perform (demand-forecast, anomaly-detection, restock-recommendations, sales-trends, or custom types)"),
    timeframeDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Number of days to analyze"),
  }),
  execute: async ({ analysis, timeframeDays }): Promise<AnalyzeTrendsResult> => {
    try {
      const result = await insightsAnalyzer.run({
        analysis,
        timeframeDays,
        limit: 10,
      });
      return {
        analysisType: result.analysisType,
        summary: result.summary,
        insights: result.insights,
        generatedAt: result.generatedAt,
      };
    } catch (err) {
      return agentError("Insights Analyzer", err);
    }
  },
});

export const generateReportTool = tool({
  description:
    "Delegate to The Writer (report-generator) for professional, formatted business reports. Use when users ask for reports, summaries, or written overviews. The Writer fetches its own data and narrates it into a polished report with executive summary, key metrics, analysis, and recommendations. For quick data lookups, prefer query_database instead.",
  parameters: z.object({
    reportType: z
      .string()
      .describe("Type of report to generate (sales-summary, inventory-health, customer-activity, financial-overview, or custom types)"),
    startDate: z
      .string()
      .optional()
      .describe("Start date in ISO format. Defaults to 30 days ago."),
    endDate: z
      .string()
      .optional()
      .describe("End date in ISO format. Defaults to now."),
  }),
  execute: async ({ reportType, startDate, endDate }): Promise<GenerateReportResult> => {
    try {
      const result = await reportGenerator.run({
        reportType,
        startDate,
        endDate,
        format: "markdown",
      });
      return {
        title: result.title,
        content: result.content,
        period: result.period,
        generatedAt: result.generatedAt,
      };
    } catch (err) {
      return agentError("Report Generator", err);
    }
  },
});

export const searchKnowledgeTool = tool({
  description:
    "Search the uploaded business documents (knowledge base) for answers about policies, procedures, vendor agreements, or other company documentation.",
  parameters: z.object({
    question: z
      .string()
      .describe("The question to search the knowledge base for"),
  }),
  execute: async ({ question }): Promise<SearchKnowledgeResult> => {
    try {
      const result = await knowledgeBase.run({
        action: "query",
        question,
      });
      return {
        answer: result.answer ?? "",
        sources: result.sources ?? [],
        found: result.success,
      };
    } catch (err) {
      return agentError("Knowledge Base", err);
    }
  },
});
