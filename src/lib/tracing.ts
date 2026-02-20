/**
 * Tracing Utilities — Phase 1.10
 *
 * High-level utilities for instrumenting agent code with spans that
 * are both reported to OpenTelemetry (via ctx.tracer) AND persisted
 * to the agent_telemetry table for dashboard queries.
 *
 * Usage:
 *   const result = await traced(ctx, "generateText", "llm", async () => {
 *     return await generateText({ ... });
 *   }, { model: "gpt-4o", sessionId: input.sessionId });
 *
 * This creates an OTel span AND a DB record with timing, status, and attributes.
 */

import type { SpanType, RecordSpanInput } from "@services/telemetry";
import { recordSpanBatch } from "@services/telemetry";
import { recordToolInvocationBatch } from "@services/tool-analytics";
import type { RecordToolInput } from "@services/tool-analytics";

// ── Span Collector ─────────────────────────────────────────

/**
 * SpanCollector accumulates spans and tool invocations during a request,
 * then flushes them in a single batch write at the end. This avoids
 * per-span DB round-trips during hot paths.
 */
export class SpanCollector {
  private spans: RecordSpanInput[] = [];
  private toolCalls: RecordToolInput[] = [];
  public readonly agentName: string;
  public readonly sessionId?: string;

  constructor(agentName: string, sessionId?: string) {
    this.agentName = agentName;
    this.sessionId = sessionId;
  }

  /** Add a span to the batch */
  addSpan(span: Omit<RecordSpanInput, "agentName" | "sessionId"> & { sessionId?: string }): void {
    this.spans.push({
      ...span,
      agentName: this.agentName,
      sessionId: span.sessionId ?? this.sessionId,
    });
  }

  /** Add a tool invocation to the batch */
  addToolCall(tool: Omit<RecordToolInput, "agentName" | "sessionId"> & { sessionId?: string }): void {
    this.toolCalls.push({
      ...tool,
      agentName: this.agentName,
      sessionId: tool.sessionId ?? this.sessionId,
    });
  }

  /** Number of spans collected */
  get spanCount(): number {
    return this.spans.length;
  }

  /** Number of tool calls collected */
  get toolCallCount(): number {
    return this.toolCalls.length;
  }

  /**
   * Flush all collected spans and tool invocations to the database.
   * Returns the total number of records written.
   * Safe to call multiple times (empties the buffers).
   */
  async flush(): Promise<number> {
    const spanBatch = this.spans.splice(0);
    const toolBatch = this.toolCalls.splice(0);

    if (spanBatch.length === 0 && toolBatch.length === 0) return 0;

    const [spanCount, toolCount] = await Promise.all([
      spanBatch.length > 0 ? recordSpanBatch(spanBatch) : 0,
      toolBatch.length > 0 ? recordToolInvocationBatch(toolBatch) : 0,
    ]);

    return spanCount + toolCount;
  }
}

// ── Traced wrapper ─────────────────────────────────────────

/**
 * Execute an async function within a traced span.
 * Uses ctx.tracer for OTel reporting and records to the SpanCollector for DB persistence.
 *
 * @param tracer - The OpenTelemetry tracer (ctx.tracer or c.var.tracer)
 * @param collector - SpanCollector for batch DB recording
 * @param spanName - Human-readable span name
 * @param spanType - Category: "agent", "llm", "tool", "sandbox", "db_query"
 * @param fn - The async function to execute
 * @param attributes - Additional span attributes
 */
export async function traced<T>(
  tracer: { startActiveSpan: (name: string, fn: (span: any) => Promise<T>) => Promise<T> } | undefined,
  collector: SpanCollector,
  spanName: string,
  spanType: SpanType,
  fn: () => Promise<T>,
  attributes?: Record<string, unknown>
): Promise<T> {
  const startedAt = new Date();
  const startMs = Date.now();

  // If tracer is available, use OTel. Otherwise just run the function.
  if (tracer?.startActiveSpan) {
    return tracer.startActiveSpan(`${collector.agentName}.${spanName}`, async (span: any) => {
      try {
        if (attributes) {
          for (const [k, v] of Object.entries(attributes)) {
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
              span.setAttribute?.(k, v);
            }
          }
        }

        const result = await fn();
        const durationMs = Date.now() - startMs;

        collector.addSpan({
          spanType,
          spanName,
          status: "ok",
          durationMs,
          startedAt,
          attributes: { ...attributes, durationMs },
        });

        span.end?.();
        return result;
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const errorMessage = err instanceof Error ? err.message : String(err);

        span.recordException?.(err);
        span.setStatus?.({ code: 2, message: errorMessage }); // SpanStatusCode.ERROR = 2
        span.end?.();

        collector.addSpan({
          spanType,
          spanName,
          status: "error",
          durationMs,
          errorMessage,
          startedAt,
          attributes: { ...attributes, durationMs },
        });

        throw err;
      }
    });
  }

  // Fallback: no OTel tracer, just record to DB
  try {
    const result = await fn();
    const durationMs = Date.now() - startMs;

    collector.addSpan({
      spanType,
      spanName,
      status: "ok",
      durationMs,
      startedAt,
      attributes: { ...attributes, durationMs },
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMessage = err instanceof Error ? err.message : String(err);

    collector.addSpan({
      spanType,
      spanName,
      status: "error",
      durationMs,
      errorMessage,
      startedAt,
      attributes: { ...attributes, durationMs },
    });

    throw err;
  }
}

// ── Tool Call Extraction ───────────────────────────────────

/**
 * Extract tool invocation records from Vercel AI SDK step results.
 * Call this after generateText() completes to capture all tool calls
 * with timing and error information.
 */
export function extractToolInvocations(
  steps: Array<{
    toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown }>;
    toolResults?: Array<{ toolCallId: string; result: unknown }>;
  }>,
  agentName: string,
  sessionId?: string
): RecordToolInput[] {
  const invocations: RecordToolInput[] = [];

  for (const step of steps) {
    if (!step.toolCalls) continue;

    for (const tc of step.toolCalls) {
      const toolResult = step.toolResults?.find(
        (tr: any) => tr.toolCallId === tc.toolCallId
      );
      const result = (toolResult as any)?.result;
      const inputStr = JSON.stringify(tc.args ?? {});
      const outputStr = result ? JSON.stringify(result) : undefined;

      // Detect error results
      const isError =
        result?.error || result?.errorType || result?.rateLimited;
      const errorType = result?.errorType ?? (result?.rateLimited ? "rate_limit" : undefined);
      const errorMessage = result?.error ?? result?.errorMessage;

      invocations.push({
        toolName: tc.toolName,
        agentName,
        status: isError ? "error" : "success",
        sessionId,
        inputSizeChars: inputStr.length,
        outputSizeChars: outputStr?.length,
        errorType: isError ? (errorType ?? "generic") : undefined,
        errorMessage: isError ? String(errorMessage ?? "Unknown error") : undefined,
        attributes: {
          toolCallId: tc.toolCallId,
        },
      });
    }
  }

  return invocations;
}
