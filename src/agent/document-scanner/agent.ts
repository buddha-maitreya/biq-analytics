/**
 * Document Scanner Agent -- "The Scanner"
 *
 * Handles document and image processing for the platform:
 *   - Barcode/QR code scanning for product lookups
 *   - OCR processing for stock sheets (bulk inventory import)
 *   - OCR processing for invoices (supplier invoice data extraction)
 *
 * Architecture:
 *   1. Receives base64-encoded image data or document URL
 *   2. Uses multimodal LLM (GPT-4o or similar) for visual understanding
 *   3. Extracts structured data from the image
 *   4. Returns parsed data for integration with the business system
 *
 * Processing modes:
 *   - "barcode":     Extract barcode/QR code value → product lookup
 *   - "stock-sheet": Extract tabular inventory data → bulk stock update
 *   - "invoice":     Extract supplier invoice fields → invoice creation
 *
 * All runtime parameters are read from agent_configs DB table.
 */

import { createAgent } from "@agentuity/runtime";
import { generateText } from "ai";
import { s } from "@agentuity/schema";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { maskPII } from "@lib/pii";
import { validateTextOutput } from "@lib/output-validation";
import { createTokenTracker, DEFAULT_TOKEN_BUDGETS } from "@lib/tokens";
import { getAgentConfigWithDefaults } from "@services/agent-configs";

// ── Schema ──────────────────────────────────────────────────

const inputSchema = s.object({
  mode: s.enum(["barcode", "stock-sheet", "invoice"]),
  /** Base64-encoded image data (JPEG, PNG, or WebP) */
  imageData: s.optional(s.string()),
  /** URL to the image/document (alternative to imageData) */
  imageUrl: s.optional(s.string()),
  /** MIME type of the image (default: image/jpeg) */
  mimeType: s.optional(s.string()),
  /** Additional context or instructions for processing */
  context: s.optional(s.string()),
});

const outputSchema = s.object({
  success: s.boolean(),
  mode: s.enum(["barcode", "stock-sheet", "invoice"]),
  /** Extracted data (structure depends on mode) */
  data: s.optional(s.any()),
  /** Raw text extracted from the image */
  rawText: s.optional(s.string()),
  /** Error message if processing failed */
  error: s.optional(s.string()),
  /** Confidence score (0-1) */
  confidence: s.optional(s.number()),
});

// ── Config ──────────────────────────────────────────────────

interface DocumentScannerConfig {
  agentConfig: Awaited<ReturnType<typeof getAgentConfigWithDefaults>>;
  temperature: number | undefined;
}

// ── Processing prompts ──────────────────────────────────────

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

// ── Agent definition ────────────────────────────────────────

const agent = createAgent("document-scanner", {
  description:
    "Document processing specialist -- extracts barcode/QR codes, reads stock sheets, and parses invoices from images using multimodal AI.",

  schema: { input: inputSchema, output: outputSchema },

  setup: async (): Promise<DocumentScannerConfig> => {
    try {
      const agentConfig = await getAgentConfigWithDefaults("document-scanner");
      return {
        agentConfig,
        temperature: agentConfig.temperature
          ? parseFloat(agentConfig.temperature)
          : 0, // Low temperature for accurate extraction
      };
    } catch (err) {
      console.error("[document-scanner] setup() failed, using defaults:", err);
      return {
        agentConfig: {
          id: "fallback-setup",
          agentName: "document-scanner",
          displayName: "The Scanner",
          description: "Document processing specialist",
          isActive: true,
          modelOverride: null,
          temperature: null,
          maxSteps: 3,
          timeoutMs: 30000,
          customInstructions: null,
          executionPriority: 4,
          config: {},
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        temperature: 0,
      };
    }
  },

  shutdown: async (_app, _config) => {
    // Graceful shutdown — reserved for OCR service cleanup if needed.
  },

  handler: async (ctx, input) => {
    ctx.state.set("startedAt", Date.now());

    if (!ctx.config) {
      ctx.logger.warn("ctx.config undefined — app setup may have failed");
      return {
        success: false,
        mode: input.mode,
        error: "Document scanner unavailable — configuration not loaded. Please retry.",
      };
    }

    const { agentConfig, temperature } = ctx.config;

    // Validate input: need either imageData or imageUrl
    if (!input.imageData && !input.imageUrl) {
      return {
        success: false,
        mode: input.mode,
        error: "No image provided. Supply either imageData (base64) or imageUrl.",
      };
    }

    // Token tracking
    const tokenTracker = createTokenTracker();
    const tokenBudget =
      ((agentConfig.config as any)?.tokenBudget as number) ??
      DEFAULT_TOKEN_BUDGETS["knowledge-base"]; // Use KB budget as default

    // Select the appropriate prompt
    let systemPrompt: string;
    switch (input.mode) {
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

    if (input.context) {
      systemPrompt += `\n\nAdditional context: ${input.context}`;
    }

    // Build the message content with image
    const messageContent: Array<{ type: string; text?: string; image?: any }> = [];

    if (input.imageData) {
      messageContent.push({
        type: "image",
        image: input.imageData, // Vercel AI SDK accepts base64 directly
      } as any);
    } else if (input.imageUrl) {
      messageContent.push({
        type: "image",
        image: new URL(input.imageUrl),
      } as any);
    }

    messageContent.push({
      type: "text",
      text: `Process this ${input.mode === "barcode" ? "barcode/QR code image" : input.mode === "stock-sheet" ? "stock sheet / inventory document" : "invoice document"}. Return ONLY the structured JSON output as specified.`,
    });

    try {
      // Use multimodal model (GPT-4o supports vision)
      const modelId = agentConfig.modelOverride ?? "gpt-4o";
      const result = await generateText({
        model: await getModel(modelId),
        ...(temperature !== undefined ? { temperature } : {}),
        system: systemPrompt,
        messages: [
          {
            role: "user" as const,
            content: messageContent as any,
          },
        ],
      });

      // Track tokens
      if (result.usage) {
        tokenTracker.add(result.usage.promptTokens, result.usage.completionTokens);
      }

      // Parse the JSON response
      const validation = validateTextOutput(result.text, { minLength: 5 });
      let parsedData: any;

      if (validation.valid && validation.cleaned) {
        parsedData = JSON.parse(validation.cleaned);
      } else {
        // Try to extract JSON from the response
        const jsonMatch = result.text.match(
          /```json\s*([\s\S]*?)```|(\{[\s\S]*\})/
        );
        const jsonStr = jsonMatch?.[1]?.trim() || jsonMatch?.[2]?.trim();
        if (jsonStr) {
          parsedData = JSON.parse(jsonStr);
        } else {
          parsedData = null;
        }
      }

      // PII masking on raw text output
      const { masked: maskedText, scan: piiScan } = maskPII(result.text);
      if (piiScan.hasPII) {
        ctx.logger.info("PII masked in scanner output", {
          detections: piiScan.detections,
        });
      }

      // Also mask PII in parsed data fields (invoice supplier contact, etc.)
      if (parsedData && input.mode === "invoice") {
        if (parsedData.supplierContact) {
          parsedData.supplierContact = maskPII(parsedData.supplierContact).masked;
        }
        if (parsedData.bankDetails) {
          parsedData.bankDetails = maskPII(parsedData.bankDetails).masked;
        }
      }

      const startedAt = ctx.state.get("startedAt") as number | undefined;
      ctx.logger.info("Document scan complete", {
        mode: input.mode,
        success: !!parsedData,
        durationMs: startedAt ? Date.now() - startedAt : undefined,
        tokenUsage: tokenTracker.totals(),
      });

      return {
        success: !!parsedData,
        mode: input.mode,
        data: parsedData,
        rawText: maskedText,
        confidence: parsedData?.confidence ?? 0.5,
      };
    } catch (err: any) {
      const startedAt = ctx.state.get("startedAt") as number | undefined;
      ctx.logger.warn("Document scan failed", {
        mode: input.mode,
        error: err.message?.slice(0, 200),
        durationMs: startedAt ? Date.now() - startedAt : undefined,
      });

      return {
        success: false,
        mode: input.mode,
        error: `Processing failed: ${err.message?.slice(0, 200)}`,
      };
    }
  },
});

// ── Agent-level event listeners (per-agent telemetry) ──────
agent.addEventListener("started", (_event, _agentInfo, ctx) => {
  ctx.logger.info("[document-scanner] agent invocation started");
});

agent.addEventListener("completed", (_event, _agentInfo, ctx) => {
  ctx.logger.info("[document-scanner] agent invocation completed");
});

agent.addEventListener("errored", (_event, _agentInfo, ctx, error) => {
  ctx.logger.error("[document-scanner] agent invocation errored", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});

export default agent;
