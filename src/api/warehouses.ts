import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import { createWarehouseSchema, updateWarehouseSchema } from "@lib/validation";
import * as svc from "@services/warehouses";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

router.get("/warehouses", async (c) => {
  const result = await svc.listWarehouses();
  return c.json({ data: result });
});

router.get("/warehouses/summary", async (c) => {
  const result = await svc.listWarehousesWithInventory();
  return c.json({ data: result });
});

router.get("/warehouses/:id", async (c) => {
  const warehouse = await svc.getWarehouse(c.req.param("id"));
  return c.json({ data: warehouse });
});

router.post("/warehouses", validator({ input: createWarehouseSchema }), async (c) => {
  const body = c.req.valid("json");
  const warehouse = await svc.createWarehouse(body);
  return c.json({ data: warehouse }, 201);
});

router.put("/warehouses/:id", validator({ input: updateWarehouseSchema }), async (c) => {
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const warehouse = await svc.updateWarehouse(id, body);
  return c.json({ data: warehouse });
});

router.delete("/warehouses/:id", async (c) => {
  await svc.deleteWarehouse(c.req.param("id"));
  return c.json({ deleted: true });
});

export default router;
