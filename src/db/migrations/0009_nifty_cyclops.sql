CREATE TABLE "analytics_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(50) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_configs_category_unique" UNIQUE("category")
);
--> statement-breakpoint
CREATE INDEX "idx_analytics_configs_category" ON "analytics_configs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_analytics_configs_enabled" ON "analytics_configs" USING btree ("is_enabled");