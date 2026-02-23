import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { paginationSchema } from "@lib/pagination";
import * as svc from "@services/sales";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

router.get("/sales", async (c) => {
  const params = paginationSchema.parse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
  });
  const search = c.req.query("search");
  const warehouseId = c.req.query("warehouseId");
  const result = await svc.listSales(params, { search, warehouseId });
  return c.json(result);
});

router.get("/sales/summary", async (c) => {
  const warehouseId = c.req.query("warehouseId");
  const summary = await svc.getSalesSummary(warehouseId);
  return c.json({ data: summary });
});

router.get("/sales/:id", async (c) => {
  const sale = await svc.getSale(c.req.param("id"));
  if (!sale) return c.json({ error: "Sale not found" }, 404);
  return c.json({ data: sale });
});

router.post("/sales", async (c) => {
  const body = await c.req.json();
  const sale = await svc.createSale(body);
  return c.json({ data: sale }, 201);
});

export default router;
