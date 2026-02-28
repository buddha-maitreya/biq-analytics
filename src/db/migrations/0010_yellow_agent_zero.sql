CREATE TABLE "pos_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pos_vendor" varchar(50) NOT NULL,
	"pos_tx_id" varchar(255) NOT NULL,
	"event_type" varchar(30) DEFAULT 'sale' NOT NULL,
	"pos_payload" jsonb,
	"status" varchar(30) DEFAULT 'received' NOT NULL,
	"order_id" uuid,
	"warehouse_id" uuid,
	"vendor_config_id" uuid,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"item_count" integer,
	"total_amount" numeric(12, 2),
	"payment_method" varchar(50),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_vendor_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor" varchar(50) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"auth_type" varchar(30) DEFAULT 'none' NOT NULL,
	"auth_secret" text,
	"signature_header" varchar(100),
	"field_mapping" jsonb,
	"webhook_url" text,
	"default_warehouse_id" uuid,
	"settings" jsonb,
	"last_sync_at" timestamp with time zone,
	"error_count" integer DEFAULT 0 NOT NULL,
	"total_transactions" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_vendor_config_id_pos_vendor_configs_id_fk" FOREIGN KEY ("vendor_config_id") REFERENCES "public"."pos_vendor_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_vendor_configs" ADD CONSTRAINT "pos_vendor_configs_default_warehouse_id_warehouses_id_fk" FOREIGN KEY ("default_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pos_tx_vendor_txid" ON "pos_transactions" USING btree ("pos_vendor","pos_tx_id");--> statement-breakpoint
CREATE INDEX "idx_pos_tx_status" ON "pos_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pos_tx_order" ON "pos_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_pos_tx_warehouse" ON "pos_transactions" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_pos_tx_vendor" ON "pos_transactions" USING btree ("pos_vendor");--> statement-breakpoint
CREATE INDEX "idx_pos_tx_event_type" ON "pos_transactions" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_pos_tx_created" ON "pos_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_pos_vendor_configs_vendor" ON "pos_vendor_configs" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX "idx_pos_vendor_configs_active" ON "pos_vendor_configs" USING btree ("is_active");