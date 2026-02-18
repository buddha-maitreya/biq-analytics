-- Agent Configs — per-agent settings configurable from the Admin Console
CREATE TABLE IF NOT EXISTS "agent_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_name" varchar(50) NOT NULL UNIQUE,
  "display_name" varchar(100) NOT NULL,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "model_override" varchar(100),
  "temperature" numeric(3, 2),
  "max_steps" integer,
  "timeout_ms" integer,
  "custom_instructions" text,
  "execution_priority" integer NOT NULL DEFAULT 0,
  "config" jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_agent_configs_name" ON "agent_configs" ("agent_name");
CREATE INDEX IF NOT EXISTS "idx_agent_configs_active" ON "agent_configs" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_agent_configs_priority" ON "agent_configs" ("execution_priority");
