import { createRouter } from "@agentuity/runtime";
import { toAppError } from "@lib/errors";
import * as svc from "@services/warehouses";

const router = createRouter();

router.get("/warehouses", async (c) => {
  try {
    const result = await svc.listWarehouses();
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.get("/warehouses/:id", async (c) => {
  try {
    const warehouse = await svc.getWarehouse(c.req.param("id"));
    return c.json({ data: warehouse });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/warehouses", async (c) => {
  try {
    const body = await c.req.json();
    const warehouse = await svc.createWarehouse(body);
    return c.json({ data: warehouse }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.put("/warehouses/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const warehouse = await svc.updateWarehouse(id, body);
    return c.json({ data: warehouse });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.delete("/warehouses/:id", async (c) => {
  try {
    await svc.deleteWarehouse(c.req.param("id"));
    return c.json({ deleted: true });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

export default router;
