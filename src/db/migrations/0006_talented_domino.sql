CREATE TABLE "product_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"from_warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid NOT NULL,
	"request_type" varchar(20) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"urgency" varchar(20) DEFAULT 'normal' NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"decider_id" uuid,
	"decided_at" timestamp with time zone,
	"decider_comment" text,
	"origin_search_term" varchar(500),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_search_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"search_term" varchar(500) NOT NULL,
	"warehouse_id" uuid,
	"category_filter" varchar(255),
	"result_count" integer DEFAULT 0 NOT NULL,
	"product_id_clicked" uuid,
	"search_duration_ms" integer,
	"source" varchar(50) DEFAULT 'products_page' NOT NULL,
	"device_type" varchar(30),
	"ip_address" varchar(45),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "primary_warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "location_type" varchar(100) DEFAULT 'warehouse' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_decider_id_users_id_fk" FOREIGN KEY ("decider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_search_log" ADD CONSTRAINT "product_search_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_search_log" ADD CONSTRAINT "product_search_log_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_search_log" ADD CONSTRAINT "product_search_log_product_id_clicked_products_id_fk" FOREIGN KEY ("product_id_clicked") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_requests_requester" ON "product_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "idx_product_requests_product" ON "product_requests" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_product_requests_from" ON "product_requests" USING btree ("from_warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_product_requests_to" ON "product_requests" USING btree ("to_warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_product_requests_type" ON "product_requests" USING btree ("request_type");--> statement-breakpoint
CREATE INDEX "idx_product_requests_status" ON "product_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_product_requests_created" ON "product_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_search_log_user" ON "product_search_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_search_log_warehouse" ON "product_search_log" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_search_log_term" ON "product_search_log" USING btree ("search_term");--> statement-breakpoint
CREATE INDEX "idx_search_log_product" ON "product_search_log" USING btree ("product_id_clicked");--> statement-breakpoint
CREATE INDEX "idx_search_log_source" ON "product_search_log" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_search_log_created" ON "product_search_log" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_primary_warehouse_id_warehouses_id_fk" FOREIGN KEY ("primary_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_primary_warehouse" ON "users" USING btree ("primary_warehouse_id");