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
import { exportReport, type ExportFormat } from "@lib/report-export";
import type {
  AnalyzeTrendsResult,
  GenerateReportResult,
  SearchKnowledgeResult,
  ExportReportResult,
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
    "Delegate to The Analyst (insights-analyzer) for statistical analysis that requires COMPUTATION: demand forecasting, anomaly detection (z-scores), restock recommendations (safety stock calculations), or sales trend analysis (moving averages, growth rates). Use when users ask about trends, forecasts, anomalies, patterns, or restocking. This agent dynamically generates and executes Python code (numpy/pandas/scipy/sklearn/statsmodels) in a sandbox for computations beyond SQL.",
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

export const exportReportTool = tool({
  description:
    "Export data or a report to a downloadable file. Supports PDF, Excel (XLSX), Word (DOCX), and PowerPoint (PPTX). " +
    "Use when the user asks to download, export, save as PDF/Excel/Word/PowerPoint, or compile conversation data into a document. " +
    "The exported file includes company branding (logo, name, colors), a Table of Contents, and 'Prepared by' attribution automatically. " +
    "IMPORTANT: Always structure the report content with: 1) Executive Summary (2-3 sentences highlighting key findings), " +
    "2) Relevant data sections with tables and analysis, " +
    "3) Conclusion with key observations and a recommended action plan. " +
    "For data-heavy exports, prefer Excel. For presentations, use PowerPoint. For printable reports, use PDF. For editable reports, use Word.",
  parameters: z.object({
    content: z
      .string()
      .describe(
        "The report content in markdown format. MUST include: ## Executive Summary, data sections with ## headings and markdown tables, " +
        "and ## Conclusion with key observations and recommended action plan. Use ## for major sections and ### for subsections."
      ),
    title: z
      .string()
      .describe("Report title — appears on the cover page and in the file metadata"),
    format: z
      .enum(["pdf", "xlsx", "docx", "pptx"])
      .describe("Output format: pdf, xlsx (Excel), docx (Word), or pptx (PowerPoint)"),
    subtitle: z
      .string()
      .optional()
      .describe("Optional subtitle or report type label (e.g. 'Monthly Sales Summary')"),
    preparedBy: z
      .string()
      .optional()
      .describe("Name of the person who prepared the report. Use the logged-in user's name if known from the conversation context."),
  }),
  execute: async ({ content, title, format, subtitle, preparedBy }): Promise<ExportReportResult> => {
    try {
      const result = await exportReport({
        content,
        title,
        format: format as ExportFormat,
        subtitle,
        preparedBy,
      });
      return {
        downloadUrl: result.downloadUrl,
        filename: result.filename,
        format: result.format,
        sizeBytes: result.sizeBytes,
        contentType: result.contentType,
      };
    } catch (err) {
      return agentError("Report Export", err);
    }
  },
});
