import { createRouter } from "@agentuity/runtime";
import { toAppError } from "@lib/errors";
import * as svc from "@services/pricing";

const router = createRouter();

/** Get price breakdown for a single product */
router.get("/pricing/:productId", async (c) => {
  try {
    const result = await svc.calculatePrice(c.req.param("productId"));
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** Bulk calculate prices (cart / quote) */
router.post("/pricing/calculate", async (c) => {
  try {
    const { items } = await c.req.json();
    const result = await svc.bulkCalculate(items ?? []);
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

/** Get configured tax rules */
router.get("/pricing/tax-rules", async (c) => {
  try {
    const result = await svc.getTaxRules();
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

export default router;
