/**
 * Data Science Agent -- Dynamic custom tools
 *
 * Businesses define custom tools via the Settings UI:
 * - server: HTTP call to external URL (API endpoint)
 * - client: structured action sent to frontend via SSE
 *
 * jsonSchemaToZod: Convert a JSON parameter schema to Zod
 * buildDynamicTools: Load active tools from DB and create AI SDK tools
 * buildCustomToolsPromptSection: Build the system prompt section listing custom tools
 */

import { tool } from "ai";
import { z } from "zod";
import { listActiveTools, executeTool } from "@services/custom-tools";
import type { CustomToolRow } from "@services/custom-tools";

/**
 * Convert a JSON parameter schema to a Zod schema.
 * Supports basic types: string, number, boolean, with descriptions.
 */
export function jsonSchemaToZod(
  paramSchema: Record<string, unknown>
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, def] of Object.entries(paramSchema)) {
    const fieldDef = def as Record<string, unknown>;
    const fieldType = (fieldDef.type as string) || "string";
    const description = (fieldDef.description as string) || "";
    const required = fieldDef.required !== false;

    let zodType: z.ZodTypeAny;
    switch (fieldType) {
      case "number":
        zodType = z.number().describe(description);
        break;
      case "boolean":
        zodType = z.boolean().describe(description);
        break;
      default:
        zodType = z.string().describe(description);
    }

    shape[key] = required ? zodType : zodType.optional();
  }

  return z.object(shape).passthrough();
}

/**
 * Build dynamic Vercel AI SDK tools from active custom tool definitions.
 */
export async function buildDynamicTools(): Promise<Record<string, any>> {
  let activeTools: CustomToolRow[];
  try {
    activeTools = await listActiveTools();
  } catch {
    return {};
  }

  if (activeTools.length === 0) return {};

  const dynamicTools: Record<string, any> = {};

  for (const customTool of activeTools) {
    const parameterSchema = jsonSchemaToZod(
      (customTool.parameterSchema as Record<string, unknown>) || {}
    );

    dynamicTools[customTool.name] = tool({
      description: customTool.description,
      parameters: parameterSchema,
      execute: async (params: Record<string, unknown>) => {
        try {
          return await executeTool(customTool, params);
        } catch (err: any) {
          return {
            error: `Custom tool "${customTool.label}" failed: ${err.message || String(err)}`,
          };
        }
      },
    });
  }

  return dynamicTools;
}

/**
 * Build the custom tools section for the system prompt.
 * Informs the LLM about available custom tools so it knows when to use them.
 */
export async function buildCustomToolsPromptSection(): Promise<string> {
  let activeTools: CustomToolRow[];
  try {
    activeTools = await listActiveTools();
  } catch {
    return "";
  }
  if (activeTools.length === 0) return "";

  const typeLabel: Record<string, string> = {
    server: "external API",
    client: "UI action",
  };

  const toolDescriptions = activeTools
    .map(
      (t) =>
        `- **${t.name}** (${typeLabel[t.toolType] || t.toolType}): ${t.description}`
    )
    .join("\n");

  return `\n\nCustom business tools (defined by this business):
${toolDescriptions}
Use these tools when relevant to the user's question. They extend your capabilities beyond the built-in tools.`;
}
