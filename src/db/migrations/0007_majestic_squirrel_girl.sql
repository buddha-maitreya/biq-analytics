CREATE TABLE "transfer_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"expected_quantity" integer NOT NULL,
	"dispatched_quantity" integer NOT NULL,
	"received_quantity" integer,
	"discrepancy_reason" varchar(30),
	"discrepancy_note" text,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid NOT NULL,
	"status" varchar(40) DEFAULT 'draft' NOT NULL,
	"acceptance_mode" varchar(20),
	"initiated_by" uuid NOT NULL,
	"received_by" uuid,
	"dispatched_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"notes" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transfer_order_items" ADD CONSTRAINT "transfer_order_items_transfer_order_id_transfer_orders_id_fk" FOREIGN KEY ("transfer_order_id") REFERENCES "public"."transfer_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_items" ADD CONSTRAINT "transfer_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_items" ADD CONSTRAINT "transfer_order_items_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_transfer_items_order" ON "transfer_order_items" USING btree ("transfer_order_id");--> statement-breakpoint
CREATE INDEX "idx_transfer_items_product" ON "transfer_order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_transfer_orders_from" ON "transfer_orders" USING btree ("from_warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_transfer_orders_to" ON "transfer_orders" USING btree ("to_warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_transfer_orders_status" ON "transfer_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_transfer_orders_initiated" ON "transfer_orders" USING btree ("initiated_by");--> statement-breakpoint
CREATE INDEX "idx_transfer_orders_created" ON "transfer_orders" USING btree ("created_at");