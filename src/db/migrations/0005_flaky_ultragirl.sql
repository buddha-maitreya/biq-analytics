CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response_snapshot" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"barcode" varchar(255) NOT NULL,
	"device_type" varchar(30) DEFAULT 'web' NOT NULL,
	"status" varchar(30) DEFAULT 'pending_sync' NOT NULL,
	"linked_transaction_id" uuid,
	"product_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"scan_type" varchar(30) DEFAULT 'scan_add' NOT NULL,
	"error_message" text,
	"idempotency_key" varchar(100),
	"raw_payload" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "device_type" varchar(30);--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_idempotency_key" ON "idempotency_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_idempotency_expires" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_scan_events_warehouse" ON "scan_events" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_scan_events_user" ON "scan_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_scan_events_barcode" ON "scan_events" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "idx_scan_events_status" ON "scan_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_scan_events_product" ON "scan_events" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_scan_events_created" ON "scan_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_scan_events_idempotency" ON "scan_events" USING btree ("idempotency_key");