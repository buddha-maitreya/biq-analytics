import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { createAnalysisSnapshot } from "@lib/sandbox";
import type { SandboxRuntime } from "@lib/sandbox";
import * as adminSvc from "@services/admin";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

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

/** Update permissions + warehouse access */
router.put("/admin/users/:id/permissions", async (c) => {
  const body = await c.req.json();
  const { permissions, assignedWarehouses } = body;
  const user = await adminSvc.updateUserPermissions(c.req.param("id"), permissions, assignedWarehouses);
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

// ─── Sandbox Snapshot Management ─────────────────────────────

/**
 * Create a Python analytics snapshot with data science packages pre-installed.
 * One-time setup after deployment. Stores the snapshotId for agent config.
 *
 * POST /admin/sandbox/snapshot
 * Body: { runtime?: "python:3.14", extraDeps?: ["xgboost"] }
 * Returns: { snapshotId: string }
 */
router.post("/admin/sandbox/snapshot", async (c) => {
  const sandboxApi = c.var.sandbox;
  if (!sandboxApi) {
    return c.json({ error: "Sandbox API not available in this environment" }, 503);
  }

  const body = await c.req.json().catch(() => ({}));
  const runtime = (body.runtime as SandboxRuntime) ?? "python:3.14";
  const extraDeps = Array.isArray(body.extraDeps) ? body.extraDeps : [];

  c.var.logger?.info("Creating analysis snapshot", { runtime, extraDeps });

  const result = await createAnalysisSnapshot(sandboxApi, runtime, extraDeps);

  c.var.logger?.info("Analysis snapshot created", { snapshotId: result.snapshotId });

  return c.json({
    data: {
      snapshotId: result.snapshotId,
      runtime,
      message: "Snapshot created. Set this snapshotId in the insights-analyzer agent config (sandboxSnapshotId) to use pre-installed packages.",
    },
  }, 201);
});

export default router;
