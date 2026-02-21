import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import * as toolsSvc from "@services/custom-tools";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

/** GET /api/custom-tools — list all custom tools */
router.get("/custom-tools", async (c) => {
  const tools = await toolsSvc.listTools();
  return c.json({ data: tools });
});

/** GET /api/custom-tools/:id — get a single tool */
router.get("/custom-tools/:id", async (c) => {
  const tool = await toolsSvc.getToolById(c.req.param("id"));
  if (!tool) return c.json({ error: "Tool not found" }, 404);
  return c.json({ data: tool });
});

/** POST /api/custom-tools — create a new tool */
router.post("/custom-tools", async (c) => {
  const body = await c.req.json();

  // Validate common required fields
  if (!body.name || !body.label || !body.description) {
    return c.json(
      { error: "name, label, and description are required" },
      400
    );
  }

  // Validate snake_case name
  if (!/^[a-z][a-z0-9_]{0,98}[a-z0-9]$/.test(body.name)) {
    return c.json(
      { error: "name must be snake_case (lowercase, underscores, no spaces)" },
      400
    );
  }

  // Type-specific validation
  const toolType = body.toolType ?? "server";
  if (toolType === "server" && !body.webhookUrl) {
    return c.json({ error: "webhookUrl is required for server tools" }, 400);
  }

  const tool = await toolsSvc.createTool(body);
  return c.json({ data: tool }, 201);
});

/** PUT /api/custom-tools/:id — update a tool */
router.put("/custom-tools/:id", async (c) => {
  const body = await c.req.json();
  const tool = await toolsSvc.updateTool(c.req.param("id"), body);
  if (!tool) return c.json({ error: "Tool not found" }, 404);
  return c.json({ data: tool });
});

/** DELETE /api/custom-tools/:id — delete a tool */
router.delete("/custom-tools/:id", async (c) => {
  const ok = await toolsSvc.deleteTool(c.req.param("id"));
  if (!ok) return c.json({ error: "Tool not found" }, 404);
  return c.json({ success: true });
});

/** POST /api/custom-tools/seed — seed default starter tools (idempotent) */
router.post("/custom-tools/seed", async (c) => {
  const created = await toolsSvc.seedDefaultTools();
  const tools = await toolsSvc.listTools();
  return c.json({ data: tools, seeded: created });
});

/** POST /api/custom-tools/:id/test — test-run a tool (server or client) */
router.post("/custom-tools/:id/test", async (c) => {
  const tool = await toolsSvc.getToolById(c.req.param("id"));
  if (!tool) return c.json({ error: "Tool not found" }, 404);

  const body = await c.req.json();
  const params = body.params ?? {};

  const result = await toolsSvc.executeTool(tool, params);
  return c.json({ data: result });
});

export default router;
