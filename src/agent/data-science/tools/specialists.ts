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
import { exportReport, type ExportFormat, type PreRenderedImage } from "@lib/report-export";
import { renderChartsViaPython, isPythonChartsAvailable } from "@lib/python-charts";
import { extractChartBlocksFromContent } from "@lib/report-export";
import { getModel } from "@lib/ai";
import { db, attachments as attachmentsTable } from "@db/index";
import { eq } from "drizzle-orm";
import { config } from "@lib/config";
import { maskPII } from "@lib/pii";
import { getAnalyticsSettings } from "@services/settings";
import { runAnalytics, type AnalyticsAction } from "@lib/analytics";
import { getAnalyticsData, getDefaultRange, PREDICTIVE_ANALYTICS_TYPES } from "@lib/analytics-queries";
import type { KVStore } from "@lib/cache";
import { tempAttachmentCache } from "@api/attachments";
import {
  stageInvoiceIngestion,
  stageStockSheetIngestion,
  stageBarcodeIngestion,
  commitIngestion,
} from "@services/document-ingestion";
import type {
  AnalyzeTrendsResult,
  GenerateReportResult,
  SearchKnowledgeResult,
  ScanDocumentResult,
  ExportReportResult,
  PredictiveAnalyticsResult,
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
    "FALLBACK: Delegate to The Analyst (insights-analyzer) for CUSTOM statistical analysis that does NOT match any pre-built analytics type. ONLY use this tool when the user's request cannot be handled by run_predictive_analytics (e.g., truly novel analysis, custom formulas, or ad-hoc computations not covered by the standard forecasting/classification/anomaly/chart modules). If the user asks for forecasting, ABC-XYZ, RFM, CLV, bundles, anomaly detection, shrinkage, safety stock, or any chart — use run_predictive_analytics FIRST.",
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
        charts: result.charts,
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
        // ── Auto-commit invoice ingestions ──
        // Invoice scans uploaded via chat should create a real invoice record
        // immediately so they appear on the Invoices page. The uploading user
        // is recorded as the reviewer. Stock-sheet and barcode ingestions
        // may still require approval depending on workflow config.
        if (mode === "invoice" && ingestionResult?.ingestionId && ingestionResult.status === "staged") {
          try {
            const reviewerId = attachmentUserId ?? "system";
            const commitResult = await commitIngestion(ingestionResult.ingestionId, reviewerId, "Auto-committed from chat upload");
            console.log(`[SCAN:5b] Invoice auto-committed`, { ingestionId: ingestionResult.ingestionId, committed: commitResult.committed, skipped: commitResult.skipped, errors: commitResult.errors });
            ingestionResult.status = "committed";
          } catch (commitErr: any) {
            console.log(`[SCAN:5b] Invoice auto-commit FAILED (non-fatal)`, { error: commitErr?.message?.slice(0, 300) });
          }
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

/**
 * Factory: creates the export report tool with optional sandbox API
 * for Python-first chart rendering.
 *
 * When sandboxApi is provided, chart specs extracted from markdown content
 * are rendered via Python/matplotlib (enterprise-grade) instead of Vega-Lite.
 * Falls back to Vega-Lite if sandbox is unavailable or Python rendering fails.
 */
export function createExportReportTool(
  sandboxApi?: Pick<import("@agentuity/core").SandboxService, "run">,
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }
) {
  return tool({
  description:
    "Export a report to a downloadable file. Supports PDF, Excel (XLSX), Word (DOCX), and PowerPoint (PPTX). " +
    "Use when the user asks to download, export, or save a report. " +
    "The exported file includes company branding, Table of Contents, and 'Prepared by' attribution automatically. " +
    "PREFERRED: Provide reportType + startDate + endDate — the tool fetches and renders the report with full charts internally. " +
    "FALLBACK: Provide content directly for ad-hoc exports (no charts). " +
    "For data-heavy exports prefer Excel, presentations use PowerPoint, printable reports use PDF, editable use Word. " +
    "ANALYTICS CHARTS: If you have results from run_predictive_analytics, pass their charts via analyticsCharts.",
  parameters: z.object({
    title: z
      .string()
      .describe("Report title — appears on the cover page and in the file metadata"),
    format: z
      .enum(["pdf", "xlsx", "docx", "pptx"])
      .describe("Output format: pdf, xlsx (Excel), docx (Word), or pptx (PowerPoint)"),
    reportType: z
      .string()
      .optional()
      .describe(
        "Report type to generate and export (e.g. sales-summary, inventory-health, customer-activity, financial-overview). " +
        "When provided with startDate/endDate, the tool generates the report internally — charts are included automatically. " +
        "PREFERRED over passing content directly."
      ),
    startDate: z
      .string()
      .optional()
      .describe("Report period start date (ISO format, e.g. 2026-01-01). Used with reportType."),
    endDate: z
      .string()
      .optional()
      .describe("Report period end date (ISO format, e.g. 2026-01-31). Used with reportType."),
    content: z
      .string()
      .optional()
      .describe(
        "Report content in markdown format — use only for ad-hoc exports when reportType is not applicable. " +
        "When reportType is provided, this is ignored."
      ),
    subtitle: z
      .string()
      .optional()
      .describe("Optional subtitle or report type label (e.g. 'Monthly Sales Summary')"),
    preparedBy: z
      .string()
      .optional()
      .describe("Name of the person who prepared the report."),
    analyticsCharts: z
      .array(
        z.object({
          title: z.string().describe("Chart title"),
          data: z.string().describe("Base64-encoded PNG image data"),
          width: z.number().optional().describe("Image width in pixels (default: 800)"),
          height: z.number().optional().describe("Image height in pixels (default: 500)"),
        })
      )
      .optional()
      .describe(
        "Pre-rendered chart images from run_predictive_analytics. " +
        "Pass the charts array from PredictiveAnalyticsResult directly."
      ),
  }),
  execute: async ({ title, format, reportType, startDate, endDate, content, subtitle, preparedBy, analyticsCharts }): Promise<ExportReportResult> => {
    try {
      const preRenderedImages: PreRenderedImage[] = (analyticsCharts ?? []).map((c) => ({
        title: c.title,
        data: c.data,
        width: c.width,
        height: c.height,
      }));

      let reportContent: string = content ?? "";
      let allChartSpecs: import("@lib/charts").ChartSpec[] = [];

      // ── Preferred path: fetch report internally by type + dates ──
      // This bypasses the LLM entirely for chart data — no risk of the LLM
      // dropping or reconstructing chart specs without data arrays.
      if (reportType) {
        logger?.info("[export_report:1] Fetching report internally", { reportType, startDate, endDate, format });
        try {
          const result = await reportGenerator.run({
            reportType,
            startDate,
            endDate,
            format: "markdown",
            skipCache: true, // Always generate fresh for export — avoid hitting a chartless cached report
          });
          const { content: cleanContent, charts } = extractChartBlocksFromContent(result.content);
          reportContent = cleanContent;
          allChartSpecs = charts;
          logger?.info("[export_report:2] Report fetched", { contentLen: reportContent.length, chartSpecsCount: allChartSpecs.length });
        } catch (err) {
          logger?.error("[export_report] Report generation failed", { error: String(err) });
          return agentError("Report Generator", err);
        }
      } else {
        // Fallback: use provided content, extract any inline chart blocks
        const { content: cleanContent, charts: inlineSpecs } = extractChartBlocksFromContent(reportContent);
        reportContent = cleanContent;
        allChartSpecs = inlineSpecs;
        logger?.info("[export_report:1] Using provided content", { contentLen: reportContent.length, inlineCharts: inlineSpecs.length });
      }

      // ── Python-first chart rendering ──────────────────────
      if (allChartSpecs.length > 0 && sandboxApi && isPythonChartsAvailable()) {
        try {
          const pythonCharts = await renderChartsViaPython(sandboxApi, allChartSpecs);
          logger?.info("[export_report:3] Python rendering result", { requested: allChartSpecs.length, rendered: pythonCharts.length });
          if (pythonCharts.length > 0) {
            preRenderedImages.push(...pythonCharts);
            allChartSpecs = []; // Consumed by Python — don't also pass to Vega-Lite
          } else {
            logger?.warn("[export_report:3] Python returned 0 charts — falling back to Vega-Lite");
          }
        } catch (err) {
          logger?.error("[export_report] Python chart rendering failed, falling back to Vega-Lite", { error: String(err) });
        }
      }

      logger?.info("[export_report:4] Calling exportReport", {
        preRenderedImagesCount: preRenderedImages.length,
        vegaLiteFallbackCharts: allChartSpecs.length,
      });

      const result = await exportReport({
        content: reportContent,
        title,
        format: format as ExportFormat,
        subtitle,
        preparedBy,
        ...(preRenderedImages.length > 0 ? { preRenderedImages } : {}),
        ...(allChartSpecs.length > 0 ? { charts: allChartSpecs } : {}),
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
}

// ────────────────────────────────────────────────────────────
// run_predictive_analytics — Pre-built Python analytics modules
// ────────────────────────────────────────────────────────────
// ALWAYS PREFERRED over analyze_trends for known analytics types.
// Pre-built modules are optimized, tested, and produce consistent
// output (summary JSON + base64 charts). The LLM should route here
// for ALL standard analytics requests.

/** Valid action values for the tool schema */
const VALID_ACTIONS = PREDICTIVE_ANALYTICS_TYPES.map((t) => t.action);

/**
 * Build a human-readable action list for the tool description so the
 * LLM knows exactly which analytics types are available.
 */
function buildActionList(): string {
  const grouped: Record<string, string[]> = {};
  for (const t of PREDICTIVE_ANALYTICS_TYPES) {
    (grouped[t.category] ??= []).push(`${t.action} — ${t.label}: ${t.description}`);
  }
  return Object.entries(grouped)
    .map(([cat, items]) => `${cat.toUpperCase()}:\n${items.map((i) => `  • ${i}`).join("\n")}`)
    .join("\n");
}

/**
 * Factory: creates the predictive analytics tool with sandbox API
 * captured via closure (same pattern as createRunAnalysisTool).
 *
 * The sandbox API is per-request in the streaming chat handler;
 * this ensures concurrent requests never share sandbox references.
 */
export function createPredictiveAnalyticsTool(
  sandboxApi: { run: (opts: Record<string, unknown>) => Promise<any> },
  kv?: KVStore
) {
  return tool({
    description: `Run a PRE-BUILT Python analytics module. This is the PREFERRED tool for ALL standard analytics requests — forecasting, classification, anomaly detection, and charts. ALWAYS use this tool BEFORE analyze_trends for any of the supported action types below.

SUPPORTED ANALYTICS (use the exact action string):
${buildActionList()}

HOW IT WORKS:
1. You pick the action that best matches the user's request
2. The tool fetches the right data from the database automatically
3. A tested, optimized Python module runs in a sandbox
4. Returns structured JSON (summary metrics + charts + optional data table)

WHEN TO USE:
- User asks for a forecast → forecast.prophet / forecast.arima / forecast.holt_winters
- User asks about inventory classification → classify.abc_xyz
- User asks about customer segments → classify.rfm
- User asks about customer value → classify.clv
- User asks about product bundles → classify.bundles
- User asks about safety stock or reorder → forecast.safety_stock
- User asks about anomalies → anomaly.transactions
- User asks about shrinkage → anomaly.shrinkage
- User asks for any chart/visualization → chart.* (pick the best match)
- ONLY fall back to analyze_trends if NONE of these match`,
    parameters: z.object({
      action: z
        .string()
        .describe(
          `The analytics action to run. Must be one of: ${VALID_ACTIONS.join(", ")}`
        ),
      periodDays: z
        .number()
        .int()
        .min(7)
        .max(365)
        .optional()
        .describe(
          "Number of days of historical data to analyze. Defaults to 90 for forecasting/charts, 30 for classification/anomaly. Only override if the user specifies a specific date range."
        ),
      params: z
        .record(z.unknown())
        .optional()
        .describe(
          "Optional parameter overrides for the analytics module (e.g., { forecast_days: 60, confidence_level: 0.99 }). Only pass when the user explicitly requests non-default settings."
        ),
    }),
    execute: async ({ action, periodDays, params }): Promise<PredictiveAnalyticsResult> => {
      // ── Validate action ─────────────────────────────────────
      if (!VALID_ACTIONS.includes(action as AnalyticsAction)) {
        return {
          error: `Unknown analytics action "${action}". Valid actions: ${VALID_ACTIONS.join(", ")}`,
          errorType: "validation",
          errorHint: `Pick one of the supported actions. If the user's request doesn't match any, use analyze_trends instead.`,
        };
      }

      const analyticsAction = action as AnalyticsAction;

      // ── Determine date range ────────────────────────────────
      let dateRange = getDefaultRange(analyticsAction);
      if (periodDays) {
        const end = new Date();
        const start = new Date(end.getTime() - periodDays * 86_400_000);
        dateRange = {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
        };
      }

      // ── Step 1: Fetch data from database ────────────────────
      let analyticsData;
      try {
        analyticsData = await getAnalyticsData(analyticsAction, dateRange);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          error: `Failed to fetch data for ${analyticsAction}: ${msg}`,
          errorType: "database",
          errorHint: "The database query failed. Check if the required tables exist and have data in the specified date range.",
        };
      }

      if (analyticsData.rowCount === 0) {
        return {
          error: `No data found for ${analyticsAction} in the date range ${dateRange.start} to ${dateRange.end}.`,
          errorType: "no_data",
          errorHint: "Try a wider date range, or check if there is sales/inventory data in the system.",
        };
      }

      // ── Step 2: Run pre-built Python module ─────────────────
      try {
        const result = await runAnalytics(
          sandboxApi,
          {
            action: analyticsAction,
            data: analyticsData.data,
            params,
          },
          kv
        );

        if (!result.success) {
          return {
            error: result.error || "Analytics module returned an error",
            errorType: "analytics",
            errorHint: result.traceback
              ? `Python traceback: ${result.traceback.slice(0, 500)}`
              : "The Python analytics module failed. Try a different date range or check the data quality.",
          };
        }

        // ── Step 3: Return structured result ────────────────────
        return {
          action: analyticsAction,
          summary: (result.summary ?? {}) as Record<string, unknown>,
          charts: result.charts?.map((c) => ({
            title: c.title,
            format: (c.format ?? "png") as "png" | "svg",
            data: c.data,
            width: c.width ?? 800,
            height: c.height ?? 600,
          })),
          table: result.table
            ? {
                columns: result.table.columns ?? [],
                rows: result.table.rows ?? [],
              }
            : undefined,
          dateRange: {
            start: dateRange.start,
            end: dateRange.end,
          },
          dataRowCount: analyticsData.rowCount,
          durationMs: result.meta?.durationMs,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          error: `Analytics execution failed: ${msg}`,
          errorType: "sandbox",
          errorHint: "The Python sandbox encountered an error. This may be a transient issue — try again.",
        };
      }
    },
  });
}
