import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import {
  createAdminOrderStatusSchema,
  updateAdminOrderStatusSchema,
  createTaxRuleSchema,
  updateTaxRuleSchema,
  createUserSchema,
  updateUserSchema,
  updateUserPermissionsSchema,
} from "@lib/validation";
import * as adminSvc from "@services/admin";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

// ─── Dashboard Stats ─────────────────────────────────────────

router.get("/admin/stats", async (c) => {
  const stats = await adminSvc.getDashboardStats();
  return c.json({ data: stats });
});

router.get("/admin/chart-data", async (c) => {
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const data = await adminSvc.getDashboardChartData(startDate, endDate);
  return c.json({ data });
});

// ─── Order Status Management ─────────────────────────────────

router.get("/admin/order-statuses", async (c) => {
  const result = await adminSvc.listOrderStatuses();
  return c.json({ data: result });
});

router.post("/admin/order-statuses", validator({ input: createAdminOrderStatusSchema }), async (c) => {
  const body = c.req.valid("json");
  const status = await adminSvc.createOrderStatus(body);
  return c.json({ data: status }, 201);
});

router.put("/admin/order-statuses/:id", validator({ input: updateAdminOrderStatusSchema }), async (c) => {
  const body = c.req.valid("json");
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

router.post("/admin/tax-rules", validator({ input: createTaxRuleSchema }), async (c) => {
  const body = c.req.valid("json");
  const rule = await adminSvc.createTaxRule(body);
  return c.json({ data: rule }, 201);
});

router.put("/admin/tax-rules/:id", validator({ input: updateTaxRuleSchema }), async (c) => {
  const body = c.req.valid("json");
  const rule = await adminSvc.updateTaxRule(c.req.param("id"), body);
  return c.json({ data: rule });
});

router.delete("/admin/tax-rules/:id", async (c) => {
  await adminSvc.deleteTaxRule(c.req.param("id"));
  return c.json({ deleted: true });
});

// ─── User Management (RBAC-enhanced) ─────────────────────────

/** RBAC config — roles, permissions, defaults */
router.get("/admin/rbac-config", async (c) => {
  const config = adminSvc.getRBACConfig();
  return c.json({ data: config });
});

/** List users with warehouse assignments */
router.get("/admin/users", async (c) => {
  const result = await adminSvc.listUsersWithWarehouses();
  return c.json({ data: result });
});

router.post("/admin/users", validator({ input: createUserSchema }), async (c) => {
  const body = c.req.valid("json");
  const user = await adminSvc.createUser(body);
  return c.json({ data: user }, 201);
});

router.put("/admin/users/:id", validator({ input: updateUserSchema }), async (c) => {
  const body = c.req.valid("json");
  const user = await adminSvc.updateUser(c.req.param("id"), body);
  return c.json({ data: user });
});

/** Update permissions + warehouse access */
router.put("/admin/users/:id/permissions", validator({ input: updateUserPermissionsSchema }), async (c) => {
  const body = c.req.valid("json");
  const user = await adminSvc.updateUserPermissions(c.req.param("id"), body.permissions ?? [], body.assignedWarehouses);
  return c.json({ data: user });
});

router.post("/admin/users/:id/deactivate", async (c) => {
  await adminSvc.deactivateUser(c.req.param("id"));
  return c.json({ ok: true });
});

router.post("/admin/users/:id/activate", async (c) => {
  await adminSvc.activateUser(c.req.param("id"));
  return c.json({ ok: true });
});

router.delete("/admin/users/:id", async (c) => {
  await adminSvc.deactivateUser(c.req.param("id"));
  return c.json({ deleted: true });
});

// ────────────────────────────────────────────────────────────
// Sandbox Snapshot Management
// ────────────────────────────────────────────────────────────

router.post("/admin/sandbox/snapshot", async (c) => {
  const { createAnalysisSnapshot, ANALYSIS_DEPENDENCIES } = await import("@lib/sandbox");
  const body = await c.req.json().catch(() => ({}));
  const runtime = (body as any)?.runtime ?? "bun:1";
  const extraDeps = (body as any)?.extraDeps ?? [];
  const sandboxApi = (c as any).var?.sandbox;

  if (!sandboxApi) {
    return c.json({ error: "Sandbox API not available" }, 500);
  }

  try {
    c.var.logger.info("Creating sandbox snapshot", { runtime, extraDeps });
    const { snapshotId } = await createAnalysisSnapshot(sandboxApi, runtime, extraDeps);
    c.var.logger.info("Sandbox snapshot created", { snapshotId, runtime });
    return c.json({
      snapshotId,
      runtime,
      dependencies: [...ANALYSIS_DEPENDENCIES, ...extraDeps],
      message: "Snapshot created. Set sandboxSnapshotId in agent config to use it.",
    });
  } catch (err: any) {
    c.var.logger.error("Failed to create sandbox snapshot", { error: String(err) });
    return c.json({ error: `Snapshot creation failed: ${err.message}` }, 500);
  }
});

export default router;
