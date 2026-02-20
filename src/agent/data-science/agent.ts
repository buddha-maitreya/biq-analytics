/**
 * Data Science Assistant -- "The Brain" (Orchestrator)
 *
 * Central intelligence of the platform. Manages the user conversation,
 * routes to specialized agents, and handles direct data queries.
 *
 * AGENT SPECIALIZATIONS:
 *   - The Brain (this agent) -- Conversation, tool routing, ad-hoc analysis
 *   - The Analyst (insights-analyzer) -- Statistical computation in sandbox
 *   - The Writer (report-generator) -- Professional report narration
 *   - The Librarian (knowledge-base) -- Document retrieval via vector search
 *
 * Architecture:
 *   1. The handler is for non-streaming invocations (direct agent.run()).
 *      Streaming is handled at the route level in src/api/chat.ts (Phase 1.7).
 *   2. Conversation context uses rolling summary + recent messages
 *      (compressed by maybeCompressSummary every 20 messages).
 *   3. System prompt is data-driven via config labels -- zero hardcoding.
 *   4. Tool calling with maxSteps allows multi-tool invocations per turn.
 *   5. Each specialist agent is optimized for speed and unique capability.
 *
 * All runtime parameters (model, maxSteps, temperature, etc.) are read
 * from the agent_configs DB table -- tunable per-deployment via Admin Console.
 */

import { createAgent } from "@agentuity/runtime";
import { generateText } from "ai";
import { getModel } from "@lib/ai";
import { getAgentConfigWithDefaults } from "@services/agent-configs";
import { saveChatMessage, type ToolCallEntry } from "@services/chat";
import type { AISettings } from "@services/settings";
import { maskPII } from "@lib/pii";
import { validateTextOutput } from "@lib/output-validation";
import { createTokenTracker, DEFAULT_TOKEN_BUDGETS } from "@lib/tokens";
import { recordRoutingDecision } from "@services/routing-analytics";
import { SpanCollector, traced, extractToolInvocations } from "@lib/tracing";
import {
  DataScienceConfig,
  inputSchema,
  outputSchema,
  DEFAULT_RECENT_MESSAGE_COUNT,
  DEFAULT_COMPRESSION_THRESHOLD,
} from "./types";
import { getAllTools, buildCustomToolsPromptSection } from "./tools";
import { buildSystemPrompt } from "./prompts/system";

// ────────────────────────────────────────────────────────────
// Agent definition (for non-streaming / direct agent.run())
// ────────────────────────────────────────────────────────────

const agent = createAgent("data-science", {
  description:
    "Central orchestrator -- manages user conversations, routes to specialist agents, and handles direct database queries and sandbox computations.",

  schema: { input: inputSchema, output: outputSchema },

  setup: async (): Promise<DataScienceConfig> => {
    const agentConfig = await getAgentConfigWithDefaults("data-science");
    const cfg = (agentConfig.config ?? {}) as Record<string, unknown>;

    return {
      agentConfig,
      maxSteps: agentConfig.maxSteps ?? 8,
      recentMessageCount:
        (cfg.recentMessageCount as number) ?? DEFAULT_RECENT_MESSAGE_COUNT,
      compressionThreshold:
        (cfg.compressionThreshold as number) ?? DEFAULT_COMPRESSION_THRESHOLD,
      compressionModel: (cfg.compressionModel as string) ?? "gpt-4o-mini",
      sandboxTimeoutMs: (cfg.sandboxTimeoutMs as number) ?? 30_000,
      modelId: agentConfig.modelOverride ?? "gpt-4o",
      temperature: agentConfig.temperature
        ? parseFloat(agentConfig.temperature)
        : undefined,
      routingExamples: cfg.routingExamples as any[] | undefined,
    };
  },

  handler: async (ctx, input) => {
    // Phase 1.9: Use request-scoped state for timing metadata
    ctx.state.set("startedAt", Date.now());

    // Phase 3.3: Store session context in thread metadata (unencrypted)
    // for filtering and analytics — survives across requests within the thread TTL
    ctx.waitUntil(async () => {
      try {
        await ctx.thread.setMetadata({
          sessionId: input.sessionId,
          agentName: "data-science",
          lastActiveAt: new Date().toISOString(),
        });
      } catch {
        // Thread metadata is non-critical — may fail in non-trigger contexts
      }
    });

    // Phase 1.10: Telemetry collector
    const collector = new SpanCollector("data-science", input.sessionId);

    const {
      agentConfig,
      maxSteps,
      recentMessageCount,
      sandboxTimeoutMs,
      modelId,
      temperature,
      routingExamples,
    } = ctx.config;

    // Phase 7.5: Token budget tracker
    const tokenTracker = createTokenTracker();
    const tokenBudget =
      ((agentConfig.config as any)?.tokenBudget as number) ??
      DEFAULT_TOKEN_BUDGETS["data-science"];

    // Access app-level AI settings from ctx.app (loaded once in app.ts setup)
    const ai = (ctx.app as unknown as { aiSettings: AISettings }).aiSettings;

    // Build per-request tool set -- sandbox API injected via closure
    const sandboxCfg = (agentConfig.config ?? {}) as Record<string, unknown>;
    const allTools = await getAllTools(
      {
        sandboxApi: ctx.sandbox,
        sandboxTimeoutMs,
        snapshotId: sandboxCfg.sandboxSnapshotId as string | undefined,
        runtime: (sandboxCfg.sandboxRuntime as any) ?? undefined,
        dependencies: sandboxCfg.sandboxDeps as string[] | undefined,
        memory: sandboxCfg.sandboxMemory as string | undefined,
      },
      ctx.kv as any
    );
    const customToolsSection = await buildCustomToolsPromptSection();

    const messages: Array<{
      role: "user" | "assistant" | "system";
      content: string;
    }> = [];

    if (input.history?.length) {
      messages.push(...input.history.slice(-recentMessageCount));
    }
    messages.push({ role: "user" as const, content: input.message });

    const result = await traced(
      ctx.tracer,
      collector,
      "generateText",
      "llm",
      async () => generateText({
        model: await getModel(modelId),
        ...(temperature !== undefined ? { temperature } : {}),
        system: buildSystemPrompt(undefined, ai, customToolsSection, routingExamples),
        messages,
        tools: allTools,
        maxSteps,
      }),
      { model: modelId, maxSteps }
    );

    // Phase 7.5: Track token usage
    if (result.usage) {
      tokenTracker.add(result.usage.promptTokens, result.usage.completionTokens);
    }

    const collectedToolCalls: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
      output?: unknown;
      status: "pending" | "running" | "completed" | "error";
    }> = [];

    for (const step of result.steps) {
      if (step.toolCalls) {
        for (const tc of step.toolCalls) {
          const toolResult = step.toolResults?.find(
            (tr: any) => tr.toolCallId === tc.toolCallId
          );
          collectedToolCalls.push({
            id: tc.toolCallId,
            name: tc.toolName,
            input: tc.args as Record<string, unknown>,
            output: (toolResult as any)?.result,
            status: "completed" as const,
          });
        }
      }
    }

    // Phase 7.5: Validate output
    let responseText = result.text;
    const validation = validateTextOutput(responseText, { minLength: 1 });
    if (!validation.valid) {
      ctx.logger.warn("Output validation failed", {
        issues: validation.issues.map((i) => i.code),
      });
    }

    // Phase 7.5: PII masking
    const { masked, scan: piiScan } = maskPII(responseText);
    if (piiScan.hasPII) {
      ctx.logger.info("PII masked in response", {
        detections: piiScan.detections,
        totalMatches: piiScan.totalMatches,
      });
      responseText = masked;
    }

    // Phase 7.3: Record routing analytics (background)
    const toolNames = [...new Set(collectedToolCalls.map((tc) => tc.name))];
    if (toolNames.length > 0) {
      const startedAt = ctx.state.get("startedAt") as number | undefined;
      ctx.waitUntil(async () => {
        try {
          await recordRoutingDecision({
            sessionId: input.sessionId,
            userMessage: input.message,
            toolsSelected: toolNames,
            strategy: toolNames.length > 1 ? "parallel" : "direct",
            latencyMs: startedAt ? Date.now() - startedAt : undefined,
          });
        } catch (err) {
          ctx.logger.warn("Failed to record routing analytics", {
            error: String(err),
          });
        }
      });
    }

    // Phase 1.10 + 2.2: Record tool invocations + telemetry spans (background)
    {
      const toolInvocations = extractToolInvocations(
        result.steps as any,
        "data-science",
        input.sessionId
      );
      for (const inv of toolInvocations) {
        collector.addToolCall(inv);
      }
      ctx.waitUntil(async () => {
        try {
          await collector.flush();
        } catch (err) {
          ctx.logger.warn("Failed to flush telemetry", {
            error: String(err),
          });
        }
      });
    }

    // Persist assistant message (background)
    ctx.waitUntil(async () => {
      try {
        await saveChatMessage({
          sessionId: input.sessionId,
          role: "assistant",
          content: responseText,
          toolCalls: collectedToolCalls.length
            ? (collectedToolCalls as ToolCallEntry[])
            : undefined,
          metadata: {
            model: modelId,
            tokens: result.usage
              ? {
                  prompt: result.usage.promptTokens,
                  completion: result.usage.completionTokens,
                }
              : undefined,
            tokenBudget: {
              ...tokenTracker.totals(),
              budget: tokenBudget,
              withinBudget: tokenTracker.isWithinBudget(tokenBudget),
            },
            piiMasked: piiScan.hasPII ? piiScan.detections : undefined,
            validationIssues: validation.issues.length
              ? validation.issues.map((i) => i.code)
              : undefined,
          },
        });
      } catch (err) {
        ctx.logger.warn("Failed to persist assistant message", {
          error: String(err),
        });
      }
    });

    // Phase 1.9: Include request duration from ctx.state
    const startedAt = ctx.state.get("startedAt") as number | undefined;
    ctx.logger.info("Data Science response complete", {
      toolCallCount: collectedToolCalls.length,
      responseLength: responseText.length,
      model: modelId,
      durationMs: startedAt ? Date.now() - startedAt : undefined,
      tokenUsage: tokenTracker.totals(),
      withinBudget: tokenTracker.isWithinBudget(tokenBudget),
    });

    return {
      text: responseText,
      toolCalls: collectedToolCalls.length ? collectedToolCalls : undefined,
    };
  },
});

export default agent;

// ────────────────────────────────────────────────────────────
// streamChat -- REMOVED (Phase 1.7)
//
// The streaming logic has been moved to src/api/chat.ts.
// Agentuity SDK agents are strictly request/response —
// streaming is a route-level concern where we have access
// to c.var context (logger, tracer, kv, sandbox) instead
// of duplicating config loading as a standalone function.
//
// The agent handler (above) remains for non-streaming calls
// (e.g., dataScienceAgent.run() from the legacy endpoint).
// ────────────────────────────────────────────────────────────
