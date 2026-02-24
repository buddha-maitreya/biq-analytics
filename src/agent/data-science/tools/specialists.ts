/**
 * Data Science Agent -- Specialist delegation tools
 *
 * analyzeTrendsTool: Delegates to The Analyst (insights-analyzer)
 * generateReportTool: Delegates to The Writer (report-generator)
 * searchKnowledgeTool: Delegates to The Librarian (knowledge-base)
 * scanDocumentTool: Runs GPT-4o vision INLINE (no inter-agent call)
 *   — Images are resized via Sharp before sending to reduce payload
 *   — Previously delegated to document-scanner agent, but serializing
 *     multi-MB base64 images through Agentuity's inter-agent messaging
 *     caused "session telemetry data not received within timeout" errors
 * exportReportTool: Exports reports to PDF/XLSX/DOCX/PPTX
 *
 * All tools return structured error objects with errorType + errorHint
 * so the LLM can report failures clearly to the user.
 */

import { createHash } from "crypto";
import { tool } from "ai";
import { generateText } from "ai";
import { z } from "zod";
import sharp from "sharp";
import insightsAnalyzer from "@agent/insights-analyzer";
import reportGenerator from "@agent/report-generator";
import knowledgeBase from "@agent/knowledge-base";
import { exportReport, type ExportFormat } from "@lib/report-export";
import { getModel } from "@lib/ai";
import { db, attachments as attachmentsTable } from "@db/index";
import { eq } from "drizzle-orm";
import { config } from "@lib/config";
import { maskPII } from "@lib/pii";
import { getAnalyticsSettings } from "@services/settings";
import { tempAttachmentCache } from "@api/attachments";
import {
  stageInvoiceIngestion,
  stageStockSheetIngestion,
  stageBarcodeIngestion,
} from "@services/document-ingestion";
import type {
  AnalyzeTrendsResult,
  GenerateReportResult,
  SearchKnowledgeResult,
  ScanDocumentResult,
  ExportReportResult,
} from "./types";

// ── Image resizing for document scanning ────────────────────
// Phone cameras produce 12MP+ images (3-10MB). GPT-4o vision works well
// at 1536px on the longest side. Resizing dramatically reduces the base64
// payload that was previously being serialized through inter-agent messaging,
// causing "session telemetry data not received within timeout" errors.
const MAX_IMAGE_DIMENSION = 1536;

/**
 * Resize an image buffer to fit within MAX_IMAGE_DIMENSION, preserving
 * aspect ratio. Returns a JPEG buffer (smaller than PNG for photos).
 * If the image is already small enough, returns it unchanged.
 */
async function resizeImageForVision(
  buffer: Uint8Array,
  _contentType?: string
): Promise<{ data: Buffer; contentType: string }> {
  try {
    const img = sharp(buffer);
    const metadata = await img.metadata();
    const w = metadata.width ?? 0;
    const h = metadata.height ?? 0;

    // Already small enough — just re-encode to JPEG for consistent handling
    if (w <= MAX_IMAGE_DIMENSION && h <= MAX_IMAGE_DIMENSION) {
      const out = await img.jpeg({ quality: 85 }).toBuffer();
      return { data: out, contentType: "image/jpeg" };
    }

    // Resize preserving aspect ratio
    const out = await img
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { data: out, contentType: "image/jpeg" };
  } catch {
    // Sharp failed (unsupported format?) — return original
    return { data: Buffer.from(buffer), contentType: _contentType ?? "image/jpeg" };
  }
}

// ── Document scanning prompts (inlined from document-scanner agent) ──
// These are identical to the prompts in src/agent/document-scanner/agent.ts.
// We inline them here to avoid the inter-agent call that caused timeouts.

function getBarcodePrompt(): string {
  return `You are a barcode and QR code reader. Analyze the provided image and extract any barcode or QR code values.

OUTPUT FORMAT (JSON only):
{
  "found": true/false,
  "type": "barcode" | "qr" | "unknown",
  "value": "the decoded value",
  "format": "EAN-13" | "UPC-A" | "Code-128" | "QR" | "DataMatrix" | "other",
  "confidence": 0.0-1.0
}

If multiple codes are found, return them as an array in "codes" field.
If no code is found, set "found": false and explain in "error".`;
}

function getStockSheetPrompt(): string {
  return `You are a stock sheet / inventory document reader for ${config.companyName}.
Analyze the provided image (photo of a stock sheet, spreadsheet, or inventory list) and extract the tabular data.

Terminology: "${config.labels.product}" for products.

OUTPUT FORMAT (JSON only):
{
  "items": [
    {
      "name": "Product name as written",
      "sku": "SKU/code if visible",
      "quantity": 123,
      "unit": "pieces/kg/liters/etc",
      "location": "warehouse/shelf location if visible",
      "notes": "any additional notes"
    }
  ],
  "documentDate": "date if visible (ISO format)",
  "totalItems": 5,
  "confidence": 0.0-1.0,
  "warnings": ["any issues with readability"]
}

Extract ALL visible line items. Use null for fields that aren't visible.
If the image is blurry or partially obscured, note it in warnings.`;
}

function getInvoicePrompt(): string {
  return `You are an invoice data extractor for ${config.companyName}.
Analyze the provided invoice image and extract all relevant fields.

Currency: ${config.currency}
Terminology: "${config.labels.product}" for products, "${config.labels.invoice}" for invoices.

OUTPUT FORMAT (JSON only):
{
  "invoiceNumber": "INV-12345",
  "supplierName": "Supplier Company Ltd",
  "supplierAddress": "123 Main St...",
  "supplierContact": "email or phone if visible",
  "invoiceDate": "2024-01-15",
  "dueDate": "2024-02-15",
  "currency": "${config.currency}",
  "subtotal": 1234.56,
  "taxAmount": 123.45,
  "totalAmount": 1358.01,
  "lineItems": [
    {
      "description": "Product/service description",
      "quantity": 10,
      "unitPrice": 123.45,
      "totalPrice": 1234.50,
      "sku": "SKU if visible"
    }
  ],
  "paymentTerms": "Net 30 if visible",
  "bankDetails": "bank info if visible",
  "confidence": 0.0-1.0,
  "warnings": ["any issues with readability"]
}

Extract ALL visible fields. Use null for fields not present.
Mask sensitive information like full bank account numbers.
Note any readability issues in warnings.`;
}

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
      .max(90)
      .default(30)
      .describe("Number of days of historical data to analyze. ALWAYS use 30 unless the user explicitly states a specific number of days or date range. NEVER choose a larger value based on the analysis type — forecasting, trends, and anomaly detection all work with 30 days by default. Valid range: 1-90."),
  }),
  execute: async ({ analysis, timeframeDays }): Promise<AnalyzeTrendsResult> => {
    try {
      // Read admin-configured analytics defaults (cached 1 min)
      const analyticsSettings = await getAnalyticsSettings();
      const clampedDays = Math.min(timeframeDays, analyticsSettings.maxTimeframeDays);
      const limit = analyticsSettings.defaultResultLimit;

      const result = await insightsAnalyzer.run({
        analysis,
        timeframeDays: clampedDays,
        limit,
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
      .describe("Start date in ISO format. ALWAYS default to 30 days ago unless the user explicitly specifies a date or period. NEVER invent a longer range based on the report type. When the user mentions a month without a year, use the current year."),
    endDate: z
      .string()
      .optional()
      .describe("End date in ISO format. ALWAYS default to today unless the user explicitly specifies an end date. When the user mentions a month without a year, use the current year."),
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
    "Search the uploaded business knowledge base (vector search + RAG). Use this tool when the user's question targets unstructured knowledge — information that lives in uploaded documents rather than in structured database tables. If unsure whether the answer is in the database or the knowledge base, ask the user for clarification.",
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

// NOTE: documentScanner agent import intentionally kept for direct-call
// fallback (e.g., batch processing routes that can tolerate higher latency).
// The scan_document tool no longer uses it — it calls GPT-4o inline.
import documentScanner from "@agent/document-scanner";

export const scanDocumentTool = tool({
  description:
    "Process uploaded images and documents inline using GPT-4o vision. " +
    "Use when the user has uploaded a file (image, PDF, etc.) and wants to: scan barcodes/QR codes, " +
    "extract inventory data from stock sheets (OCR), or parse invoice data from invoice/PDF documents. " +
    "Supports images (PNG, JPEG, GIF, WebP) AND PDF files. " +
    "Requires either an image URL (S3 presigned URL from the attachment) or base64-encoded image data.",
  parameters: z.object({
    mode: z
      .enum(["barcode", "stock-sheet", "invoice"])
      .describe("Processing mode: 'barcode' for barcode/QR scanning, 'stock-sheet' for inventory OCR, 'invoice' for invoice data extraction"),
    imageUrl: z
      .string()
      .optional()
      .describe("URL to the image (S3 presigned URL from attached files). Preferred over base64."),
    imageData: z
      .string()
      .optional()
      .describe("Base64-encoded image data (JPEG, PNG, WebP). Use imageUrl instead when available."),
    context: z
      .string()
      .optional()
      .describe("Additional context to help with recognition (e.g. 'this is a stock sheet from warehouse A')"),
  }),
  execute: async ({ mode, imageUrl, imageData, context }): Promise<ScanDocumentResult> => {
    const scanStart = Date.now();
    console.log(`[SCAN:1] scan_document tool called`, { mode, hasImageUrl: !!imageUrl, hasImageData: !!imageData, imageUrlPrefix: imageUrl?.slice(0, 80) });

    if (!imageUrl && !imageData) {
      return {
        success: false,
        mode,
        error: "No image provided. Supply either an imageUrl (from the attached file) or imageData (base64).",
        errorType: "validation",
        errorHint: "Ask the user to upload an image first, then reference the attachment URL provided in the conversation.",
      };
    }

    // Resolve internal/temp-cache URLs to base64 data.
    // When S3 is unavailable, attachments are stored in an in-memory cache
    // and the URL is like "/api/chat/attachments/{id}/download". These URLs
    // are NOT accessible to external services (OpenAI GPT-4o), so we must
    // read the file content and convert to base64 for the multimodal LLM.
    let resolvedImageUrl = imageUrl;
    let resolvedImageData = imageData;
    let resolvedMimeType: string | undefined; // Track MIME for file vs image content part

    // Traceability: extract attachment metadata for ingestion records
    let attachmentId: string | undefined;
    let attachmentSessionId: string | undefined;
    let attachmentFilename: string | undefined;
    let attachmentUserId: string | undefined;
    let documentHash: string | undefined; // SHA-256 of raw file content

    if (imageUrl && !imageData) {
      const internalMatch = imageUrl.match(/\/api\/chat\/attachments\/([^/]+)\/download/);
      if (internalMatch) {
        attachmentId = internalMatch[1];
        console.log(`[SCAN:2] Internal URL detected — resolving from temp cache`, { attachmentId, cacheSize: tempAttachmentCache.size });
        const cached = tempAttachmentCache.get(attachmentId);
        if (cached && cached.expiresAt > Date.now()) {
          console.log(`[SCAN:2] Temp cache HIT — ${cached.buffer.byteLength} bytes`, { contentType: cached.contentType });
          attachmentFilename = cached.filename;
          // Compute SHA-256 hash for document dedup
          documentHash = createHash("sha256").update(cached.buffer).digest("hex");
          // Look up DB record for session/user context
          try {
            const [attRow] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, attachmentId!)).limit(1);
            if (attRow) {
              attachmentSessionId = attRow.sessionId;
              attachmentUserId = attRow.userId;
              attachmentFilename = attRow.filename;
            }
          } catch { /* DB lookup non-fatal */ }
          resolvedMimeType = cached.contentType;
          const isPdf = cached.contentType === "application/pdf";
          if (isPdf) {
            // PDFs can't be resized via Sharp — send raw to GPT-4o as a file part
            const base64 = Buffer.from(cached.buffer).toString("base64");
            console.log(`[SCAN:2] PDF detected — skipping resize, base64 length: ${base64.length} chars`);
            resolvedImageData = `data:application/pdf;base64,${base64}`;
          } else {
            // Resize image before encoding to base64 — reduces payload dramatically
            const resized = await resizeImageForVision(cached.buffer, cached.contentType);
            const base64 = resized.data.toString("base64");
            console.log(`[SCAN:2] Image resized — base64 length: ${base64.length} chars`);
            resolvedImageData = `data:${resized.contentType};base64,${base64}`;
            resolvedMimeType = resized.contentType;
          }
          resolvedImageUrl = undefined;
        } else {
          // Temp cache MISS — try to fetch from S3 via DB record
          console.log(`[SCAN:2] Temp cache MISS — trying S3 fallback`, { attachmentId });
          try {
            const [row] = await db
              .select()
              .from(attachmentsTable)
              .where(eq(attachmentsTable.id, attachmentId))
              .limit(1);
            if (row && row.s3Key) {
              const { s3 } = await import("bun");
              const s3File = s3.file(row.s3Key);
              const exists = await s3File.exists();
              if (exists) {
                const fileData = await s3File.arrayBuffer();
                const buffer = new Uint8Array(fileData);
                console.log(`[SCAN:2] S3 fallback HIT — ${buffer.byteLength} bytes`, { contentType: row.contentType, s3Key: row.s3Key });
                // Capture attachment metadata for ingestion
                attachmentSessionId = row.sessionId;
                attachmentUserId = row.userId;
                attachmentFilename = row.filename;
                documentHash = createHash("sha256").update(buffer).digest("hex");
                // Re-populate temp cache for future requests
                tempAttachmentCache.set(attachmentId!, {
                  buffer,
                  contentType: row.contentType,
                  filename: row.filename,
                  expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2h
                });
                resolvedMimeType = row.contentType;
                const isPdfS3 = row.contentType === "application/pdf";
                if (isPdfS3) {
                  const base64 = Buffer.from(buffer).toString("base64");
                  resolvedImageData = `data:application/pdf;base64,${base64}`;
                } else {
                  const resized = await resizeImageForVision(buffer, row.contentType);
                  const base64 = resized.data.toString("base64");
                  resolvedImageData = `data:${resized.contentType};base64,${base64}`;
                  resolvedMimeType = resized.contentType;
                }
                resolvedImageUrl = undefined;
              } else {
                console.log(`[SCAN:2] S3 file does not exist`, { s3Key: row.s3Key });
                return {
                  success: false,
                  mode,
                  error: "The uploaded file could not be found in storage. Please re-upload.",
                  errorType: "validation",
                  errorHint: "Ask the user to re-upload the document.",
                };
              }
            } else {
              console.log(`[SCAN:2] DB record not found for attachment`, { attachmentId });
              return {
                success: false,
                mode,
                error: "The uploaded file record was not found. Please re-upload.",
                errorType: "validation",
                errorHint: "Ask the user to re-upload the document.",
              };
            }
          } catch (fallbackErr: any) {
            console.log(`[SCAN:2] S3 fallback FAILED`, { error: fallbackErr?.message?.slice(0, 300) });
            return {
              success: false,
              mode,
              error: "The uploaded file has expired and could not be recovered from storage. Please re-upload.",
              errorType: "validation",
              errorHint: "Ask the user to re-upload the document.",
            };
          }
        }
      }
    }

    // If we have raw base64 imageData (not from temp cache), try to resize it too
    // Skip resize for PDFs — they aren't images and Sharp can't process them
    const isResolvedPdf = resolvedMimeType === "application/pdf" || resolvedImageData?.startsWith("data:application/pdf");
    if (resolvedImageData && !resolvedImageUrl && !isResolvedPdf) {
      try {
        const base64Match = resolvedImageData.match(/^data:[^;]+;base64,(.+)$/);
        if (base64Match) {
          const rawBuffer = Buffer.from(base64Match[1], "base64");
          const resized = await resizeImageForVision(new Uint8Array(rawBuffer));
          const newBase64 = resized.data.toString("base64");
          resolvedImageData = `data:${resized.contentType};base64,${newBase64}`;
        }
      } catch {
        // Resize failed — use original data
      }
    }

    try {
      // ── Inline vision call (replaces documentScanner.run()) ──
      // Previously this delegated to the document-scanner agent via
      // inter-agent messaging, but serializing multi-MB base64 images
      // through that pipeline caused "session telemetry data not received
      // within timeout" errors. Running the vision call inline in the
      // tool avoids the inter-agent payload overhead entirely.

      // Select prompt based on mode
      let systemPrompt: string;
      switch (mode) {
        case "barcode":
          systemPrompt = getBarcodePrompt();
          break;
        case "stock-sheet":
          systemPrompt = getStockSheetPrompt();
          break;
        case "invoice":
          systemPrompt = getInvoicePrompt();
          break;
      }
      if (context) {
        systemPrompt += `\n\nAdditional context: ${context}`;
      }

      // Build multimodal message content
      // PDFs use 'file' content part; images use 'image' content part
      const messageContent: Array<any> = [];

      if (isResolvedPdf && resolvedImageData) {
        // GPT-4o supports PDFs via file content parts (not image parts)
        const pdfBase64Match = resolvedImageData.match(/^data:[^;]+;base64,(.+)$/);
        if (pdfBase64Match) {
          messageContent.push({ type: "file", data: pdfBase64Match[1], mimeType: "application/pdf" });
          console.log(`[SCAN:3] Using file content part for PDF`);
        }
      } else if (resolvedImageData) {
        messageContent.push({ type: "image", image: resolvedImageData });
      } else if (resolvedImageUrl) {
        messageContent.push({ type: "image", image: new URL(resolvedImageUrl) });
      }

      messageContent.push({
        type: "text",
        text: `Process this ${mode === "barcode" ? "barcode/QR code image" : mode === "stock-sheet" ? "stock sheet / inventory document" : "invoice document"}. Return ONLY the structured JSON output as specified.`,
      });

      console.log(`[SCAN:3] Calling generateText (GPT-4o vision inline)`, { mode, contentParts: messageContent.length, durationSoFarMs: Date.now() - scanStart });
      const visionResult = await generateText({
        model: await getModel("gpt-4o"),
        temperature: 0, // Low temperature for accurate extraction
        system: systemPrompt,
        messages: [{ role: "user" as const, content: messageContent }],
      });
      console.log(`[SCAN:4] generateText returned`, { responseLen: visionResult.text?.length, durationMs: Date.now() - scanStart });

      // Parse JSON response
      let parsedData: any = null;
      const responseText = visionResult.text;

      // Try direct JSON parse first, then extract from markdown code blocks
      try {
        parsedData = JSON.parse(responseText);
      } catch {
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```|(\{[\s\S]*\})/);
        const jsonStr = jsonMatch?.[1]?.trim() || jsonMatch?.[2]?.trim();
        if (jsonStr) {
          try {
            parsedData = JSON.parse(jsonStr);
          } catch {
            // Could not parse — will return as raw text
          }
        }
      }

      // PII masking on extracted data
      if (parsedData && mode === "invoice") {
        if (parsedData.supplierContact) {
          parsedData.supplierContact = maskPII(parsedData.supplierContact).masked;
        }
        if (parsedData.bankDetails) {
          parsedData.bankDetails = maskPII(parsedData.bankDetails).masked;
        }
      }

      const { masked: maskedText } = maskPII(responseText);

      if (!parsedData) {
        return {
          success: false,
          mode,
          error: "Could not parse structured data from the image. The response was not valid JSON.",
          errorType: "agent",
          errorHint: "The image may be unclear. Ask the user for a clearer photo.",
          rawText: maskedText,
        };
      }

      // ── Stage ingestion (dedup + DB records) ──
      // Pass full traceability context: attachment ID, session, user, filename, hash.
      // This ensures every uploaded document is properly recorded in document_ingestions.
      let ingestionResult;
      try {
        const stageInput = {
          scannerOutput: parsedData as Record<string, unknown>,
          confidence: parsedData?.confidence ?? null,
          rawText: maskedText ?? null,
          attachmentId: attachmentId ?? null,
          sessionId: attachmentSessionId ?? null,
          uploadedBy: attachmentUserId ?? null,
          sourceFilename: attachmentFilename ?? null,
          documentHash: documentHash ?? null,
        };
        switch (mode) {
          case "invoice":
            ingestionResult = await stageInvoiceIngestion(stageInput);
            break;
          case "stock-sheet":
            ingestionResult = await stageStockSheetIngestion(stageInput);
            break;
          case "barcode":
            ingestionResult = await stageBarcodeIngestion(stageInput);
            break;
        }
      } catch (ingErr: any) {
        // Ingestion staging failed — non-fatal, still return scan results.
        console.log(`[SCAN:5] Ingestion staging FAILED (non-fatal)`, { error: ingErr?.message?.slice(0, 300), stack: ingErr?.stack?.slice(0, 500) });
      }

      console.log(`[SCAN:6] Scan complete — returning success`, { mode, hasIngestion: !!ingestionResult, durationMs: Date.now() - scanStart });
      return {
        success: true,
        mode,
        data: parsedData,
        rawText: maskedText,
        confidence: parsedData?.confidence ?? 0.5,
        ingestion: ingestionResult
          ? {
              ingestionId: ingestionResult.ingestionId,
              status: ingestionResult.status,
              itemCount: ingestionResult.itemCount,
              items: ingestionResult.items,
              duplicateWarning: ingestionResult.duplicateWarning,
              requiresApproval: ingestionResult.requiresApproval,
            }
          : undefined,
      };
    } catch (err: any) {
      console.log(`[SCAN:ERR] scan_document tool threw`, { error: err?.message?.slice(0, 500), stack: err?.stack?.slice(0, 800), durationMs: Date.now() - scanStart });
      return { ...agentError("Document Scanner", err), success: false, mode };
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
