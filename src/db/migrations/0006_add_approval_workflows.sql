-- Migration: Add approval workflow system
-- Adds reportsTo hierarchy to users + approval workflows, steps, requests, decisions tables

-- 1. Add reports_to column to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reports_to" UUID;
CREATE INDEX IF NOT EXISTS "idx_users_reports_to" ON "users" ("reports_to");

-- 2. Approval Workflows — configurable approval chains for business actions
CREATE TABLE IF NOT EXISTS "approval_workflows" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "action_type" VARCHAR(100) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "condition" JSONB,
  "step_count" INTEGER NOT NULL DEFAULT 1,
  "auto_approve_above_role" VARCHAR(50),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_approval_workflows_action" ON "approval_workflows" ("action_type");
CREATE INDEX IF NOT EXISTS "idx_approval_workflows_active" ON "approval_workflows" ("is_active");

-- 3. Approval Steps — ordered steps within a workflow
CREATE TABLE IF NOT EXISTS "approval_steps" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_id" UUID NOT NULL REFERENCES "approval_workflows" ("id") ON DELETE CASCADE,
  "step_order" INTEGER NOT NULL,
  "approver_role" VARCHAR(50) NOT NULL,
  "approver_user_id" UUID REFERENCES "users" ("id"),
  "label" VARCHAR(255),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_approval_steps_workflow" ON "approval_steps" ("workflow_id");
CREATE INDEX IF NOT EXISTS "idx_approval_steps_order" ON "approval_steps" ("workflow_id", "step_order");

-- 4. Approval Requests — pending/completed approval instances
CREATE TABLE IF NOT EXISTS "approval_requests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_id" UUID NOT NULL REFERENCES "approval_workflows" ("id"),
  "action_type" VARCHAR(100) NOT NULL,
  "requester_id" UUID NOT NULL REFERENCES "users" ("id"),
  "current_step" INTEGER NOT NULL DEFAULT 1,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "entity_type" VARCHAR(50) NOT NULL,
  "entity_id" UUID NOT NULL,
  "action_data" JSONB,
  "requester_note" TEXT,
  "warehouse_id" UUID REFERENCES "warehouses" ("id"),
  "resolved_at" TIMESTAMPTZ,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_approval_requests_workflow" ON "approval_requests" ("workflow_id");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_requester" ON "approval_requests" ("requester_id");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_status" ON "approval_requests" ("status");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_entity" ON "approval_requests" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_warehouse" ON "approval_requests" ("warehouse_id");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_created" ON "approval_requests" ("created_at");

-- 5. Approval Decisions — individual approve/reject decisions per step
CREATE TABLE IF NOT EXISTS "approval_decisions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL REFERENCES "approval_requests" ("id") ON DELETE CASCADE,
  "step_id" UUID NOT NULL REFERENCES "approval_steps" ("id"),
  "step_order" INTEGER NOT NULL,
  "decider_id" UUID NOT NULL REFERENCES "users" ("id"),
  "decision" VARCHAR(20) NOT NULL,
  "comment" TEXT,
  "decided_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_approval_decisions_request" ON "approval_decisions" ("request_id");
CREATE INDEX IF NOT EXISTS "idx_approval_decisions_step" ON "approval_decisions" ("step_id");
CREATE INDEX IF NOT EXISTS "idx_approval_decisions_decider" ON "approval_decisions" ("decider_id");
CREATE INDEX IF NOT EXISTS "idx_approval_decisions_decided" ON "approval_decisions" ("decided_at");
