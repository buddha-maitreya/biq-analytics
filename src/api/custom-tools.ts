import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import { createCustomToolSchema, updateCustomToolSchema, testCustomToolSchema } from "@lib/validation";
import * as toolsSvc from "@services/custom-tools";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

/** GET /api/custom-tools — list all custom tools */
router.get("/custom-tools", async (c) => {
  const tools = await toolsSvc.listTools();
  return c.json({ data: tools });
});

/** GET /api/custom-tools/mcp — list only MCP-type tools */
router.get("/custom-tools/mcp", async (c) => {
  const tools = await toolsSvc.listMcpTools();
  return c.json({ data: tools });
});

/** GET /api/custom-tools/:id — get a single tool */
router.get("/custom-tools/:id", async (c) => {
  const tool = await toolsSvc.getToolById(c.req.param("id"));
  if (!tool) return c.json({ error: "Tool not found" }, 404);
  return c.json({ data: tool });
});

/** POST /api/custom-tools — create a new tool */
router.post("/custom-tools", validator({ input: createCustomToolSchema }), async (c) => {
  const body = c.req.valid("json");
  const tool = await toolsSvc.createTool(body);
  return c.json({ data: tool }, 201);
});

/** PUT /api/custom-tools/:id — update a tool */
router.put("/custom-tools/:id", validator({ input: updateCustomToolSchema }), async (c) => {
  const body = c.req.valid("json");
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

/** POST /api/custom-tools/seed-mcp — seed default MCP integrations (idempotent) */
router.post("/custom-tools/seed-mcp", async (c) => {
  const created = await toolsSvc.seedMcpTools();
  const mcpTools = await toolsSvc.listMcpTools();
  return c.json({ data: mcpTools, seeded: created });
});

/** POST /api/custom-tools/:id/test — test-run a tool (server or client) */
router.post("/custom-tools/:id/test", validator({ input: testCustomToolSchema }), async (c) => {
  const tool = await toolsSvc.getToolById(c.req.param("id"));
  if (!tool) return c.json({ error: "Tool not found" }, 404);

  const body = c.req.valid("json");
  const params = body.params ?? {};

  const result = await toolsSvc.executeTool(tool, params);
  return c.json({ data: result });
});

export default router;
