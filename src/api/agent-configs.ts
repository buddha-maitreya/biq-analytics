import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
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
router.put("/agent-configs/:name", async (c) => {
  const body = await c.req.json();
  const agentName = c.req.param("name");

  if (!body.displayName) {
    return c.json({ error: "displayName is required" }, 400);
  }

  // Validate known agent name
  if (!agentSvc.AGENT_NAMES.includes(agentName as agentSvc.AgentName)) {
    return c.json({ error: `Unknown agent: ${agentName}` }, 400);
  }

  // Validate temperature range if provided
  if (body.temperature !== undefined && body.temperature !== null) {
    const temp = parseFloat(body.temperature);
    if (isNaN(temp) || temp < 0 || temp > 2) {
      return c.json({ error: "temperature must be between 0.00 and 2.00" }, 400);
    }
  }

  // Validate maxSteps if provided
  if (body.maxSteps !== undefined && body.maxSteps !== null) {
    const steps = parseInt(body.maxSteps);
    if (isNaN(steps) || steps < 1 || steps > 20) {
      return c.json({ error: "maxSteps must be between 1 and 20" }, 400);
    }
  }

  // Validate timeoutMs if provided
  if (body.timeoutMs !== undefined && body.timeoutMs !== null) {
    const timeout = parseInt(body.timeoutMs);
    if (isNaN(timeout) || timeout < 1000 || timeout > 300000) {
      return c.json({ error: "timeoutMs must be between 1000 and 300000" }, 400);
    }
  }

  const updated = await agentSvc.upsertAgentConfig({
    agentName,
    displayName: body.displayName,
    description: body.description,
    isActive: body.isActive,
    modelOverride: body.modelOverride,
    temperature: body.temperature,
    maxSteps: body.maxSteps != null ? parseInt(body.maxSteps) : undefined,
    timeoutMs: body.timeoutMs != null ? parseInt(body.timeoutMs) : undefined,
    customInstructions: body.customInstructions,
    executionPriority: body.executionPriority != null ? parseInt(body.executionPriority) : undefined,
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
