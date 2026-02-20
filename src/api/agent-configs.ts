import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import { updateAgentConfigSchema } from "@lib/validation";
import * as agentSvc from "@services/agent-configs";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

/** GET /api/agent-configs — list all agent configs (with defaults for missing agents) */
router.get("/agent-configs", async (c) => {
  // Always return all known agents — seed missing ones with defaults
  await agentSvc.seedAgentDefaults();
  const configs = await agentSvc.listAgentConfigs();
  return c.json({ data: configs });
});

/** GET /api/agent-configs/:name — get a single agent config */
router.get("/agent-configs/:name", async (c) => {
  const config = await agentSvc.getAgentConfigWithDefaults(c.req.param("name"));
  return c.json({ data: config });
});

/** PUT /api/agent-configs/:name — upsert a single agent config */
router.put("/agent-configs/:name", validator({ input: updateAgentConfigSchema }), async (c) => {
  const body = c.req.valid("json");
  const agentName = c.req.param("name");

  // Validate known agent name
  if (!agentSvc.AGENT_NAMES.includes(agentName as agentSvc.AgentName)) {
    return c.json({ error: `Unknown agent: ${agentName}` }, 400);
  }

  // Reset to defaults if requested
  if ((body as any).resetToDefaults) {
    const reset = await agentSvc.resetAgentToDefaults(agentName);
    return c.json({ data: reset });
  }

  const updated = await agentSvc.upsertAgentConfig({
    agentName,
    displayName: body.displayName,
    description: body.description,
    isActive: body.isActive,
    modelOverride: body.modelOverride,
    temperature: body.temperature != null ? String(body.temperature) : undefined,
    maxSteps: body.maxSteps ?? undefined,
    timeoutMs: body.timeoutMs ?? undefined,
    customInstructions: body.customInstructions,
    executionPriority: body.executionPriority ?? undefined,
    config: body.config,
  });

  return c.json({ data: updated });
});

/** POST /api/agent-configs/seed — seed all defaults (idempotent) */
router.post("/agent-configs/seed", async (c) => {
  await agentSvc.seedAgentDefaults();
  const configs = await agentSvc.listAgentConfigs();
  return c.json({ data: configs });
});

export default router;
