CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_number" varchar(50) NOT NULL,
	"product_id" uuid,
	"sku" varchar(100) NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"category" varchar(255),
	"warehouse_id" uuid,
	"warehouse_name" varchar(255),
	"customer_id" uuid,
	"customer_name" varchar(255),
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'KES' NOT NULL,
	"payment_method" varchar(50),
	"sold_by" varchar(255),
	"sale_date" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sales_number" ON "sales" USING btree ("sale_number");--> statement-breakpoint
CREATE INDEX "idx_sales_product" ON "sales" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_sales_warehouse" ON "sales" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_sales_date" ON "sales" USING btree ("sale_date");--> statement-breakpoint
CREATE INDEX "idx_sales_sku" ON "sales" USING btree ("sku");