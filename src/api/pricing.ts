import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import * as svc from "@services/pricing";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

/** Get price breakdown for a single product */
router.get("/pricing/:productId", async (c) => {
  const result = await svc.calculatePrice(c.req.param("productId"));
  return c.json({ data: result });
});

/** Bulk calculate prices (cart / quote) */
router.post("/pricing/calculate", async (c) => {
  const { items } = await c.req.json();
  const result = await svc.bulkCalculate(items ?? []);
  return c.json({ data: result });
});

/** Get configured tax rules */
router.get("/pricing/tax-rules", async (c) => {
  const result = await svc.getTaxRules();
  return c.json({ data: result });
});

export default router;
