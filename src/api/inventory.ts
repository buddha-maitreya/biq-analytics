import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import * as svc from "@services/inventory";

const router = createRouter();
router.use(errorMiddleware());

/** Adjust stock level */
router.post("/inventory/adjust", async (c) => {
  const body = await c.req.json();
  const tx = await svc.adjustStock(body);
  return c.json({ data: tx }, 201);
});

/** Transfer stock between warehouses */
router.post("/inventory/transfer", async (c) => {
  const body = await c.req.json();
  const result = await svc.transferStock(body);
  return c.json({ data: result });
});

/** Get stock for a product in a warehouse */
router.get("/inventory/stock/:productId/:warehouseId", async (c) => {
  const stock = await svc.getStock(
    c.req.param("productId"),
    c.req.param("warehouseId")
  );
  return c.json({ data: stock });
});

/** List stock across all warehouses for a product */
router.get("/inventory/product/:productId", async (c) => {
  const result = await svc.getStockByProduct(c.req.param("productId"));
  return c.json({ data: result });
});

/** List all stock in a warehouse */
router.get("/inventory/warehouse/:warehouseId", async (c) => {
  const result = await svc.getStockByWarehouse(c.req.param("warehouseId"));
  return c.json({ data: result });
});

/** Get products below reorder point */
router.get("/inventory/low-stock", async (c) => {
  const result = await svc.getLowStockProducts();
  return c.json({ data: result });
});

/** Transaction history for a product */
router.get("/inventory/transactions/:productId", async (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50");
  const result = await svc.getTransactionHistory(
    c.req.param("productId"),
    limit
  );
  return c.json({ data: result });
});

export default router;
