/**
 * Prompt Template API Routes — Phase 7.1
 *
 * CRUD endpoints for versioned prompt templates.
 * Admin-only — requires auth middleware.
 *
 * Routes:
 *   GET    /api/admin/prompts              — List all templates
 *   GET    /api/admin/prompts/:agent        — Templates for a specific agent
 *   GET    /api/admin/prompts/:agent/:key   — Version history for agent+section
 *   POST   /api/admin/prompts              — Create new template version
 *   PUT    /api/admin/prompts/:id/activate  — Activate a specific version
 *   DELETE /api/admin/prompts/:id           — Delete a template version
 *   POST   /api/admin/prompts/test          — Test a prompt against sample input
 */

import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import {
  createPromptTemplateSchema,
  testPromptSchema,
} from "@lib/validation";
import * as promptSvc from "@services/prompt-templates";
import { generateText } from "ai";
import { getModel } from "@lib/ai";
import { injectLabels } from "@lib/prompts";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

/** GET /api/admin/prompts — list all prompt templates */
router.get("/admin/prompts", async (c) => {
  const agentName = c.req.query("agent");
  const data = await promptSvc.listPromptTemplates(agentName);
  return c.json({ data });
});

/** GET /api/admin/prompts/:agent/:key — version history */
router.get("/admin/prompts/:agent/:key", async (c) => {
  const { agent, key } = c.req.param();
  const data = await promptSvc.getTemplateVersions(agent, key);
  return c.json({ data });
});

/** GET /api/admin/prompts/:agent — templates for a specific agent */
router.get("/admin/prompts/:agent", async (c) => {
  const agent = c.req.param("agent");
  const data = await promptSvc.getAgentTemplates(agent);
  return c.json({ data });
});

/** POST /api/admin/prompts — create a new template version */
router.post(
  "/admin/prompts",
  validator({ input: createPromptTemplateSchema }),
  async (c) => {
    const body = c.req.valid("json");
    const userId = (c as any).get?.("userId") ?? null;
    const data = await promptSvc.createPromptTemplate({
      ...body,
      createdBy: userId,
    });
    return c.json({ data }, 201);
  }
);

/** PUT /api/admin/prompts/:id/activate — activate a specific version */
router.put("/admin/prompts/:id/activate", async (c) => {
  const id = c.req.param("id");
  const data = await promptSvc.activateTemplateVersion(id);
  if (!data) return c.json({ error: "Template not found" }, 404);
  return c.json({ data });
});

/** DELETE /api/admin/prompts/:id — delete a template version */
router.delete("/admin/prompts/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await promptSvc.deletePromptTemplate(id);
  if (!deleted) return c.json({ error: "Template not found" }, 404);
  return c.json({ success: true });
});

/** POST /api/admin/prompts/test — test a prompt against sample input */
router.post(
  "/admin/prompts/test",
  validator({ input: testPromptSchema }),
  async (c) => {
    const { agentName, message, promptOverrides } = c.req.valid("json");

    try {
      // Build system prompt from active templates + any overrides
      const templates = await promptSvc.getAgentTemplates(agentName);
      const merged = { ...templates, ...promptOverrides };

      // Assemble the system prompt from sections
      const systemPrompt = Object.entries(merged)
        .map(([key, val]) => injectLabels(val))
        .join("\n\n");

      const result = await generateText({
        model: await getModel(),
        system: systemPrompt,
        prompt: message,
        maxTokens: 500,
      });

      return c.json({
        success: true,
        response: result.text,
        usage: result.usage,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, error: msg }, 500);
    }
  }
);

export default router;
