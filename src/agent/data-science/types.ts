/**
 * Data Science Agent -- Types, schemas, and constants
 */

import { s } from "@agentuity/schema";
import type { AgentConfigRow } from "@services/agent-configs";
import type { RoutingExample } from "@lib/prompts";

// ────────────────────────────────────────────────────────────
// Config type (returned from setup(), available as ctx.config)
// ────────────────────────────────────────────────────────────

export interface DataScienceConfig {
  agentConfig: AgentConfigRow;
  maxSteps: number;
  recentMessageCount: number;
  compressionThreshold: number;
  compressionModel: string;
  sandboxTimeoutMs: number;
  modelId: string;
  temperature: number | undefined;
  routingExamples: RoutingExample[] | undefined;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

export const DEFAULT_RECENT_MESSAGE_COUNT = 12;
export const DEFAULT_COMPRESSION_THRESHOLD = 20;

// ────────────────────────────────────────────────────────────
// Schemas -- Zod with .describe() for LLM-facing clarity
// ────────────────────────────────────────────────────────────

export const inputSchema = s.object({
  message: s.string().describe("The user's message"),
  sessionId: s.string().describe("Chat session ID (UUID)"),
  history: s.optional(
    s.array(
      s.object({
        role: s.enum(["user", "assistant", "system"]),
        content: s.string(),
      })
    )
  ).describe("Recent conversation history for context"),
});

export const outputSchema = s.object({
  text: s.string().describe("The full assistant response text"),
  toolCalls: s.optional(
    s.array(
      s.object({
        id: s.string().describe("Tool call ID"),
        name: s.string().describe("Tool name"),
        input: s.record(s.string(), s.unknown()).describe("Tool input parameters"),
        output: s.optional(s.unknown()).describe("Tool output result"),
      })
    )
  ).describe("Tool calls made during the response"),
});
