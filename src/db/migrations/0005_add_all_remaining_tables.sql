-- Consolidated Migration: All tables added after 0000_cuddly_amazoness.sql
-- This migration is idempotent (IF NOT EXISTS) so it's safe to run even if
-- some tables were already created by earlier hand-written migrations.
--
-- Tables created:
--   1.  saved_reports          (Phase 5.4)
--   2.  prompt_templates       (Phase 7+)
--   3.  eval_results           (Phase 7+)
--   4.  routing_analytics      (Phase 7+)
--   5.  few_shot_examples      (Phase 7+)
--   6.  schedules              (Phase 5.6)
--   7.  schedule_executions    (Phase 5.6)
--   8.  agent_telemetry        (Phase 1.10)
--   9.  tool_invocations       (Phase 2.2)
--   10. webhook_sources        (Phase 5.5)
--   11. webhook_events         (Phase 5.5)
--   12. attachments            (Phase 6.4)

-- ────────────────────────────────────────────────────────────
-- 1. Saved Reports (Phase 5.4)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "saved_reports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "report_type" VARCHAR(100) NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "period_start" TIMESTAMPTZ NOT NULL,
  "period_end" TIMESTAMPTZ NOT NULL,
  "format" VARCHAR(20) NOT NULL DEFAULT 'markdown',
  "content" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "generated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "is_scheduled" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_saved_reports_type" ON "saved_reports" ("report_type");
CREATE INDEX IF NOT EXISTS "idx_saved_reports_period" ON "saved_reports" ("period_start", "period_end");
CREATE INDEX IF NOT EXISTS "idx_saved_reports_created" ON "saved_reports" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_saved_reports_type_period" ON "saved_reports" ("report_type", "period_start", "period_end");

-- ────────────────────────────────────────────────────────────
-- 2. Prompt Templates (Phase 7+)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "prompt_templates" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_name" VARCHAR(100) NOT NULL,
  "section_key" VARCHAR(100) NOT NULL,
  "template" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "change_notes" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_prompt_templates_agent" ON "prompt_templates" ("agent_name");
CREATE INDEX IF NOT EXISTS "idx_prompt_templates_section" ON "prompt_templates" ("section_key");
CREATE INDEX IF NOT EXISTS "idx_prompt_templates_active" ON "prompt_templates" ("agent_name", "section_key", "is_active");

-- ────────────────────────────────────────────────────────────
-- 3. Eval Results (Phase 7+)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "eval_results" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_name" VARCHAR(100) NOT NULL,
  "eval_name" VARCHAR(100) NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "score" NUMERIC(5, 4),
  "reason" TEXT,
  "session_id" UUID,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_eval_results_agent" ON "eval_results" ("agent_name");
CREATE INDEX IF NOT EXISTS "idx_eval_results_eval" ON "eval_results" ("eval_name");
CREATE INDEX IF NOT EXISTS "idx_eval_results_passed" ON "eval_results" ("passed");
CREATE INDEX IF NOT EXISTS "idx_eval_results_created" ON "eval_results" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_eval_results_agent_eval" ON "eval_results" ("agent_name", "eval_name");

-- ────────────────────────────────────────────────────────────
-- 4. Routing Analytics (Phase 7+)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "routing_analytics" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" UUID,
  "user_message" TEXT NOT NULL,
  "tools_selected" JSONB NOT NULL,
  "strategy" VARCHAR(20),
  "had_correction" BOOLEAN DEFAULT false,
  "feedback_score" INTEGER,
  "latency_ms" INTEGER,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_routing_analytics_session" ON "routing_analytics" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_routing_analytics_created" ON "routing_analytics" ("created_at");

-- ────────────────────────────────────────────────────────────
-- 5. Few-Shot Examples (Phase 7+)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "few_shot_examples" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "category" VARCHAR(100) NOT NULL,
  "user_input" TEXT NOT NULL,
  "expected_behavior" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER DEFAULT 0,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_few_shot_category" ON "few_shot_examples" ("category");
CREATE INDEX IF NOT EXISTS "idx_few_shot_active" ON "few_shot_examples" ("is_active");

-- ────────────────────────────────────────────────────────────
-- 6. Schedules (Phase 5.6)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "schedules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(255) NOT NULL,
  "task_type" VARCHAR(50) NOT NULL,
  "cron_expression" VARCHAR(100),
  "task_config" JSONB NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "timezone" VARCHAR(100) DEFAULT 'UTC',
  "last_run_at" TIMESTAMPTZ,
  "next_run_at" TIMESTAMPTZ,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "max_failures" INTEGER NOT NULL DEFAULT 5,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_schedules_type" ON "schedules" ("task_type");
CREATE INDEX IF NOT EXISTS "idx_schedules_active" ON "schedules" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_schedules_next_run" ON "schedules" ("next_run_at");
CREATE INDEX IF NOT EXISTS "idx_schedules_cron" ON "schedules" ("cron_expression");

-- ────────────────────────────────────────────────────────────
-- 7. Schedule Executions (Phase 5.6)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "schedule_executions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "schedule_id" UUID NOT NULL REFERENCES "schedules"("id") ON DELETE CASCADE,
  "status" VARCHAR(20) NOT NULL DEFAULT 'running',
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ,
  "duration_ms" INTEGER,
  "result" JSONB,
  "error_message" TEXT,
  "trigger_source" VARCHAR(20) NOT NULL DEFAULT 'cron',
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_sched_exec_schedule" ON "schedule_executions" ("schedule_id");
CREATE INDEX IF NOT EXISTS "idx_sched_exec_status" ON "schedule_executions" ("status");
CREATE INDEX IF NOT EXISTS "idx_sched_exec_started" ON "schedule_executions" ("started_at");

-- ────────────────────────────────────────────────────────────
-- 8. Agent Telemetry (Phase 1.10)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_telemetry" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_name" VARCHAR(100) NOT NULL,
  "span_type" VARCHAR(30) NOT NULL,
  "span_name" VARCHAR(255) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ok',
  "duration_ms" INTEGER,
  "session_id" UUID,
  "parent_span_id" VARCHAR(100),
  "error_message" TEXT,
  "attributes" JSONB,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_telemetry_agent" ON "agent_telemetry" ("agent_name");
CREATE INDEX IF NOT EXISTS "idx_telemetry_span_type" ON "agent_telemetry" ("span_type");
CREATE INDEX IF NOT EXISTS "idx_telemetry_status" ON "agent_telemetry" ("status");
CREATE INDEX IF NOT EXISTS "idx_telemetry_session" ON "agent_telemetry" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_telemetry_started" ON "agent_telemetry" ("started_at");
CREATE INDEX IF NOT EXISTS "idx_telemetry_agent_type" ON "agent_telemetry" ("agent_name", "span_type");

-- ────────────────────────────────────────────────────────────
-- 9. Tool Invocations (Phase 2.2)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tool_invocations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tool_name" VARCHAR(255) NOT NULL,
  "agent_name" VARCHAR(100) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'success',
  "duration_ms" INTEGER,
  "session_id" UUID,
  "input_size_chars" INTEGER,
  "output_size_chars" INTEGER,
  "error_type" VARCHAR(50),
  "error_message" TEXT,
  "attributes" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_tool_inv_tool" ON "tool_invocations" ("tool_name");
CREATE INDEX IF NOT EXISTS "idx_tool_inv_agent" ON "tool_invocations" ("agent_name");
CREATE INDEX IF NOT EXISTS "idx_tool_inv_status" ON "tool_invocations" ("status");
CREATE INDEX IF NOT EXISTS "idx_tool_inv_session" ON "tool_invocations" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_tool_inv_created" ON "tool_invocations" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_tool_inv_tool_status" ON "tool_invocations" ("tool_name", "status");

-- ────────────────────────────────────────────────────────────
-- 10. Webhook Sources (Phase 5.5)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "webhook_sources" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(50) NOT NULL,
  "secret" TEXT,
  "signature_header" VARCHAR(100) DEFAULT 'x-signature',
  "hash_algorithm" VARCHAR(20) DEFAULT 'sha256',
  "handler" VARCHAR(100) NOT NULL DEFAULT 'data-science',
  "is_async" BOOLEAN NOT NULL DEFAULT true,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_webhook_sources_name" ON "webhook_sources" ("name");
CREATE INDEX IF NOT EXISTS "idx_webhook_sources_active" ON "webhook_sources" ("is_active");

-- ────────────────────────────────────────────────────────────
-- 11. Webhook Events (Phase 5.5)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" VARCHAR(50) NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "status_code" INTEGER NOT NULL,
  "handler" VARCHAR(100) NOT NULL,
  "duration_ms" INTEGER,
  "error_message" TEXT,
  "payload_preview" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_webhook_events_source" ON "webhook_events" ("source");
CREATE INDEX IF NOT EXISTS "idx_webhook_events_status" ON "webhook_events" ("status");
CREATE INDEX IF NOT EXISTS "idx_webhook_events_created" ON "webhook_events" ("created_at");

-- ────────────────────────────────────────────────────────────
-- 12. Chat Attachments (Phase 6.4)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "attachments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id"),
  "filename" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "s3_key" VARCHAR(500) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_attachments_session" ON "attachments" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_attachments_user" ON "attachments" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_attachments_created" ON "attachments" ("created_at");
