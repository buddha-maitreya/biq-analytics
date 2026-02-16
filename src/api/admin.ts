import { createRouter } from "@agentuity/runtime";
import { toAppError } from "@lib/errors";
import * as adminSvc from "@services/admin";

const router = createRouter();

// ─── Dashboard Stats ─────────────────────────────────────────

router.get("/admin/stats", async (c) => {
  try {
    const stats = await adminSvc.getDashboardStats();
    return c.json({ data: stats });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

// ─── Order Status Management ─────────────────────────────────

router.get("/admin/order-statuses", async (c) => {
  try {
    const result = await adminSvc.listOrderStatuses();
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/admin/order-statuses", async (c) => {
  try {
    const body = await c.req.json();
    const status = await adminSvc.createOrderStatus(body);
    return c.json({ data: status }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.put("/admin/order-statuses/:id", async (c) => {
  try {
    const body = await c.req.json();
    const status = await adminSvc.updateOrderStatus(c.req.param("id"), body);
    return c.json({ data: status });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.delete("/admin/order-statuses/:id", async (c) => {
  try {
    await adminSvc.deleteOrderStatus(c.req.param("id"));
    return c.json({ deleted: true });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

// ─── Tax Rule Management ─────────────────────────────────────

router.get("/admin/tax-rules", async (c) => {
  try {
    const result = await adminSvc.listTaxRules();
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/admin/tax-rules", async (c) => {
  try {
    const body = await c.req.json();
    const rule = await adminSvc.createTaxRule(body);
    return c.json({ data: rule }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.put("/admin/tax-rules/:id", async (c) => {
  try {
    const body = await c.req.json();
    const rule = await adminSvc.updateTaxRule(c.req.param("id"), body);
    return c.json({ data: rule });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.delete("/admin/tax-rules/:id", async (c) => {
  try {
    await adminSvc.deleteTaxRule(c.req.param("id"));
    return c.json({ deleted: true });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

// ─── User Management ─────────────────────────────────────────

router.get("/admin/users", async (c) => {
  try {
    const result = await adminSvc.listUsers();
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/admin/users", async (c) => {
  try {
    const body = await c.req.json();
    const user = await adminSvc.createUser(body);
    return c.json({ data: user }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.put("/admin/users/:id", async (c) => {
  try {
    const body = await c.req.json();
    const user = await adminSvc.updateUser(c.req.param("id"), body);
    return c.json({ data: user });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.delete("/admin/users/:id", async (c) => {
  try {
    await adminSvc.deactivateUser(c.req.param("id"));
    return c.json({ deleted: true });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

export default router;
