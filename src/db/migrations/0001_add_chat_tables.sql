-- Migration: Add chat_sessions and chat_messages tables (Phase 8)
-- This is an incremental migration. The other 16 tables already exist in the database.

CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Foreign keys
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;

-- Indexes
CREATE INDEX "idx_chat_sessions_user" ON "chat_sessions" USING btree ("user_id");
CREATE INDEX "idx_chat_sessions_status" ON "chat_sessions" USING btree ("status");
CREATE INDEX "idx_chat_sessions_updated" ON "chat_sessions" USING btree ("updated_at");

CREATE INDEX "idx_chat_messages_session" ON "chat_messages" USING btree ("session_id");
CREATE INDEX "idx_chat_messages_role" ON "chat_messages" USING btree ("role");
CREATE INDEX "idx_chat_messages_created" ON "chat_messages" USING btree ("created_at");
