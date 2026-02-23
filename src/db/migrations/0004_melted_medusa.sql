CREATE TABLE "document_ingestion_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingestion_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"raw_name" varchar(500),
	"raw_sku" varchar(100),
	"raw_barcode" varchar(100),
	"quantity" integer,
	"unit" varchar(50),
	"unit_price" numeric(12, 2),
	"total_price" numeric(12, 2),
	"action" varchar(30) DEFAULT 'needs_review' NOT NULL,
	"match_type" varchar(30),
	"match_confidence" numeric(3, 2),
	"matched_product_id" uuid,
	"user_override_product_id" uuid,
	"user_override_action" varchar(30),
	"raw_data" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_ingestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'staged' NOT NULL,
	"document_hash" varchar(64),
	"external_ref" varchar(255),
	"source_filename" varchar(255),
	"confidence" numeric(3, 2),
	"raw_text" text,
	"scanner_output" jsonb,
	"item_count" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"approval_request_id" uuid,
	"attachment_id" uuid,
	"session_id" uuid,
	"warehouse_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_ingestion_items" ADD CONSTRAINT "document_ingestion_items_ingestion_id_document_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."document_ingestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ingestion_items" ADD CONSTRAINT "document_ingestion_items_matched_product_id_products_id_fk" FOREIGN KEY ("matched_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ingestion_items" ADD CONSTRAINT "document_ingestion_items_user_override_product_id_products_id_fk" FOREIGN KEY ("user_override_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ingestions" ADD CONSTRAINT "document_ingestions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ingestions" ADD CONSTRAINT "document_ingestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ingestions" ADD CONSTRAINT "document_ingestions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_doc_ingestion_items_parent" ON "document_ingestion_items" USING btree ("ingestion_id");--> statement-breakpoint
CREATE INDEX "idx_doc_ingestion_items_product" ON "document_ingestion_items" USING btree ("matched_product_id");--> statement-breakpoint
CREATE INDEX "idx_doc_ingestion_items_action" ON "document_ingestion_items" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_doc_ingestions_mode" ON "document_ingestions" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "idx_doc_ingestions_status" ON "document_ingestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_doc_ingestions_hash" ON "document_ingestions" USING btree ("document_hash");--> statement-breakpoint
CREATE INDEX "idx_doc_ingestions_extref" ON "document_ingestions" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "idx_doc_ingestions_uploader" ON "document_ingestions" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "idx_doc_ingestions_created" ON "document_ingestions" USING btree ("created_at");