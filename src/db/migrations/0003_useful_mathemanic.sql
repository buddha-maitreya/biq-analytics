CREATE TABLE IF NOT EXISTS "agent_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name" varchar(100) NOT NULL,
	"span_type" varchar(30) NOT NULL,
	"span_name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'ok' NOT NULL,
	"duration_ms" integer,
	"session_id" uuid,
	"parent_span_id" varchar(100),
	"error_message" text,
	"attributes" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"decider_id" uuid NOT NULL,
	"decision" varchar(20) NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"action_type" varchar(100) NOT NULL,
	"requester_id" uuid NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action_data" jsonb,
	"requester_note" text,
	"warehouse_id" uuid,
	"resolved_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"approver_role" varchar(50) NOT NULL,
	"approver_user_id" uuid,
	"label" varchar(255),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_type" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"condition" jsonb,
	"step_count" integer DEFAULT 1 NOT NULL,
	"auto_approve_above_role" varchar(50),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"s3_key" varchar(500) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"userId" text NOT NULL,
	"refillInterval" integer,
	"refillAmount" integer,
	"lastRefillAt" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"rateLimitEnabled" boolean DEFAULT true NOT NULL,
	"rateLimitTimeWindow" integer DEFAULT 86400000 NOT NULL,
	"rateLimitMax" integer DEFAULT 10 NOT NULL,
	"requestCount" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"lastRequest" timestamp with time zone,
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"inviterId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"publicKey" text NOT NULL,
	"privateKey" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"activeOrganizationId" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name" varchar(100) NOT NULL,
	"eval_name" varchar(100) NOT NULL,
	"passed" boolean NOT NULL,
	"score" numeric(5, 4),
	"reason" text,
	"session_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "few_shot_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(100) NOT NULL,
	"user_input" text NOT NULL,
	"expected_behavior" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name" varchar(100) NOT NULL,
	"section_key" varchar(100) NOT NULL,
	"template" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"change_notes" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routing_analytics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"user_message" text NOT NULL,
	"tools_selected" jsonb NOT NULL,
	"strategy" varchar(20),
	"had_correction" boolean DEFAULT false,
	"feedback_score" integer,
	"latency_ms" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_type" varchar(100) NOT NULL,
	"title" varchar(500) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"format" varchar(20) DEFAULT 'markdown' NOT NULL,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generated_by" uuid,
	"is_scheduled" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"result" jsonb,
	"error_message" text,
	"trigger_source" varchar(20) DEFAULT 'cron' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"task_type" varchar(50) NOT NULL,
	"cron_expression" varchar(100),
	"task_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"timezone" varchar(100) DEFAULT 'UTC',
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"max_failures" integer DEFAULT 5 NOT NULL,
	"created_by" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_name" varchar(255) NOT NULL,
	"agent_name" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'success' NOT NULL,
	"duration_ms" integer,
	"session_id" uuid,
	"input_size_chars" integer,
	"output_size_chars" integer,
	"error_type" varchar(50),
	"error_message" text,
	"attributes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"status_code" integer NOT NULL,
	"handler" varchar(100) NOT NULL,
	"duration_ms" integer,
	"error_message" text,
	"payload_preview" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"secret" text,
	"signature_header" varchar(100) DEFAULT 'x-signature',
	"hash_algorithm" varchar(20) DEFAULT 'sha256',
	"handler" varchar(100) DEFAULT 'data-science' NOT NULL,
	"is_async" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reports_to" uuid;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT IF NOT EXISTS "approval_decisions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT IF NOT EXISTS "approval_decisions_step_id_approval_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."approval_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT IF NOT EXISTS "approval_decisions_decider_id_users_id_fk" FOREIGN KEY ("decider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT IF NOT EXISTS "approval_requests_workflow_id_approval_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."approval_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT IF NOT EXISTS "approval_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT IF NOT EXISTS "approval_requests_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT IF NOT EXISTS "approval_steps_workflow_id_approval_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."approval_workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT IF NOT EXISTS "approval_steps_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT IF NOT EXISTS "attachments_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT IF NOT EXISTS "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT IF NOT EXISTS "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT IF NOT EXISTS "apikey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT IF NOT EXISTS "invitation_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT IF NOT EXISTS "invitation_inviterId_user_id_fk" FOREIGN KEY ("inviterId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT IF NOT EXISTS "member_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT IF NOT EXISTS "member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT IF NOT EXISTS "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT IF NOT EXISTS "prompt_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT IF NOT EXISTS "saved_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_executions" ADD CONSTRAINT IF NOT EXISTS "schedule_executions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT IF NOT EXISTS "schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_telemetry_agent" ON "agent_telemetry" USING btree ("agent_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_telemetry_span_type" ON "agent_telemetry" USING btree ("span_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_telemetry_status" ON "agent_telemetry" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_telemetry_session" ON "agent_telemetry" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_telemetry_started" ON "agent_telemetry" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_telemetry_agent_type" ON "agent_telemetry" USING btree ("agent_name","span_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_decisions_request" ON "approval_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_decisions_step" ON "approval_decisions" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_decisions_decider" ON "approval_decisions" USING btree ("decider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_decisions_decided" ON "approval_decisions" USING btree ("decided_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_requests_workflow" ON "approval_requests" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_requests_requester" ON "approval_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_requests_status" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_requests_entity" ON "approval_requests" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_requests_warehouse" ON "approval_requests" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_requests_created" ON "approval_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_steps_workflow" ON "approval_steps" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_steps_order" ON "approval_steps" USING btree ("workflow_id","step_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_approval_workflows_action" ON "approval_workflows" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approval_workflows_active" ON "approval_workflows" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attachments_session" ON "attachments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attachments_user" ON "attachments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attachments_created" ON "attachments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "apikey_userId_idx" ON "apikey" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON "invitation" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_organizationId_idx" ON "member" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_userId_idx" ON "member" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eval_results_agent" ON "eval_results" USING btree ("agent_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eval_results_eval" ON "eval_results" USING btree ("eval_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eval_results_passed" ON "eval_results" USING btree ("passed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eval_results_created" ON "eval_results" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eval_results_agent_eval" ON "eval_results" USING btree ("agent_name","eval_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_few_shot_category" ON "few_shot_examples" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_few_shot_active" ON "few_shot_examples" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prompt_templates_agent" ON "prompt_templates" USING btree ("agent_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prompt_templates_section" ON "prompt_templates" USING btree ("section_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prompt_templates_active" ON "prompt_templates" USING btree ("agent_name","section_key","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_routing_analytics_session" ON "routing_analytics" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_routing_analytics_created" ON "routing_analytics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_routing_analytics_tools" ON "routing_analytics" USING btree ("tools_selected");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_saved_reports_type" ON "saved_reports" USING btree ("report_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_saved_reports_period" ON "saved_reports" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_saved_reports_created" ON "saved_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_saved_reports_type_period" ON "saved_reports" USING btree ("report_type","period_start","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sched_exec_schedule" ON "schedule_executions" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sched_exec_status" ON "schedule_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sched_exec_started" ON "schedule_executions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedules_type" ON "schedules" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedules_active" ON "schedules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedules_next_run" ON "schedules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedules_cron" ON "schedules" USING btree ("cron_expression");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tool_inv_tool" ON "tool_invocations" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tool_inv_agent" ON "tool_invocations" USING btree ("agent_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tool_inv_status" ON "tool_invocations" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tool_inv_session" ON "tool_invocations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tool_inv_created" ON "tool_invocations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tool_inv_tool_status" ON "tool_invocations" USING btree ("tool_name","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_events_source" ON "webhook_events" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_events_status" ON "webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_events_created" ON "webhook_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_webhook_sources_name" ON "webhook_sources" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_sources_active" ON "webhook_sources" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_reports_to" ON "users" USING btree ("reports_to");