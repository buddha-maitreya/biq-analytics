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

  try {
    const result = await createAnalysisSnapshot(sandboxApi, runtime, extraDeps);

    c.var.logger?.info("Analysis snapshot created", { snapshotId: result.snapshotId });

    return c.json({
      data: {
        snapshotId: result.snapshotId,
        runtime,
        message: "Snapshot created. Set this snapshotId in the insights-analyzer agent config (sandboxSnapshotId) to use pre-installed packages.",
      },
    }, 201);
  } catch (err: any) {
    c.var.logger?.error("Snapshot creation failed", { error: err?.message ?? String(err) });
    return c.json({ error: "Snapshot creation failed", detail: err?.message ?? String(err) }, 500);
  }
});

// ─── Data Connector Sync Management ─────────────────────────

import { getConnector, listConnectors } from "@services/connectors";

/**
 * GET /admin/connectors — list available data connectors
 */
router.get("/admin/connectors", async (c) => {
  const connectors = listConnectors();
  return c.json({
    data: connectors.map((conn) => ({
      type: conn.type,
      displayName: conn.displayName,
    })),
  });
});

/**
 * GET /admin/syncs — list sync history
 * Reads recent sync records from KV store (if available via c.var.kv).
 * Falls back to an empty list if KV is not provisioned.
 */
router.get("/admin/syncs", async (c) => {
  // NOTE: KV access pattern depends on the Agentuity runtime context.
  // In agent handlers it's ctx.kv; in Hono routes it may be c.var.kv or
  // accessed via a service import. Adjust if the KV access pattern differs.
  const kv = c.var.kv;
  if (!kv) {
    return c.json({ data: [], message: "KV store not available in this context" });
  }

  try {
    // Scan for sync records stored by import agent (keys like "sync:*" or "import:*:latest")
    const syncRecords: unknown[] = [];
    const connectorTypes = ["csv", "rest"];
    for (const connType of connectorTypes) {
      try {
        const record = await kv.get("imports", `import:${connType}:latest`);
        if (record) {
          syncRecords.push({ connector: connType, ...record });
        }
      } catch {
        // Key doesn't exist — skip
      }
    }
    return c.json({ data: syncRecords });
  } catch {
    return c.json({ data: [] });
  }
});

/**
 * POST /admin/syncs/:connector/now — trigger a manual sync for a connector
 */
router.post("/admin/syncs/:connector/now", async (c) => {
  const connectorType = c.req.param("connector");
  const connector = getConnector(connectorType);
  if (!connector) {
    return c.json({ error: `Unknown connector: ${connectorType}` }, 404);
  }

  const body = await c.req.json().catch(() => ({}));

  // Validate connector config
  const config = {
    type: connectorType,
    settings: (body.settings ?? {}) as Record<string, unknown>,
    fieldMapping: body.fieldMapping as Record<string, string> | undefined,
  };

  const validation = await connector.validate(config);
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  // Run sync
  const result = await connector.sync(config, {
    dryRun: body.dryRun ?? false,
    batchSize: body.batchSize ?? 100,
    mode: body.mode ?? "upsert",
  });

  return c.json({ data: result });
});

export default router;
