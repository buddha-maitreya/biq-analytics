-- Add external ID tracking columns for data connector sync reconciliation
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "external_id" varchar(255);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "external_source" varchar(100);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "supplier_name" varchar(255);
CREATE INDEX IF NOT EXISTS "idx_products_external_id" ON "products"("external_id");

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "external_id" varchar(255);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "external_source" varchar(100);
CREATE INDEX IF NOT EXISTS "idx_orders_external_id" ON "orders"("external_id");

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "external_id" varchar(255);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "external_source" varchar(100);
CREATE INDEX IF NOT EXISTS "idx_customers_external_id" ON "customers"("external_id");
