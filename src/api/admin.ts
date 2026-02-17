import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import * as adminSvc from "@services/admin";

const router = createRouter();
router.use(errorMiddleware());

// ─── Dashboard Stats ─────────────────────────────────────────

router.get("/admin/stats", async (c) => {
  const stats = await adminSvc.getDashboardStats();
  return c.json({ data: stats });
});

// ─── Order Status Management ─────────────────────────────────

router.get("/admin/order-statuses", async (c) => {
  const result = await adminSvc.listOrderStatuses();
  return c.json({ data: result });
});

router.post("/admin/order-statuses", async (c) => {
  const body = await c.req.json();
  const status = await adminSvc.createOrderStatus(body);
  return c.json({ data: status }, 201);
});

router.put("/admin/order-statuses/:id", async (c) => {
  const body = await c.req.json();
  const status = await adminSvc.updateOrderStatus(c.req.param("id"), body);
  return c.json({ data: status });
});

router.delete("/admin/order-statuses/:id", async (c) => {
  await adminSvc.deleteOrderStatus(c.req.param("id"));
  return c.json({ deleted: true });
});

// ─── Tax Rule Management ─────────────────────────────────────

router.get("/admin/tax-rules", async (c) => {
  const result = await adminSvc.listTaxRules();
  return c.json({ data: result });
});

router.post("/admin/tax-rules", async (c) => {
  const body = await c.req.json();
  const rule = await adminSvc.createTaxRule(body);
  return c.json({ data: rule }, 201);
});

router.put("/admin/tax-rules/:id", async (c) => {
  const body = await c.req.json();
  const rule = await adminSvc.updateTaxRule(c.req.param("id"), body);
  return c.json({ data: rule });
});

router.delete("/admin/tax-rules/:id", async (c) => {
  await adminSvc.deleteTaxRule(c.req.param("id"));
  return c.json({ deleted: true });
});

// ─── User Management ─────────────────────────────────────────

router.get("/admin/users", async (c) => {
  const result = await adminSvc.listUsers();
  return c.json({ data: result });
});

router.post("/admin/users", async (c) => {
  const body = await c.req.json();
  const user = await adminSvc.createUser(body);
  return c.json({ data: user }, 201);
});

router.put("/admin/users/:id", async (c) => {
  const body = await c.req.json();
  const user = await adminSvc.updateUser(c.req.param("id"), body);
  return c.json({ data: user });
});

router.delete("/admin/users/:id", async (c) => {
  await adminSvc.deactivateUser(c.req.param("id"));
  return c.json({ deleted: true });
});

export default router;
