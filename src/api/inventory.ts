import { createRouter } from "@agentuity/runtime";
import { toAppError } from "@lib/errors";
import * as svc from "@services/inventory";

const router = createRouter();

/** Adjust stock level */
router.post("/inventory/adjust", async (c) => {
  try {
    const body = await c.req.json();
    const tx = await svc.adjustStock(body);
    return c.json({ data: tx }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** Transfer stock between warehouses */
router.post("/inventory/transfer", async (c) => {
  try {
    const body = await c.req.json();
    const result = await svc.transferStock(body);
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** Get stock for a product in a warehouse */
router.get("/inventory/stock/:productId/:warehouseId", async (c) => {
  try {
    const stock = await svc.getStock(
      c.req.param("productId"),
      c.req.param("warehouseId")
    );
    return c.json({ data: stock });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** List stock across all warehouses for a product */
router.get("/inventory/product/:productId", async (c) => {
  try {
    const result = await svc.getStockByProduct(c.req.param("productId"));
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** List all stock in a warehouse */
router.get("/inventory/warehouse/:warehouseId", async (c) => {
  try {
    const result = await svc.getStockByWarehouse(c.req.param("warehouseId"));
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** Get products below reorder point */
router.get("/inventory/low-stock", async (c) => {
  try {
    const result = await svc.getLowStockProducts();
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** Transaction history for a product */
router.get("/inventory/transactions/:productId", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") ?? "50");
    const result = await svc.getTransactionHistory(
      c.req.param("productId"),
      limit
    );
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

export default router;
