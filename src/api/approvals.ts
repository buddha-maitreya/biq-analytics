import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware, type AppUser as AuthUser } from "@lib/auth";
import * as approvalSvc from "@services/approvals";
import { commitApprovedScan } from "@services/scan";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

// ─── Workflow CRUD (admin only) ──────────────────────────────

router.get("/approvals/workflows", async (c) => {
  const workflows = await approvalSvc.listWorkflows();
  return c.json({ data: workflows });
});

router.get("/approvals/workflows/:id", async (c) => {
  const workflow = await approvalSvc.getWorkflow(c.req.param("id"));
  return c.json({ data: workflow });
});

router.post("/approvals/workflows", async (c) => {
  const body = await c.req.json();
  const workflow = await approvalSvc.createWorkflow(body);
  return c.json({ data: workflow }, 201);
});

router.put("/approvals/workflows/:id", async (c) => {
  const body = await c.req.json();
  const workflow = await approvalSvc.updateWorkflow(c.req.param("id"), body);
  return c.json({ data: workflow });
});

router.delete("/approvals/workflows/:id", async (c) => {
  await approvalSvc.deleteWorkflow(c.req.param("id"));
  return c.json({ success: true });
});

router.post("/approvals/workflows/:id/toggle", async (c) => {
  const body = await c.req.json();
  const workflow = await approvalSvc.toggleWorkflow(c.req.param("id"), body.isActive);
  return c.json({ data: workflow });
});

router.post("/approvals/workflows/seed", async (c) => {
  const result = await approvalSvc.seedDefaultWorkflows();
  return c.json({ data: result });
});

// ─── Approval Requests ──────────────────────────────────────

/** Submit an action for approval */
router.post("/approvals/submit", async (c) => {
  const auth = c.get("appUser" as any) as AuthUser;
  const body = await c.req.json();
  const result = await approvalSvc.submitForApproval(auth.id, body);

  if (!result) {
    return c.json({ data: { requiresApproval: false } });
  }
  return c.json({ data: { requiresApproval: !result.autoApproved, ...result } }, 201);
});

/** Get pending approvals for the current user */
router.get("/approvals/pending", async (c) => {
  const auth = c.get("appUser" as any) as AuthUser;
  const pending = await approvalSvc.getPendingApprovalsForUser(auth.id);
  return c.json({ data: pending });
});

/** Get pending approval count (for badge) */
router.get("/approvals/pending/count", async (c) => {
  const auth = c.get("appUser" as any) as AuthUser;
  const count = await approvalSvc.getPendingApprovalCount(auth.id);
  return c.json({ data: { count } });
});

/** List all approval requests (with optional filters) */
router.get("/approvals/requests", async (c) => {
  const status = c.req.query("status") || undefined;
  const actionType = c.req.query("actionType") || undefined;
  const requesterId = c.req.query("requesterId") || undefined;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : undefined;
  const requests = await approvalSvc.listApprovalRequests({ status, actionType, requesterId, limit });
  return c.json({ data: requests });
});

/** Get single approval request with full details */
router.get("/approvals/requests/:id", async (c) => {
  const request = await approvalSvc.getApprovalRequest(c.req.param("id"));
  return c.json({ data: request });
});

/** Make a decision (approve/reject) */
router.post("/approvals/requests/:id/decide", async (c) => {
  const auth = c.get("appUser" as any) as AuthUser;
  const body = await c.req.json();
  const result = await approvalSvc.makeDecision(c.req.param("id"), auth.id, body);

  // Post-decision hook: if a scan approval was fully approved, commit the stock change
  if (
    result.status === "approved" &&
    result.actionType === "inventory.scan" &&
    result.entityType === "scan_event" &&
    result.entityId
  ) {
    try {
      const scanResult = await commitApprovedScan(result.entityId);
      return c.json({
        data: {
          ...result,
          scanCommitted: scanResult.success,
          scanResult,
        },
      });
    } catch (err) {
      // Approval succeeded but stock commit failed — report both
      return c.json({
        data: {
          ...result,
          scanCommitted: false,
          scanError: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return c.json({ data: result });
});

/** Cancel an approval request (by requester) */
router.post("/approvals/requests/:id/cancel", async (c) => {
  const auth = c.get("appUser" as any) as AuthUser;
  const result = await approvalSvc.cancelRequest(c.req.param("id"), auth.id);
  return c.json({ data: result });
});

// ─── Org Hierarchy ──────────────────────────────────────────

/** Get supervisor chain for a user */
router.get("/approvals/hierarchy/:userId", async (c) => {
  const chain = await approvalSvc.getSupervisorChain(c.req.param("userId"));
  return c.json({ data: chain });
});

/** Get direct reports for a user */
router.get("/approvals/reports/:userId", async (c) => {
  const reports = await approvalSvc.getDirectReports(c.req.param("userId"));
  return c.json({ data: reports });
});

/** Get full org tree */
router.get("/approvals/org-tree", async (c) => {
  const tree = await approvalSvc.getOrgTree();
  return c.json({ data: tree });
});

export default router;
