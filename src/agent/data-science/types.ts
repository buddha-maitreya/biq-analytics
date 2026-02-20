/**
 * Data Science Agent -- Types, schemas, and constants
 */

import { z } from "zod";
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

export const inputSchema = z.object({
  message: z
    .string()
    .min(1)
    .describe("The user's message"),
  sessionId: z
    .string()
    .uuid()
    .describe("Chat session ID"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      })
    )
    .optional()
    .describe("Recent conversation history for context"),
});

export const outputSchema = z.object({
  text: z
    .string()
    .describe("The full assistant response text"),
  toolCalls: z
    .array(
      z.object({
        id: z.string().describe("Tool call ID"),
        name: z.string().describe("Tool name"),
        input: z.record(z.unknown()).describe("Tool input parameters"),
        output: z.unknown().optional().describe("Tool output result"),
      })
    )
    .optional()
    .describe("Tool calls made during the response"),
});
