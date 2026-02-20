import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import { paginationSchema } from "@lib/pagination";
import { createOrderSchema, updateOrderStatusSchema as orderStatusSchema, updateOrderPaymentSchema } from "@lib/validation";
import * as svc from "@services/orders";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

router.get("/orders", async (c) => {
  const params = paginationSchema.parse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
  });
  const customerId = c.req.query("customerId");
  const result = await svc.listOrders(params, customerId);
  return c.json(result);
});

router.get("/orders/statuses", async (c) => {
  const result = await svc.listOrderStatuses();
  return c.json({ data: result });
});

router.get("/orders/:id", async (c) => {
  const order = await svc.getOrder(c.req.param("id"));
  return c.json({ data: order });
});

router.post("/orders", validator({ input: createOrderSchema }), async (c) => {
  const body = c.req.valid("json");
  const order = await svc.createOrder(body);
  return c.json({ data: order }, 201);
});

router.put("/orders/:id/status", validator({ input: orderStatusSchema }), async (c) => {
  const body = c.req.valid("json");
  const order = await svc.updateOrderStatus(c.req.param("id"), body);
  return c.json({ data: order });
});

router.post("/orders/:id/cancel", async (c) => {
  const result = await svc.cancelOrder(c.req.param("id"));
  return c.json({ data: result });
});

router.put("/orders/:id/payment", validator({ input: updateOrderPaymentSchema }), async (c) => {
  const body = c.req.valid("json");
  const order = await svc.updateOrderPayment(c.req.param("id"), body);
  return c.json({ data: order });
});

export default router;
