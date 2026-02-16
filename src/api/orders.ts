import { createRouter } from "@agentuity/runtime";
import { toAppError } from "@lib/errors";
import { paginationSchema } from "@lib/pagination";
import * as svc from "@services/orders";

const router = createRouter();

router.get("/orders", async (c) => {
  try {
    const params = paginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });
    const customerId = c.req.query("customerId");
    const result = await svc.listOrders(params, customerId);
    return c.json(result);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.get("/orders/statuses", async (c) => {
  try {
    const result = await svc.listOrderStatuses();
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.get("/orders/:id", async (c) => {
  try {
    const order = await svc.getOrder(c.req.param("id"));
    return c.json({ data: order });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/orders", async (c) => {
  try {
    const body = await c.req.json();
    const order = await svc.createOrder(body);
    return c.json({ data: order }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.put("/orders/:id/status", async (c) => {
  try {
    const body = await c.req.json();
    const order = await svc.updateOrderStatus(c.req.param("id"), body);
    return c.json({ data: order });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/orders/:id/cancel", async (c) => {
  try {
    const result = await svc.cancelOrder(c.req.param("id"));
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

export default router;
