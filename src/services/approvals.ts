import {
  db,
  users,
  approvalWorkflows,
  approvalSteps,
  approvalRequests,
  approvalDecisions,
} from "@db/index";
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import { NotFoundError } from "@lib/errors";
import { z } from "zod";

// ─── Schemas ─────────────────────────────────────────────────

export const workflowSchema = z.object({
  actionType: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  condition: z.record(z.unknown()).optional().nullable(),
  autoApproveAboveRole: z.string().max(50).optional().nullable(),
  steps: z.array(
    z.object({
      stepOrder: z.number().int().min(1),
      approverRole: z.string().min(1).max(50),
      approverUserId: z.string().uuid().optional().nullable(),
      label: z.string().max(255).optional(),
    })
  ).min(1),
});

export const approvalRequestSchema = z.object({
  actionType: z.string().min(1).max(100),
  entityType: z.string().min(1).max(50),
  entityId: z.string().uuid(),
  actionData: z.record(z.unknown()).optional(),
  requesterNote: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
});

export const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().optional(),
});

// ─── Role hierarchy (import from admin or replicate for decoupling) ──

const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  staff: 1,
  manager: 2,
  admin: 3,
  super_admin: 4,
};

// ─── Workflow CRUD ───────────────────────────────────────────

/** List all approval workflows */
export async function listWorkflows() {
  const workflows = await db.query.approvalWorkflows.findMany({
    orderBy: [asc(approvalWorkflows.name)],
  });

  // Fetch steps for each workflow
  const workflowIds = workflows.map((w) => w.id);
  if (workflowIds.length === 0) return [];

  const steps = await db.query.approvalSteps.findMany({
    where: inArray(approvalSteps.workflowId, workflowIds),
    orderBy: [asc(approvalSteps.stepOrder)],
  });

  const stepsByWorkflow = new Map<string, typeof steps>();
  for (const step of steps) {
    const existing = stepsByWorkflow.get(step.workflowId) ?? [];
    existing.push(step);
    stepsByWorkflow.set(step.workflowId, existing);
  }

  return workflows.map((w) => ({
    ...w,
    steps: stepsByWorkflow.get(w.id) ?? [],
  }));
}

/** Get a single workflow by ID */
export async function getWorkflow(id: string) {
  const workflow = await db.query.approvalWorkflows.findFirst({
    where: eq(approvalWorkflows.id, id),
  });
  if (!workflow) throw new NotFoundError("Workflow", id);

  const steps = await db.query.approvalSteps.findMany({
    where: eq(approvalSteps.workflowId, id),
    orderBy: [asc(approvalSteps.stepOrder)],
  });

  return { ...workflow, steps };
}

/** Get workflow by action type */
export async function getWorkflowByAction(actionType: string) {
  const workflow = await db.query.approvalWorkflows.findFirst({
    where: and(
      eq(approvalWorkflows.actionType, actionType),
      eq(approvalWorkflows.isActive, true)
    ),
  });
  if (!workflow) return null;

  const steps = await db.query.approvalSteps.findMany({
    where: eq(approvalSteps.workflowId, workflow.id),
    orderBy: [asc(approvalSteps.stepOrder)],
  });

  return { ...workflow, steps };
}

/** Create a workflow with its steps (transaction) */
export async function createWorkflow(data: unknown) {
  const parsed = workflowSchema.parse(data);

  const result = await db.transaction(async (tx) => {
    const [workflow] = await tx
      .insert(approvalWorkflows)
      .values({
        actionType: parsed.actionType,
        name: parsed.name,
        description: parsed.description,
        isActive: parsed.isActive,
        condition: parsed.condition ?? null,
        stepCount: parsed.steps.length,
        autoApproveAboveRole: parsed.autoApproveAboveRole ?? null,
      })
      .returning();

    const stepValues = parsed.steps.map((s) => ({
      workflowId: workflow.id,
      stepOrder: s.stepOrder,
      approverRole: s.approverRole,
      approverUserId: s.approverUserId ?? null,
      label: s.label ?? null,
    }));

    const steps = await tx
      .insert(approvalSteps)
      .values(stepValues)
      .returning();

    return { ...workflow, steps };
  });

  return result;
}

/** Update a workflow and its steps (replace steps) */
export async function updateWorkflow(id: string, data: unknown) {
  const parsed = workflowSchema.partial().parse(data);

  const result = await db.transaction(async (tx) => {
    const updateVals: Record<string, unknown> = {};
    if (parsed.actionType != null) updateVals.actionType = parsed.actionType;
    if (parsed.name != null) updateVals.name = parsed.name;
    if (parsed.description !== undefined) updateVals.description = parsed.description;
    if (parsed.isActive !== undefined) updateVals.isActive = parsed.isActive;
    if (parsed.condition !== undefined) updateVals.condition = parsed.condition;
    if (parsed.autoApproveAboveRole !== undefined)
      updateVals.autoApproveAboveRole = parsed.autoApproveAboveRole;

    if (parsed.steps) {
      updateVals.stepCount = parsed.steps.length;

      // Delete old steps and insert new ones
      await tx.delete(approvalSteps).where(eq(approvalSteps.workflowId, id));

      const stepValues = parsed.steps.map((s) => ({
        workflowId: id,
        stepOrder: s.stepOrder,
        approverRole: s.approverRole,
        approverUserId: s.approverUserId ?? null,
        label: s.label ?? null,
      }));
      await tx.insert(approvalSteps).values(stepValues);
    }

    const [workflow] = await tx
      .update(approvalWorkflows)
      .set(updateVals)
      .where(eq(approvalWorkflows.id, id))
      .returning();

    if (!workflow) throw new NotFoundError("Workflow", id);

    const steps = await tx.query.approvalSteps.findMany({
      where: eq(approvalSteps.workflowId, id),
      orderBy: [asc(approvalSteps.stepOrder)],
    });

    return { ...workflow, steps };
  });

  return result;
}

/** Delete a workflow (cascades to steps) */
export async function deleteWorkflow(id: string) {
  // First check no pending requests reference this workflow
  const pendingCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.workflowId, id),
        eq(approvalRequests.status, "pending")
      )
    );

  if (Number(pendingCount[0]?.count ?? 0) > 0) {
    throw new Error("Cannot delete workflow with pending approval requests. Cancel them first.");
  }

  const [deleted] = await db
    .delete(approvalWorkflows)
    .where(eq(approvalWorkflows.id, id))
    .returning({ id: approvalWorkflows.id });

  if (!deleted) throw new NotFoundError("Workflow", id);
  return deleted;
}

/** Toggle workflow active/inactive */
export async function toggleWorkflow(id: string, isActive: boolean) {
  const [workflow] = await db
    .update(approvalWorkflows)
    .set({ isActive })
    .where(eq(approvalWorkflows.id, id))
    .returning();

  if (!workflow) throw new NotFoundError("Workflow", id);
  return workflow;
}

// ─── Seed Default Workflows ──────────────────────────────────

const DEFAULT_WORKFLOWS = [
  {
    actionType: "inventory.delivery_request",
    name: "Inventory Delivery Request",
    description: "Requires manager approval when staff requests inventory delivery to a branch/warehouse.",
    steps: [
      { stepOrder: 1, approverRole: "manager", label: "Manager Review" },
      { stepOrder: 2, approverRole: "admin", label: "Admin Final Approval" },
    ],
  },
  {
    actionType: "inventory.adjustment",
    name: "Stock Adjustment",
    description: "Requires manager approval for manual stock level adjustments.",
    steps: [
      { stepOrder: 1, approverRole: "manager", label: "Manager Verification" },
    ],
  },
  {
    actionType: "inventory.scan",
    name: "Scan Stock Change",
    description: "Requires manager approval when staff scans inventory changes. Auto-approved for managers and above.",
    autoApproveAboveRole: "manager",
    steps: [
      { stepOrder: 1, approverRole: "manager", label: "Manager Scan Approval" },
    ],
  },
  {
    actionType: "inventory.transfer",
    name: "Inventory Transfer",
    description: "Requires manager approval for inter-branch inventory transfers.",
    steps: [
      { stepOrder: 1, approverRole: "manager", label: "Manager Transfer Approval" },
    ],
  },
  {
    actionType: "order.large_order",
    name: "Large Order Approval",
    description: "Orders above the configured threshold require manager and admin approval.",
    condition: { field: "totalAmount", operator: ">", value: 50000 },
    steps: [
      { stepOrder: 1, approverRole: "manager", label: "Manager Review" },
      { stepOrder: 2, approverRole: "admin", label: "Admin Approval" },
    ],
  },
];

export async function seedDefaultWorkflows() {
  const existing = await db.query.approvalWorkflows.findMany({
    columns: { actionType: true },
  });
  const existingTypes = new Set(existing.map((e) => e.actionType));

  const created: string[] = [];
  for (const wf of DEFAULT_WORKFLOWS) {
    if (existingTypes.has(wf.actionType)) continue;

    await createWorkflow({
      ...wf,
      isActive: true,
    });
    created.push(wf.actionType);
  }

  return { seeded: created.length, workflows: created };
}

// ─── Approval Request Lifecycle ──────────────────────────────

/**
 * Submit an action for approval.
 * Checks if a workflow exists for this action type, creates an approval request,
 * and identifies the first approver.
 * Returns null if no workflow exists (action can proceed without approval).
 */
export async function submitForApproval(
  requesterId: string,
  data: z.infer<typeof approvalRequestSchema>
) {
  const parsed = approvalRequestSchema.parse(data);

  // Find active workflow for this action type
  const workflow = await getWorkflowByAction(parsed.actionType);
  if (!workflow) return null; // No workflow = no approval needed

  // Check auto-approve by role
  const requester = await db.query.users.findFirst({
    where: eq(users.id, requesterId),
    columns: { id: true, role: true, reportsTo: true },
  });
  if (!requester) throw new NotFoundError("User", requesterId);

  if (
    workflow.autoApproveAboveRole &&
    ROLE_RANK[requester.role] >= ROLE_RANK[workflow.autoApproveAboveRole]
  ) {
    // Requester's role is high enough — auto-approve
    return { autoApproved: true, requestId: null };
  }

  // Check condition (if workflow has one)
  if (workflow.condition && parsed.actionData) {
    const cond = workflow.condition as { field: string; operator: string; value: number };
    const fieldValue = Number(parsed.actionData[cond.field] ?? 0);
    let conditionMet = false;
    switch (cond.operator) {
      case ">": conditionMet = fieldValue > cond.value; break;
      case ">=": conditionMet = fieldValue >= cond.value; break;
      case "<": conditionMet = fieldValue < cond.value; break;
      case "<=": conditionMet = fieldValue <= cond.value; break;
      case "==": conditionMet = fieldValue === cond.value; break;
      default: conditionMet = true;
    }
    if (!conditionMet) {
      // Condition not met — no approval needed
      return { autoApproved: true, requestId: null };
    }
  }

  // Create the approval request
  const [request] = await db
    .insert(approvalRequests)
    .values({
      workflowId: workflow.id,
      actionType: parsed.actionType,
      requesterId,
      currentStep: 1,
      status: "pending",
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      actionData: parsed.actionData ?? null,
      requesterNote: parsed.requesterNote ?? null,
      warehouseId: parsed.warehouseId ?? null,
    })
    .returning();

  return {
    autoApproved: false,
    requestId: request.id,
    status: "pending",
    currentStep: 1,
    totalSteps: workflow.stepCount,
    nextApproverRole: workflow.steps[0]?.approverRole ?? "manager",
  };
}

/**
 * Get pending approval requests for a specific user.
 * Finds requests where the user is the designated approver (via reportsTo chain or role).
 */
export async function getPendingApprovalsForUser(userId: string) {
  // Get user info
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, role: true, assignedWarehouses: true },
  });
  if (!user) return [];

  const userRole = user.role;
  const userRoleRank = ROLE_RANK[userRole] ?? 0;

  // Get all pending requests
  const pending = await db.query.approvalRequests.findMany({
    where: eq(approvalRequests.status, "pending"),
    orderBy: [desc(approvalRequests.createdAt)],
  });

  if (pending.length === 0) return [];

  // For each pending request, check if this user is the current approver
  const workflowIds = [...new Set(pending.map((r) => r.workflowId))];
  const workflows = await db.query.approvalWorkflows.findMany({
    where: inArray(approvalWorkflows.id, workflowIds),
  });
  const workflowMap = new Map(workflows.map((w) => [w.id, w]));

  // Get all steps for these workflows
  const allSteps = await db.query.approvalSteps.findMany({
    where: inArray(approvalSteps.workflowId, workflowIds),
    orderBy: [asc(approvalSteps.stepOrder)],
  });
  const stepsByWorkflow = new Map<string, typeof allSteps>();
  for (const step of allSteps) {
    const existing = stepsByWorkflow.get(step.workflowId) ?? [];
    existing.push(step);
    stepsByWorkflow.set(step.workflowId, existing);
  }

  // Get all requesters to check if user is their supervisor
  const requesterIds = [...new Set(pending.map((r) => r.requesterId))];
  const requesters = await db.query.users.findMany({
    where: inArray(users.id, requesterIds),
    columns: { id: true, name: true, email: true, role: true, reportsTo: true },
  });
  const requesterMap = new Map(requesters.map((r) => [r.id, r]));

  const results: Array<{
    request: typeof pending[number];
    workflow: typeof workflows[number];
    currentStepInfo: typeof allSteps[number] | undefined;
    requester: typeof requesters[number] | undefined;
  }> = [];

  for (const request of pending) {
    const wfSteps = stepsByWorkflow.get(request.workflowId) ?? [];
    const currentStepInfo = wfSteps.find((s) => s.stepOrder === request.currentStep);
    if (!currentStepInfo) continue;

    // Check if this user can approve this step
    let canApprove = false;

    // 1. Specific user assigned to step
    if (currentStepInfo.approverUserId === userId) {
      canApprove = true;
    }
    // 2. User has required role level
    else if (userRoleRank >= (ROLE_RANK[currentStepInfo.approverRole] ?? 0)) {
      // 3. Check reportsTo: the requester or previous approver should report to this user
      const requester = requesterMap.get(request.requesterId);
      if (requester) {
        // Direct supervisor
        if (requester.reportsTo === userId) {
          canApprove = true;
        }
        // Or: user is a manager/admin of the same warehouse
        else if (
          request.warehouseId &&
          user.assignedWarehouses &&
          (user.assignedWarehouses as string[]).includes(request.warehouseId)
        ) {
          canApprove = true;
        }
        // Fallback: role-only check (any user with the required role can approve)
        else if (!currentStepInfo.approverUserId) {
          canApprove = true;
        }
      }
    }

    if (canApprove) {
      results.push({
        request,
        workflow: workflowMap.get(request.workflowId)!,
        currentStepInfo,
        requester: requesterMap.get(request.requesterId),
      });
    }
  }

  return results;
}

/** Get count of pending approvals for a user (for badge) */
export async function getPendingApprovalCount(userId: string): Promise<number> {
  const pending = await getPendingApprovalsForUser(userId);
  return pending.length;
}

/** Get a specific approval request with full details */
export async function getApprovalRequest(id: string) {
  const request = await db.query.approvalRequests.findFirst({
    where: eq(approvalRequests.id, id),
  });
  if (!request) throw new NotFoundError("Approval Request", id);

  const [workflow, decisions, requester] = await Promise.all([
    getWorkflow(request.workflowId),
    db.query.approvalDecisions.findMany({
      where: eq(approvalDecisions.requestId, id),
      orderBy: [asc(approvalDecisions.stepOrder)],
    }),
    db.query.users.findFirst({
      where: eq(users.id, request.requesterId),
      columns: { id: true, name: true, email: true, role: true },
    }),
  ]);

  // Get decider names
  const deciderIds = decisions.map((d) => d.deciderId);
  const deciders = deciderIds.length > 0
    ? await db.query.users.findMany({
        where: inArray(users.id, deciderIds),
        columns: { id: true, name: true, email: true, role: true },
      })
    : [];
  const deciderMap = new Map(deciders.map((d) => [d.id, d]));

  return {
    ...request,
    workflow,
    requester,
    decisions: decisions.map((d) => ({
      ...d,
      decider: deciderMap.get(d.deciderId),
    })),
  };
}

/** List approval requests (with filters) */
export async function listApprovalRequests(filters?: {
  status?: string;
  actionType?: string;
  requesterId?: string;
  limit?: number;
}) {
  const conditions: Array<ReturnType<typeof eq>> = [];
  if (filters?.status) conditions.push(eq(approvalRequests.status, filters.status));
  if (filters?.actionType) conditions.push(eq(approvalRequests.actionType, filters.actionType));
  if (filters?.requesterId) conditions.push(eq(approvalRequests.requesterId, filters.requesterId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const requests = await db.query.approvalRequests.findMany({
    where,
    orderBy: [desc(approvalRequests.createdAt)],
    limit: filters?.limit ?? 100,
  });

  // Enrich with requester names
  const requesterIds = [...new Set(requests.map((r) => r.requesterId))];
  const requesters = requesterIds.length > 0
    ? await db.query.users.findMany({
        where: inArray(users.id, requesterIds),
        columns: { id: true, name: true, email: true, role: true },
      })
    : [];
  const requesterMap = new Map(requesters.map((r) => [r.id, r]));

  return requests.map((r) => ({
    ...r,
    requester: requesterMap.get(r.requesterId),
  }));
}

/**
 * Make an approval decision (approve or reject).
 * If approved and there are more steps, advances to the next step.
 * If approved and this was the last step, marks the request as fully approved.
 * If rejected at any step, the entire request is rejected.
 */
export async function makeDecision(
  requestId: string,
  deciderId: string,
  data: z.infer<typeof decisionSchema>
) {
  const parsed = decisionSchema.parse(data);

  const request = await db.query.approvalRequests.findFirst({
    where: eq(approvalRequests.id, requestId),
  });
  if (!request) throw new NotFoundError("Approval Request", requestId);
  if (request.status !== "pending") {
    throw new Error(`Request is already ${request.status}`);
  }

  // Get the workflow and current step
  const workflow = await getWorkflow(request.workflowId);
  const currentStepInfo = workflow.steps.find(
    (s) => s.stepOrder === request.currentStep
  );
  if (!currentStepInfo) throw new Error("Invalid step in workflow");

  // Record the decision
  await db.insert(approvalDecisions).values({
    requestId,
    stepId: currentStepInfo.id,
    stepOrder: request.currentStep,
    deciderId,
    decision: parsed.decision,
    comment: parsed.comment ?? null,
  });

  if (parsed.decision === "rejected") {
    // Rejection at any step rejects the whole request
    const [updated] = await db
      .update(approvalRequests)
      .set({
        status: "rejected",
        resolvedAt: new Date(),
      })
      .where(eq(approvalRequests.id, requestId))
      .returning();

    return { ...updated, decision: "rejected", finalStep: true };
  }

  // Approved — check if there are more steps
  const nextStep = request.currentStep + 1;
  const hasMoreSteps = nextStep <= workflow.stepCount;

  if (hasMoreSteps) {
    // Advance to next step
    const [updated] = await db
      .update(approvalRequests)
      .set({ currentStep: nextStep })
      .where(eq(approvalRequests.id, requestId))
      .returning();

    const nextStepInfo = workflow.steps.find((s) => s.stepOrder === nextStep);
    return {
      ...updated,
      decision: "approved",
      finalStep: false,
      nextStepInfo,
    };
  } else {
    // Last step — fully approved
    const [updated] = await db
      .update(approvalRequests)
      .set({
        status: "approved",
        resolvedAt: new Date(),
      })
      .where(eq(approvalRequests.id, requestId))
      .returning();

    return { ...updated, decision: "approved", finalStep: true };
  }
}

/** Cancel an approval request (by the requester) */
export async function cancelRequest(requestId: string, requesterId: string) {
  const request = await db.query.approvalRequests.findFirst({
    where: eq(approvalRequests.id, requestId),
  });
  if (!request) throw new NotFoundError("Approval Request", requestId);
  if (request.requesterId !== requesterId) {
    throw new Error("Only the requester can cancel this request");
  }
  if (request.status !== "pending") {
    throw new Error(`Request is already ${request.status}`);
  }

  const [updated] = await db
    .update(approvalRequests)
    .set({
      status: "cancelled",
      resolvedAt: new Date(),
    })
    .where(eq(approvalRequests.id, requestId))
    .returning();

  return updated;
}

// ─── Reporting Hierarchy Helpers ─────────────────────────────

/** Get the supervisor chain for a user (walk up reportsTo) */
export async function getSupervisorChain(userId: string): Promise<Array<{ id: string; name: string; email: string; role: string }>> {
  const chain: Array<{ id: string; name: string; email: string; role: string }> = [];
  let currentId = userId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const user = await db.query.users.findFirst({
      where: eq(users.id, currentId),
      columns: { id: true, name: true, email: true, role: true, reportsTo: true },
    });
    if (!user || !user.reportsTo) break;

    const supervisor = await db.query.users.findFirst({
      where: eq(users.id, user.reportsTo),
      columns: { id: true, name: true, email: true, role: true, reportsTo: true },
    });
    if (!supervisor) break;

    chain.push({ id: supervisor.id, name: supervisor.name, email: supervisor.email, role: supervisor.role });
    currentId = supervisor.id;
  }

  return chain;
}

/** Get direct reports for a user */
export async function getDirectReports(userId: string) {
  return db.query.users.findMany({
    where: eq(users.reportsTo, userId),
    columns: { id: true, name: true, email: true, role: true, isActive: true },
    orderBy: [asc(users.name)],
  });
}

/** Get the full organizational tree (for visualization) */
export async function getOrgTree() {
  const allUsers = await db.query.users.findMany({
    where: eq(users.isActive, true),
    columns: { id: true, name: true, email: true, role: true, reportsTo: true },
    orderBy: [asc(users.name)],
  });

  // Build adjacency list
  const childrenMap = new Map<string | null, typeof allUsers>();
  for (const u of allUsers) {
    const parentId = u.reportsTo ?? null;
    const children = childrenMap.get(parentId) ?? [];
    children.push(u);
    childrenMap.set(parentId, children);
  }

  // Build tree recursively
  function buildNode(user: typeof allUsers[number]): Record<string, unknown> {
    const children = childrenMap.get(user.id) ?? [];
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      directReports: children.map(buildNode),
    };
  }

  // Root nodes = users with no reportsTo
  const roots = childrenMap.get(null) ?? [];
  return roots.map(buildNode);
}
