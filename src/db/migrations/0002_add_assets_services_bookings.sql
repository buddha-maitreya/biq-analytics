-- Migration: 0002_add_assets_services_bookings
-- Adds asset management, service catalog, and booking/scheduling tables.
-- Modifies products (is_consumable, is_sellable) and order_items (polymorphic).

-- ============================================================
-- 1. Modify existing tables
-- ============================================================

-- Products: add is_consumable / is_sellable flags
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "is_consumable" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_sellable"   boolean NOT NULL DEFAULT true;

-- Order Items: add polymorphic columns
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "item_type"    varchar(20) NOT NULL DEFAULT 'stock',
  ADD COLUMN IF NOT EXISTS "service_id"   uuid,
  ADD COLUMN IF NOT EXISTS "description"  text,
  ADD COLUMN IF NOT EXISTS "start_date"   timestamptz,
  ADD COLUMN IF NOT EXISTS "end_date"     timestamptz;

-- Make product_id nullable (was NOT NULL — existing rows keep their value)
ALTER TABLE "order_items"
  ALTER COLUMN "product_id" DROP NOT NULL;

-- Indexes for new order_items columns
CREATE INDEX IF NOT EXISTS "idx_order_items_service" ON "order_items" ("service_id");
CREATE INDEX IF NOT EXISTS "idx_order_items_type"    ON "order_items" ("item_type");

-- ============================================================
-- 2. Asset tables
-- ============================================================

CREATE TABLE IF NOT EXISTS "asset_categories" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       varchar(255) NOT NULL,
  "description" text,
  "metadata"   jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "assets" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_code"           varchar(50) NOT NULL UNIQUE,
  "name"                 varchar(255) NOT NULL,
  "category_id"          uuid NOT NULL REFERENCES "asset_categories"("id"),
  "purchase_date"        timestamptz,
  "purchase_cost"        numeric(12, 2),
  "current_value"        numeric(12, 2),
  "condition_status"     varchar(30) NOT NULL DEFAULT 'good',
  "location"             varchar(255),
  "assigned_to_staff_id" uuid REFERENCES "users"("id"),
  "notes"                text,
  "is_active"            boolean NOT NULL DEFAULT true,
  "metadata"             jsonb DEFAULT '{}'::jsonb,
  "created_at"           timestamptz DEFAULT now() NOT NULL,
  "updated_at"           timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_assets_category"  ON "assets" ("category_id");
CREATE INDEX IF NOT EXISTS "idx_assets_condition" ON "assets" ("condition_status");
CREATE INDEX IF NOT EXISTS "idx_assets_staff"     ON "assets" ("assigned_to_staff_id");
CREATE INDEX IF NOT EXISTS "idx_assets_active"    ON "assets" ("is_active");

-- ============================================================
-- 3. Service tables
-- ============================================================

CREATE TABLE IF NOT EXISTS "service_categories" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       varchar(255) NOT NULL,
  "examples"   text,
  "metadata"   jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "services" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "service_code"    varchar(50) NOT NULL UNIQUE,
  "name"            varchar(255) NOT NULL,
  "category_id"     uuid NOT NULL REFERENCES "service_categories"("id"),
  "description"     text,
  "base_price"      numeric(12, 2) NOT NULL,
  "pricing_model"   varchar(30) NOT NULL DEFAULT 'fixed',
  "capacity_limit"  integer,
  "requires_asset"  boolean NOT NULL DEFAULT false,
  "requires_stock"  boolean NOT NULL DEFAULT false,
  "is_active"       boolean NOT NULL DEFAULT true,
  "metadata"        jsonb DEFAULT '{}'::jsonb,
  "created_at"      timestamptz DEFAULT now() NOT NULL,
  "updated_at"      timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_services_category" ON "services" ("category_id");
CREATE INDEX IF NOT EXISTS "idx_services_pricing"  ON "services" ("pricing_model");
CREATE INDEX IF NOT EXISTS "idx_services_active"   ON "services" ("is_active");

-- FK from order_items.service_id → services.id (deferred because services didn't exist earlier)
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_service_id_services_id_fk"
  FOREIGN KEY ("service_id") REFERENCES "services"("id");

-- ============================================================
-- 4. Booking / scheduling tables
-- ============================================================

CREATE TABLE IF NOT EXISTS "service_bookings" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_item_id"        uuid NOT NULL REFERENCES "order_items"("id") ON DELETE CASCADE,
  "service_date"         timestamptz NOT NULL,
  "start_time"           timestamptz,
  "end_time"             timestamptz,
  "status"               varchar(30) NOT NULL DEFAULT 'scheduled',
  "assigned_guide_id"    uuid REFERENCES "users"("id"),
  "assigned_vehicle_id"  uuid REFERENCES "assets"("id"),
  "notes"                text,
  "metadata"             jsonb DEFAULT '{}'::jsonb,
  "created_at"           timestamptz DEFAULT now() NOT NULL,
  "updated_at"           timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_bookings_order_item" ON "service_bookings" ("order_item_id");
CREATE INDEX IF NOT EXISTS "idx_bookings_date"       ON "service_bookings" ("service_date");
CREATE INDEX IF NOT EXISTS "idx_bookings_status"     ON "service_bookings" ("status");
CREATE INDEX IF NOT EXISTS "idx_bookings_guide"      ON "service_bookings" ("assigned_guide_id");
CREATE INDEX IF NOT EXISTS "idx_bookings_vehicle"    ON "service_bookings" ("assigned_vehicle_id");

CREATE TABLE IF NOT EXISTS "booking_assets" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id"     uuid NOT NULL REFERENCES "service_bookings"("id") ON DELETE CASCADE,
  "asset_id"       uuid NOT NULL REFERENCES "assets"("id"),
  "assigned_from"  timestamptz NOT NULL,
  "assigned_until" timestamptz NOT NULL,
  "metadata"       jsonb DEFAULT '{}'::jsonb,
  "created_at"     timestamptz DEFAULT now() NOT NULL,
  "updated_at"     timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_booking_assets_booking" ON "booking_assets" ("booking_id");
CREATE INDEX IF NOT EXISTS "idx_booking_assets_asset"   ON "booking_assets" ("asset_id");
CREATE INDEX IF NOT EXISTS "idx_booking_assets_range"   ON "booking_assets" ("assigned_from", "assigned_until");

CREATE TABLE IF NOT EXISTS "booking_stock_allocations" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id"        uuid NOT NULL REFERENCES "service_bookings"("id") ON DELETE CASCADE,
  "stock_item_id"     uuid NOT NULL REFERENCES "products"("id"),
  "quantity_reserved" integer NOT NULL DEFAULT 0,
  "quantity_used"     integer NOT NULL DEFAULT 0,
  "metadata"          jsonb DEFAULT '{}'::jsonb,
  "created_at"        timestamptz DEFAULT now() NOT NULL,
  "updated_at"        timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_booking_stock_booking" ON "booking_stock_allocations" ("booking_id");
CREATE INDEX IF NOT EXISTS "idx_booking_stock_item"    ON "booking_stock_allocations" ("stock_item_id");
