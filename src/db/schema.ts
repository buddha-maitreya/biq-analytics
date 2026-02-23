import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================
// BetterAuth Tables (@agentuity/auth)
// ============================================================
//
// These 9 tables are managed by @agentuity/auth (BetterAuth).
// Re-exported here so Drizzle migrations discover them alongside
// the application tables. Do NOT modify their column definitions —
// they must stay in sync with the BetterAuth schema.
//
// Tables: user, session, account, verification,
//         organization, member, invitation, jwks, apikey
//
export {
  user as authUser,
  session as authSession,
  account as authAccount,
  verification as authVerification,
  organization as authOrganization,
  member as authMember,
  invitation as authInvitation,
  jwks as authJwks,
  apikey as authApikey,
  userRelations as authUserRelations,
  sessionRelations as authSessionRelations,
  accountRelations as authAccountRelations,
  organizationRelations as authOrganizationRelations,
  memberRelations as authMemberRelations,
  invitationRelations as authInvitationRelations,
  apikeyRelations as authApikeyRelations,
} from "@agentuity/auth/schema";

// ============================================================
// Utility defaults
// ============================================================
const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
const metadata = () => jsonb("metadata").$type<Record<string, unknown>>();

// ============================================================
// Core Tables
// ============================================================

/** Categories — hierarchical product grouping */
export const categories = pgTable(
  "categories",
  {
    id: id(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    parentId: uuid("parent_id"),
    sortOrder: integer("sort_order").default(0),
    isActive: boolean("is_active").notNull().default(true),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_categories_parent").on(t.parentId),
    index("idx_categories_active").on(t.isActive),
  ]
);

/** Products — the core item being tracked */
export const products = pgTable(
  "products",
  {
    id: id(),
    sku: varchar("sku", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    categoryId: uuid("category_id").references(() => categories.id),
    unit: varchar("unit", { length: 50 }).notNull().default("piece"),
    price: numeric("price", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    costPrice: numeric("cost_price", { precision: 12, scale: 2 }).default("0"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 4 }),
    barcode: varchar("barcode", { length: 100 }),
    imageUrl: text("image_url"),
    /** Whether this item is consumed during operations (water, snacks, fuel) */
    isConsumable: boolean("is_consumable").notNull().default(false),
    /** Whether this item is sold to customers (merchandise, retail) */
    isSellable: boolean("is_sellable").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    minStockLevel: integer("min_stock_level").default(0),
    maxStockLevel: integer("max_stock_level"),
    reorderPoint: integer("reorder_point").default(0),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idx_products_sku").on(t.sku),
    index("idx_products_category").on(t.categoryId),
    index("idx_products_barcode").on(t.barcode),
    index("idx_products_active").on(t.isActive),
  ]
);

/** Warehouses / Locations — any physical or logical storage point in the supply chain */
export const warehouses = pgTable("warehouses", {
  id: id(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  /**
   * Business-configurable location type. NOT an enum — free-text so each
   * deployment defines its own terminology (warehouse, branch, kitchen,
   * production, manufacturing, dispatch, shop, cold_storage, etc.).
   */
  locationType: varchar("location_type", { length: 100 }).notNull().default("warehouse"),
  address: text("address"),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  /** Sort order for UI display */
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: metadata(),
  ...timestamps(),
});

/** Inventory — stock levels per product per warehouse */
export const inventory = pgTable(
  "inventory",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    quantity: integer("quantity").notNull().default(0),
    reservedQuantity: integer("reserved_quantity").notNull().default(0),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idx_inventory_product_warehouse").on(
      t.productId,
      t.warehouseId
    ),
  ]
);

/** Inventory Transactions — audit trail for stock changes */
export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    type: varchar("type", { length: 50 }).notNull(), // e.g. "receipt", "sale", "adjustment", "transfer", "scan_add", "scan_remove"
    quantity: integer("quantity").notNull(),
    referenceType: varchar("reference_type", { length: 50 }), // e.g. "order", "manual", "transfer", "scan"
    referenceId: uuid("reference_id"),
    /** Device source: web, mobile, scanner, api */
    deviceType: varchar("device_type", { length: 30 }),
    notes: text("notes"),
    performedBy: uuid("performed_by"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_inv_tx_product").on(t.productId),
    index("idx_inv_tx_warehouse").on(t.warehouseId),
    index("idx_inv_tx_type").on(t.type),
    index("idx_inv_tx_reference").on(t.referenceType, t.referenceId),
    index("idx_inv_tx_created").on(t.createdAt),
  ]
);

// ============================================================
// Scan Pipeline Tables
// ============================================================

/**
 * Scan Events — raw log of every barcode scan attempt.
 * Tracks scans even if the product doesn't exist, the scan fails, or
 * the user is offline. Enables audit trails, fraud detection, and
 * offline sync reconciliation.
 *
 * Every successful scan links to a stock transaction via linkedTransactionId.
 */
export const scanEvents = pgTable(
  "scan_events",
  {
    id: id(),
    /** Warehouse/branch where the scan occurred */
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    /** User who performed the scan */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Raw barcode/QR value scanned */
    barcode: varchar("barcode", { length: 255 }).notNull(),
    /** Device source: web, mobile, scanner, api */
    deviceType: varchar("device_type", { length: 30 }).notNull().default("web"),
    /** Scan outcome: success, failed (product not found), pending_sync (offline) */
    status: varchar("status", { length: 30 }).notNull().default("pending_sync"),
    /** FK to the stock transaction created by this scan (null if failed/pending) */
    linkedTransactionId: uuid("linked_transaction_id"),
    /** Resolved product ID (null if product lookup failed) */
    productId: uuid("product_id").references(() => products.id),
    /** Quantity scanned (defaults to 1) */
    quantity: integer("quantity").notNull().default(1),
    /** Scan type: scan_add (receiving) or scan_remove (selling/dispatching) */
    scanType: varchar("scan_type", { length: 30 }).notNull().default("scan_add"),
    /** Error message if scan failed */
    errorMessage: text("error_message"),
    /** Client-generated UUID to prevent duplicate sync (for offline mode) */
    idempotencyKey: varchar("idempotency_key", { length: 100 }),
    /** Raw request payload for debugging */
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    metadata: metadata(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_scan_events_warehouse").on(t.warehouseId),
    index("idx_scan_events_user").on(t.userId),
    index("idx_scan_events_barcode").on(t.barcode),
    index("idx_scan_events_status").on(t.status),
    index("idx_scan_events_product").on(t.productId),
    index("idx_scan_events_created").on(t.createdAt),
    uniqueIndex("idx_scan_events_idempotency").on(t.idempotencyKey),
  ]
);

/**
 * Idempotency Keys — prevents duplicate stock changes from retries,
 * network drops, double-taps, or offline sync replays.
 *
 * Each scan request includes a client-generated UUID. If a request with the
 * same key arrives again, we return the cached response instead of
 * re-processing the stock movement.
 *
 * Records are auto-cleaned after 24 hours (safe window for retries).
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: id(),
    /** Client-generated unique key per scan request */
    key: varchar("key", { length: 255 }).notNull(),
    /** Hash of the request body (to detect payload mismatches on same key) */
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    /** Cached response JSON to return for duplicate requests */
    responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>().notNull(),
    /** TTL — after this timestamp the key can be reused */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_idempotency_key").on(t.key),
    index("idx_idempotency_expires").on(t.expiresAt),
  ]
);

// ============================================================
// Inter-Branch Transfer Orders
// ============================================================

/**
 * Transfer Orders — scan-based inventory transfers between warehouses.
 *
 * Status flow:
 *   draft → dispatched → in_transit → received | completed_with_discrepancy
 *
 * Source stock is deducted on dispatch (transfer_out transactions).
 * Destination stock is credited only on acceptance (transfer_in transactions).
 */
export const transferOrders = pgTable(
  "transfer_orders",
  {
    id: id(),
    /** Source warehouse (stock leaves here) */
    fromWarehouseId: uuid("from_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    /** Destination warehouse (stock arrives here) */
    toWarehouseId: uuid("to_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    /** Current status */
    status: varchar("status", { length: 40 })
      .notNull()
      .default("draft"),
    /** How the destination accepts: scan, manual, or null (any) */
    acceptanceMode: varchar("acceptance_mode", { length: 20 }),
    /** User who initiated the transfer */
    initiatedBy: uuid("initiated_by")
      .notNull()
      .references(() => users.id),
    /** User who accepted/received at destination */
    receivedBy: uuid("received_by").references(() => users.id),
    /** When the transfer was dispatched */
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    /** When the transfer was received at destination */
    receivedAt: timestamp("received_at", { withTimezone: true }),
    /** Free-form notes (driver info, vehicle, ETA, etc.) */
    notes: text("notes"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_transfer_orders_from").on(t.fromWarehouseId),
    index("idx_transfer_orders_to").on(t.toWarehouseId),
    index("idx_transfer_orders_status").on(t.status),
    index("idx_transfer_orders_initiated").on(t.initiatedBy),
    index("idx_transfer_orders_created").on(t.createdAt),
  ]
);

/**
 * Transfer Order Items — individual products within a transfer.
 *
 * expectedQuantity = what was dispatched from source.
 * receivedQuantity = what was counted/scanned at destination (null until accepted).
 * Discrepancies are flagged when received ≠ expected.
 */
export const transferOrderItems = pgTable(
  "transfer_order_items",
  {
    id: id(),
    /** Parent transfer order */
    transferOrderId: uuid("transfer_order_id")
      .notNull()
      .references(() => transferOrders.id, { onDelete: "cascade" }),
    /** Product being transferred */
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    /** Quantity dispatched from source */
    expectedQuantity: integer("expected_quantity").notNull(),
    /** Quantity actually dispatched (may differ if partial dispatch) */
    dispatchedQuantity: integer("dispatched_quantity").notNull(),
    /** Quantity received at destination (null until acceptance) */
    receivedQuantity: integer("received_quantity"),
    /** Reason for discrepancy (if any) */
    discrepancyReason: varchar("discrepancy_reason", { length: 30 }),
    /** Free-text note about discrepancy */
    discrepancyNote: text("discrepancy_note"),
    /** When this item was accepted at destination */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** Who accepted this item */
    acceptedBy: uuid("accepted_by").references(() => users.id),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_transfer_items_order").on(t.transferOrderId),
    index("idx_transfer_items_product").on(t.productId),
  ]
);

// ============================================================
// Sales Tables
// ============================================================

/** Sales — individual product-level sale transactions (distinct from grouped orders) */
export const sales = pgTable(
  "sales",
  {
    id: id(),
    saleNumber: varchar("sale_number", { length: 50 }).notNull(),
    /** FK to the product sold */
    productId: uuid("product_id").references(() => products.id),
    /** Denormalized for fast display */
    sku: varchar("sku", { length: 100 }).notNull(),
    productName: varchar("product_name", { length: 255 }).notNull(),
    category: varchar("category", { length: 255 }),
    /** Branch / location where sale occurred */
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    warehouseName: varchar("warehouse_name", { length: 255 }),
    /** Customer who purchased (optional — walk-ins have null) */
    customerId: uuid("customer_id").references(() => customers.id),
    customerName: varchar("customer_name", { length: 255 }),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    /** Total = quantity × unitPrice */
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull().default("KES"),
    /** Payment method: cash, mpesa, card, etc. */
    paymentMethod: varchar("payment_method", { length: 50 }),
    /** Sales person / cashier name */
    soldBy: varchar("sold_by", { length: 255 }),
    /** Date/time of sale */
    saleDate: timestamp("sale_date", { withTimezone: true }).notNull().defaultNow(),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idx_sales_number").on(t.saleNumber),
    index("idx_sales_product").on(t.productId),
    index("idx_sales_warehouse").on(t.warehouseId),
    index("idx_sales_date").on(t.saleDate),
    index("idx_sales_sku").on(t.sku),
  ]
);

/** Customers */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    address: text("address"),
    taxId: varchar("tax_id", { length: 100 }),
    isActive: boolean("is_active").notNull().default(true),
    creditLimit: numeric("credit_limit", { precision: 12, scale: 2 }),
    balance: numeric("balance", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_customers_email").on(t.email),
    index("idx_customers_active").on(t.isActive),
  ]
);

/** Order statuses — configurable per deployment */
export const orderStatuses = pgTable("order_statuses", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  color: varchar("color", { length: 20 }),
  sortOrder: integer("sort_order").default(0),
  isFinal: boolean("is_final").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  metadata: metadata(),
  ...timestamps(),
});

/** Orders */
export const orders = pgTable(
  "orders",
  {
    id: id(),
    orderNumber: varchar("order_number", { length: 50 }).notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    statusId: uuid("status_id").references(() => orderStatuses.id),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    notes: text("notes"),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    /** Payment method used: cash, card, card_pdq, mpesa, bank_transfer, etc. */
    paymentMethod: varchar("payment_method", { length: 50 }),
    /** External reference: PDQ approval code, M-Pesa receipt, Paystack ref, etc. */
    paymentReference: varchar("payment_reference", { length: 255 }),
    /** Payment status: pending, paid, partial, refunded */
    paymentStatus: varchar("payment_status", { length: 50 }).notNull().default("pending"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idx_orders_number").on(t.orderNumber),
    index("idx_orders_customer").on(t.customerId),
    index("idx_orders_status").on(t.statusId),
    index("idx_orders_created").on(t.createdAt),
  ]
);

/** Order Items — polymorphic line items (stock products OR services) */
export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Line item type: 'stock' for physical products, 'service' for bookable services */
    itemType: varchar("item_type", { length: 20 }).notNull().default("stock"),
    /** FK to products — set when itemType = 'stock' */
    productId: uuid("product_id")
      .references(() => products.id),
    /** FK to services — set when itemType = 'service' */
    serviceId: uuid("service_id"),
    /** Human-readable description (auto-filled from product/service name) */
    description: text("description"),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    taxRate: numeric("tax_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    /** Booking start date (for service line items) */
    startDate: timestamp("start_date", { withTimezone: true }),
    /** Booking end date (for service line items) */
    endDate: timestamp("end_date", { withTimezone: true }),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_order_items_order").on(t.orderId),
    index("idx_order_items_product").on(t.productId),
    index("idx_order_items_service").on(t.serviceId),
    index("idx_order_items_type").on(t.itemType),
  ]
);

/** Invoices */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    invoiceNumber: varchar("invoice_number", { length: 50 }).notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    customerId: uuid("customer_id").references(() => customers.id),
    status: varchar("status", { length: 50 }).notNull().default("draft"), // draft, sent, paid, overdue, cancelled
    subtotal: numeric("subtotal", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** KRA eTIMS compliance fields */
    kraVerified: boolean("kra_verified").notNull().default(false),
    kraVerifiedAt: timestamp("kra_verified_at", { withTimezone: true }),
    kraInvoiceNumber: varchar("kra_invoice_number", { length: 100 }),
    notes: text("notes"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idx_invoices_number").on(t.invoiceNumber),
    index("idx_invoices_order").on(t.orderId),
    index("idx_invoices_customer").on(t.customerId),
    index("idx_invoices_status").on(t.status),
    index("idx_invoices_due").on(t.dueDate),
  ]
);

/** Payments */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    method: varchar("method", { length: 50 }).notNull(), // cash, card, bank_transfer, etc.
    reference: varchar("reference", { length: 255 }),
    notes: text("notes"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_payments_invoice").on(t.invoiceId),
    index("idx_payments_method").on(t.method),
  ]
);

// ============================================================
// System Tables
// ============================================================

/** Users — authentication & RBAC
 *  Role hierarchy: super_admin > admin > manager > staff > viewer
 *  - super_admin: Business owner. Manages admins + warehouse access. Full system access.
 *  - admin: Manages staff/managers/viewers. Assigns permissions & warehouse access.
 *  - manager: Mid-level ops. Permissions assigned by admin.
 *  - staff: POS + limited access. Permissions assigned by admin.
 *  - viewer: Read-only access.
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    role: varchar("role", { length: 50 }).notNull().default("staff"),
    hashedPassword: text("hashed_password"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Granular permissions: ["dashboard","products","orders","customers","inventory","invoices","reports","pos","admin","settings"] */
    permissions: jsonb("permissions").$type<string[]>().default([]),
    /** The user's home location — where they physically work. null for org-wide roles. */
    primaryWarehouseId: uuid("primary_warehouse_id").references(() => warehouses.id),
    /** Warehouse/branch IDs this user can access. null = all warehouses. */
    assignedWarehouses: jsonb("assigned_warehouses").$type<string[]>(),
    /** UUID of the user who created/invited this user (for hierarchy enforcement) */
    createdBy: uuid("created_by"),
    /** UUID of the user's direct supervisor/manager (approval hierarchy) */
    reportsTo: uuid("reports_to"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idx_users_email").on(t.email),
    index("idx_users_role").on(t.role),
    index("idx_users_active").on(t.isActive),
    index("idx_users_primary_warehouse").on(t.primaryWarehouseId),
    index("idx_users_reports_to").on(t.reportsTo),
  ]
);

/** Audit Log — system-wide event tracking */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: uuid("entity_id"),
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    ipAddress: varchar("ip_address", { length: 45 }),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_audit_user").on(t.userId),
    index("idx_audit_entity").on(t.entityType, t.entityId),
    index("idx_audit_action").on(t.action),
    index("idx_audit_created").on(t.createdAt),
  ]
);

/** Notifications */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    type: varchar("type", { length: 50 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message"),
    isRead: boolean("is_read").notNull().default(false),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_notifications_user").on(t.userId),
    index("idx_notifications_read").on(t.isRead),
  ]
);

// ============================================================
// Config Tables
// ============================================================

/** Business Settings — editable from the UI (name, logo, labels, etc.) */
export const businessSettings = pgTable("business_settings", {
  id: id(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull().default(""),
  ...timestamps(),
});

/** Tax Rules — configurable tax logic */
export const taxRules = pgTable("tax_rules", {
  id: id(),
  name: varchar("name", { length: 255 }).notNull(),
  rate: numeric("rate", { precision: 5, scale: 4 }).notNull(),
  appliesTo: varchar("applies_to", { length: 50 }), // "product", "category", "all"
  referenceId: uuid("reference_id"), // product or category id when scoped
  isDefault: boolean("is_default").notNull().default(false),
  metadata: metadata(),
  ...timestamps(),
});

/**
 * Custom Tools — user-defined tools executed by the AI agent at runtime.
 *
 * Four tool types (aligned with ElevenLabs Agents taxonomy):
 *  1. **server**  — External API calls (HTTP/REST). Configured with URL, method, headers, auth, path/query/body params.
 *  2. **client**  — Browser-side execution. Emits a structured action to the frontend via SSE.
 *  3. **system**  — Built-in tools (query_database, analyze_trends, etc.). Not stored here — defined in agent code.
 *  4. **mcp**     — Model Context Protocol servers (future). Reserved for MCP tool integrations.
 *
 * Only **server** and **client** tools are user-configurable via the Settings UI.
 */
export const customTools = pgTable(
  "custom_tools",
  {
    id: id(),
    /** Tool type: server (HTTP/API call), client (browser UI action), system (built-in), mcp (future) */
    toolType: varchar("tool_type", { length: 20 }).notNull().default("server"),
    /** Unique tool name (snake_case, used as the AI tool key) */
    name: varchar("name", { length: 100 }).notNull().unique(),
    /** Human-readable label shown in the UI */
    label: varchar("label", { length: 255 }).notNull(),
    /** Description for the LLM — tells the AI when/why to invoke this tool */
    description: text("description").notNull(),
    /**
     * JSON schema for tool parameters.
     * Stored as a JSON object describing the expected input, e.g.:
     * { "query": { "type": "string", "description": "Search term" } }
     * The agent converts this to Zod at runtime.
     */
    parameterSchema: jsonb("parameter_schema").notNull().default({}),

    // ── Server tool fields (HTTP/API) ───────────────────────
    /** URL to call when the tool is invoked. Required for server tools. */
    webhookUrl: text("webhook_url").default(""),
    /** HTTP method: GET (default), POST, PUT, DELETE, PATCH */
    webhookMethod: varchar("webhook_method", { length: 10 }).default("GET"),
    /** Custom headers as JSON object, e.g. { "Authorization": "Bearer xxx" }. */
    webhookHeaders: jsonb("webhook_headers").$type<Record<string, string>>().default({}),
    /** Response timeout in seconds for server tool HTTP calls */
    webhookTimeoutSecs: integer("webhook_timeout_secs").default(20),
    /** Authentication type: none, api_key, bearer, basic, oauth2 */
    authType: varchar("auth_type", { length: 20 }).default("none"),
    /** Authentication config (api key value, bearer token, basic user/pass, oauth client creds, etc.) */
    authConfig: jsonb("auth_config").$type<Record<string, string>>().default({}),
    /** Path parameter definitions — array of { name, description, required, default } */
    pathParamsSchema: jsonb("path_params_schema").$type<Array<Record<string, unknown>>>().default([]),
    /** Query parameter definitions — array of { name, description, required, default } */
    queryParamsSchema: jsonb("query_params_schema").$type<Array<Record<string, unknown>>>().default([]),
    /** Request body JSON schema for POST/PUT/PATCH webhooks */
    requestBodySchema: jsonb("request_body_schema").$type<Record<string, unknown>>().default({}),

    // ── Client-specific fields ──────────────────────────────
    /** Whether the tool expects a response from the client before continuing.
     * If false, the AI fires-and-forgets the UI action.
     * Only used when toolType = "client".
     */
    expectsResponse: boolean("expects_response").default(false),

    // ── Shared behaviour fields (server + client) ─────────
    /** Disable AI from speaking/streaming while this tool executes */
    disableInterruptions: boolean("disable_interruptions").default(false),
    /** Pre-tool speech mode: "auto" (AI decides), "custom" (use preToolSpeechText), "none" */
    preToolSpeech: varchar("pre_tool_speech", { length: 20 }).default("auto"),
    /** Custom text the AI says before invoking this tool (when preToolSpeech = "custom") */
    preToolSpeechText: text("pre_tool_speech_text").default(""),
    /** Execution mode: "immediate" (run right away) or "confirm" (ask user first) */
    executionMode: varchar("execution_mode", { length: 20 }).default("immediate"),
    /** Optional sound effect identifier played when tool is invoked */
    toolCallSound: varchar("tool_call_sound", { length: 100 }).default("none"),
    /** Dynamic variables — JSON object of template vars available in URL/body/headers, e.g. { "user_id": "string" } */
    dynamicVariables: jsonb("dynamic_variables").$type<Record<string, unknown>>().default({}),
    /** Dynamic variable assignments — how to populate dynamic vars at runtime, e.g. [{ var: "user_id", source: "session.userId" }] */
    dynamicVariableAssignments: jsonb("dynamic_variable_assignments").$type<Array<Record<string, unknown>>>().default([]),

    // ── Common fields ───────────────────────────────────────
    /** Whether this tool is active and available to the AI agent */
    isActive: boolean("is_active").notNull().default(true),
    /** Display order in the UI */
    sortOrder: integer("sort_order").notNull().default(0),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_custom_tools_active").on(t.isActive),
    index("idx_custom_tools_name").on(t.name),
    index("idx_custom_tools_type").on(t.toolType),
  ]
);

// ============================================================
// Asset Tables — long-term reusable equipment & resources
// ============================================================

/** Asset Categories — groups assets (vehicles, camping gear, electronics, etc.) */
export const assetCategories = pgTable("asset_categories", {
  id: id(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  metadata: metadata(),
  ...timestamps(),
});

/** Assets — durable, reusable equipment assigned to operations */
export const assets = pgTable(
  "assets",
  {
    id: id(),
    /** Unique internal code (e.g., VEH-001, TENT-012) */
    assetCode: varchar("asset_code", { length: 50 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => assetCategories.id),
    purchaseDate: timestamp("purchase_date", { withTimezone: true }),
    purchaseCost: numeric("purchase_cost", { precision: 12, scale: 2 }),
    /** Estimated current value (for depreciation tracking) */
    currentValue: numeric("current_value", { precision: 12, scale: 2 }),
    /** Condition: excellent | good | fair | needs_repair | decommissioned */
    conditionStatus: varchar("condition_status", { length: 30 })
      .notNull()
      .default("good"),
    /** Physical location or warehouse */
    location: varchar("location", { length: 255 }),
    /** Staff member currently responsible for this asset */
    assignedToStaffId: uuid("assigned_to_staff_id").references(() => users.id),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_assets_category").on(t.categoryId),
    index("idx_assets_condition").on(t.conditionStatus),
    index("idx_assets_staff").on(t.assignedToStaffId),
    index("idx_assets_active").on(t.isActive),
  ]
);

// ============================================================
// Service Tables — bookable offerings & scheduling
// ============================================================

/** Service Categories — groups services (transport, tours, activities, etc.) */
export const serviceCategories = pgTable("service_categories", {
  id: id(),
  name: varchar("name", { length: 255 }).notNull(),
  /** Example services in this category for reference */
  examples: text("examples"),
  metadata: metadata(),
  ...timestamps(),
});

/** Services — bookable offerings with pricing & capacity */
export const services = pgTable(
  "services",
  {
    id: id(),
    /** Unique internal code (e.g., SVC-GD-001) */
    serviceCode: varchar("service_code", { length: 50 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => serviceCategories.id),
    description: text("description"),
    /** Default price (interpretation depends on pricingModel) */
    basePrice: numeric("base_price", { precision: 12, scale: 2 }).notNull(),
    /** How this service is priced: per_person | per_day | fixed | tiered */
    pricingModel: varchar("pricing_model", { length: 30 })
      .notNull()
      .default("fixed"),
    /** Max concurrent participants / units (null = unlimited) */
    capacityLimit: integer("capacity_limit"),
    /** Does this service need asset allocation? (vehicles, tents, etc.) */
    requiresAsset: boolean("requires_asset").notNull().default(false),
    /** Does this service need stock allocation? (water, snacks, fuel, etc.) */
    requiresStock: boolean("requires_stock").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_services_category").on(t.categoryId),
    index("idx_services_pricing").on(t.pricingModel),
    index("idx_services_active").on(t.isActive),
  ]
);

// ============================================================
// Booking Tables — operational scheduling & resource allocation
// ============================================================

/** Service Bookings — operational scheduling for a service order line */
export const serviceBookings = pgTable(
  "service_bookings",
  {
    id: id(),
    /** The order line item this booking fulfils */
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    serviceDate: timestamp("service_date", { withTimezone: true }).notNull(),
    startTime: timestamp("start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),
    /** Booking status: scheduled | in_progress | completed | cancelled */
    status: varchar("status", { length: 30 }).notNull().default("scheduled"),
    /** Guide / operator assigned */
    assignedGuideId: uuid("assigned_guide_id").references(() => users.id),
    /** Vehicle or primary asset (convenience FK — detailed allocation in booking_assets) */
    assignedVehicleId: uuid("assigned_vehicle_id").references(() => assets.id),
    notes: text("notes"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_bookings_order_item").on(t.orderItemId),
    index("idx_bookings_date").on(t.serviceDate),
    index("idx_bookings_status").on(t.status),
    index("idx_bookings_guide").on(t.assignedGuideId),
    index("idx_bookings_vehicle").on(t.assignedVehicleId),
  ]
);

/** Booking Assets — which assets are allocated to a booking */
export const bookingAssets = pgTable(
  "booking_assets",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => serviceBookings.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    assignedFrom: timestamp("assigned_from", { withTimezone: true }).notNull(),
    assignedUntil: timestamp("assigned_until", { withTimezone: true }).notNull(),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_booking_assets_booking").on(t.bookingId),
    index("idx_booking_assets_asset").on(t.assetId),
    index("idx_booking_assets_range").on(t.assignedFrom, t.assignedUntil),
  ]
);

/** Booking Stock Allocations — consumable stock reserved / used for a booking */
export const bookingStockAllocations = pgTable(
  "booking_stock_allocations",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => serviceBookings.id, { onDelete: "cascade" }),
    /** FK to products (stock item) */
    stockItemId: uuid("stock_item_id")
      .notNull()
      .references(() => products.id),
    quantityReserved: integer("quantity_reserved").notNull().default(0),
    quantityUsed: integer("quantity_used").notNull().default(0),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_booking_stock_booking").on(t.bookingId),
    index("idx_booking_stock_item").on(t.stockItemId),
  ]
);

// ============================================================
// Chat Tables (Phase 8 — Intelligent Business Chatbot)
// ============================================================

/** Chat Sessions — one conversation thread per user session */
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    title: varchar("title", { length: 200 }),
    status: varchar("status", { length: 20 }).notNull().default("active"), // active | archived
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_chat_sessions_user").on(t.userId),
    index("idx_chat_sessions_status").on(t.status),
    index("idx_chat_sessions_updated").on(t.updatedAt),
  ]
);

/** Chat Messages — individual messages within a session */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(), // user | assistant | tool | system
    content: text("content"),
    toolCalls: jsonb("tool_calls"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_chat_messages_session").on(t.sessionId),
    index("idx_chat_messages_role").on(t.role),
    index("idx_chat_messages_created").on(t.createdAt),
  ]
);

// ============================================================
// Agent Configuration Tables
// ============================================================

/** Agent Configs — per-agent settings configurable from the Admin Console.
 *
 *  Each row configures one AI agent (The Brain, The Analyst, The Writer,
 *  The Librarian). Universal columns cover model, temperature, steps,
 *  timeout, and custom instructions. The `config` JSONB holds agent-specific
 *  settings (sandbox limits, topK, report format, etc.) without schema changes.
 */
export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: id(),
    /** Machine identifier — matches the agent folder name: data-science, insights-analyzer, etc. */
    agentName: varchar("agent_name", { length: 50 }).notNull().unique(),
    /** Human-friendly label shown in the admin UI */
    displayName: varchar("display_name", { length: 100 }).notNull(),
    /** What this agent does — shown as help text in admin */
    description: text("description"),
    /** Enable / disable this agent. Disabled agents are skipped by the orchestrator. */
    isActive: boolean("is_active").notNull().default(true),
    /** Override the default LLM model for this agent (e.g. gpt-4o-mini, claude-3-haiku) */
    modelOverride: varchar("model_override", { length: 100 }),
    /** LLM temperature (0.00 = deterministic, 2.00 = very creative). Null = use system default. */
    temperature: numeric("temperature", { precision: 3, scale: 2 }),
    /** Maximum tool-calling rounds per request. Null = use agent default. */
    maxSteps: integer("max_steps"),
    /** Execution timeout in milliseconds. Null = use agent default. */
    timeoutMs: integer("timeout_ms"),
    /** Business-specific instructions appended to the agent's system prompt.
     *  Use this to customize agent behavior per-deployment without code changes. */
    customInstructions: text("custom_instructions"),
    /** Routing priority — lower numbers are tried first by the orchestrator (0 = highest). */
    executionPriority: integer("execution_priority").notNull().default(0),
    /** Agent-specific settings (JSONB).
     *  Examples:
     *    The Analyst: { "structuringModel": "gpt-4o-mini", "sandboxMemoryMb": 256, "sandboxTimeoutMs": 30000 }
     *    The Writer:  { "defaultFormat": "markdown", "maxSqlSteps": 6 }
     *    The Librarian: { "topK": 5, "similarityThreshold": 0.7 }
     *    The Brain: { "enableSandbox": true, "compressionThreshold": 20 }
     */
    config: jsonb("config").$type<Record<string, unknown>>(),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_agent_configs_name").on(t.agentName),
    index("idx_agent_configs_active").on(t.isActive),
    index("idx_agent_configs_priority").on(t.executionPriority),
  ]
);

// ============================================================
// Relations
// ============================================================

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "categoryParent",
  }),
  children: many(categories, { relationName: "categoryParent" }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  inventory: many(inventory),
  inventoryTransactions: many(inventoryTransactions),
  orderItems: many(orderItems),
  bookingStockAllocations: many(bookingStockAllocations),
}));

export const warehousesRelations = relations(warehouses, ({ many }) => ({
  inventory: many(inventory),
  inventoryTransactions: many(inventoryTransactions),
  orders: many(orders),
}));

export const inventoryRelations = relations(inventory, ({ one }) => ({
  product: one(products, {
    fields: [inventory.productId],
    references: [products.id],
  }),
  warehouse: one(warehouses, {
    fields: [inventory.warehouseId],
    references: [warehouses.id],
  }),
}));

export const inventoryTransactionsRelations = relations(
  inventoryTransactions,
  ({ one }) => ({
    product: one(products, {
      fields: [inventoryTransactions.productId],
      references: [products.id],
    }),
    warehouse: one(warehouses, {
      fields: [inventoryTransactions.warehouseId],
      references: [warehouses.id],
    }),
  })
);

export const scanEventsRelations = relations(scanEvents, ({ one }) => ({
  warehouse: one(warehouses, {
    fields: [scanEvents.warehouseId],
    references: [warehouses.id],
  }),
  user: one(users, {
    fields: [scanEvents.userId],
    references: [users.id],
  }),
  product: one(products, {
    fields: [scanEvents.productId],
    references: [products.id],
  }),
}));

// ── Transfer Order Relations ──

export const transferOrdersRelations = relations(transferOrders, ({ one, many }) => ({
  fromWarehouse: one(warehouses, {
    fields: [transferOrders.fromWarehouseId],
    references: [warehouses.id],
    relationName: "transfersOut",
  }),
  toWarehouse: one(warehouses, {
    fields: [transferOrders.toWarehouseId],
    references: [warehouses.id],
    relationName: "transfersIn",
  }),
  initiator: one(users, {
    fields: [transferOrders.initiatedBy],
    references: [users.id],
    relationName: "transferInitiator",
  }),
  receiver: one(users, {
    fields: [transferOrders.receivedBy],
    references: [users.id],
    relationName: "transferReceiver",
  }),
  items: many(transferOrderItems),
}));

export const transferOrderItemsRelations = relations(transferOrderItems, ({ one }) => ({
  transferOrder: one(transferOrders, {
    fields: [transferOrderItems.transferOrderId],
    references: [transferOrders.id],
  }),
  product: one(products, {
    fields: [transferOrderItems.productId],
    references: [products.id],
  }),
  acceptedByUser: one(users, {
    fields: [transferOrderItems.acceptedBy],
    references: [users.id],
  }),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
  invoices: many(invoices),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  status: one(orderStatuses, {
    fields: [orders.statusId],
    references: [orderStatuses.id],
  }),
  warehouse: one(warehouses, {
    fields: [orders.warehouseId],
    references: [warehouses.id],
  }),
  items: many(orderItems),
  invoices: many(invoices),
}));

export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
  service: one(services, {
    fields: [orderItems.serviceId],
    references: [services.id],
  }),
  serviceBookings: many(serviceBookings),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  order: one(orders, {
    fields: [invoices.orderId],
    references: [orders.id],
  }),
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id],
  }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, {
    fields: [payments.invoiceId],
    references: [invoices.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  primaryWarehouse: one(warehouses, {
    fields: [users.primaryWarehouseId],
    references: [warehouses.id],
  }),
  auditLogs: many(auditLog),
  notifications: many(notifications),
  chatSessions: many(chatSessions),
  assignedAssets: many(assets),
  guidedBookings: many(serviceBookings),
  uploadedIngestions: many(documentIngestions, { relationName: "ingestionUploader" }),
  reviewedIngestions: many(documentIngestions, { relationName: "ingestionReviewer" }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, {
    fields: [auditLog.userId],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

// ============================================================
// Asset & Service Relations
// ============================================================

export const assetCategoriesRelations = relations(assetCategories, ({ many }) => ({
  assets: many(assets),
}));

export const assetsRelations = relations(assets, ({ one, many }) => ({
  category: one(assetCategories, {
    fields: [assets.categoryId],
    references: [assetCategories.id],
  }),
  assignedTo: one(users, {
    fields: [assets.assignedToStaffId],
    references: [users.id],
  }),
  bookingAssets: many(bookingAssets),
  assignedBookings: many(serviceBookings),
}));

export const serviceCategoriesRelations = relations(serviceCategories, ({ many }) => ({
  services: many(services),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  category: one(serviceCategories, {
    fields: [services.categoryId],
    references: [serviceCategories.id],
  }),
  orderItems: many(orderItems),
}));

export const serviceBookingsRelations = relations(serviceBookings, ({ one, many }) => ({
  orderItem: one(orderItems, {
    fields: [serviceBookings.orderItemId],
    references: [orderItems.id],
  }),
  assignedGuide: one(users, {
    fields: [serviceBookings.assignedGuideId],
    references: [users.id],
  }),
  assignedVehicle: one(assets, {
    fields: [serviceBookings.assignedVehicleId],
    references: [assets.id],
  }),
  allocatedAssets: many(bookingAssets),
  stockAllocations: many(bookingStockAllocations),
}));

export const bookingAssetsRelations = relations(bookingAssets, ({ one }) => ({
  booking: one(serviceBookings, {
    fields: [bookingAssets.bookingId],
    references: [serviceBookings.id],
  }),
  asset: one(assets, {
    fields: [bookingAssets.assetId],
    references: [assets.id],
  }),
}));

export const bookingStockAllocationsRelations = relations(bookingStockAllocations, ({ one }) => ({
  booking: one(serviceBookings, {
    fields: [bookingStockAllocations.bookingId],
    references: [serviceBookings.id],
  }),
  stockItem: one(products, {
    fields: [bookingStockAllocations.stockItemId],
    references: [products.id],
  }),
}));

// ============================================================
// Chat Relations
// ============================================================

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [chatSessions.userId],
    references: [users.id],
  }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
}));

// ============================================================
// Saved Reports — durable report storage with versioning
// ============================================================

/** Saved Reports — persistently stored generated reports with version tracking */
export const savedReports = pgTable(
  "saved_reports",
  {
    id: id(),
    /** Report type slug (e.g. "sales-summary", "inventory-health", custom types) */
    reportType: varchar("report_type", { length: 100 }).notNull(),
    /** Report title */
    title: varchar("title", { length: 500 }).notNull(),
    /** Reporting period start */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    /** Reporting period end */
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** Output format: markdown, plain, csv, json, html */
    format: varchar("format", { length: 20 }).notNull().default("markdown"),
    /** The full report content */
    content: text("content").notNull(),
    /** Version number — auto-incremented per reportType+period combination */
    version: integer("version").notNull().default(1),
    /** User who triggered the report (null for scheduled/system reports) */
    generatedBy: uuid("generated_by").references(() => users.id, { onDelete: "set null" }),
    /** Whether this was generated by a scheduled task */
    isScheduled: boolean("is_scheduled").notNull().default(false),
    /** Extensible metadata (model used, token counts, generation time, etc.) */
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_saved_reports_type").on(t.reportType),
    index("idx_saved_reports_period").on(t.periodStart, t.periodEnd),
    index("idx_saved_reports_created").on(t.createdAt),
    index("idx_saved_reports_type_period").on(t.reportType, t.periodStart, t.periodEnd),
  ]
);

// ============================================================
// Prompt Templates — versioned, DB-managed prompt sections
// ============================================================

/** Prompt Templates — admin-editable prompt sections with version tracking */
export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: id(),
    /** Which agent this template belongs to (e.g. "data-science", "insights-analyzer", "*" for global) */
    agentName: varchar("agent_name", { length: 100 }).notNull(),
    /** Section key within the prompt (e.g. "role", "guardrails", "formatting", "terminology") */
    sectionKey: varchar("section_key", { length: 100 }).notNull(),
    /** The prompt template text (may contain {{LABEL}} placeholders) */
    template: text("template").notNull(),
    /** Version number — auto-incremented per agent+section combination */
    version: integer("version").notNull().default(1),
    /** Whether this version is the currently active one */
    isActive: boolean("is_active").notNull().default(true),
    /** User who created this version */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Optional notes about what changed in this version */
    changeNotes: text("change_notes"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_prompt_templates_agent").on(t.agentName),
    index("idx_prompt_templates_section").on(t.sectionKey),
    index("idx_prompt_templates_active").on(t.agentName, t.sectionKey, t.isActive),
  ]
);

// ============================================================
// Eval Results — evaluation run tracking
// ============================================================

/** Eval Results — tracks quality evaluation outcomes per agent response */
export const evalResults = pgTable(
  "eval_results",
  {
    id: id(),
    /** Agent that was evaluated */
    agentName: varchar("agent_name", { length: 100 }).notNull(),
    /** Eval name (e.g. "response-quality", "groundedness") */
    evalName: varchar("eval_name", { length: 100 }).notNull(),
    /** Whether the eval passed */
    passed: boolean("passed").notNull(),
    /** Score (0-1 range, optional) */
    score: numeric("score", { precision: 5, scale: 4 }),
    /** Human-readable reason for the result */
    reason: text("reason"),
    /** Session ID if triggered from a chat */
    sessionId: uuid("session_id"),
    /** Eval metadata (input summary, output summary, timing, etc.) */
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_eval_results_agent").on(t.agentName),
    index("idx_eval_results_eval").on(t.evalName),
    index("idx_eval_results_passed").on(t.passed),
    index("idx_eval_results_created").on(t.createdAt),
    index("idx_eval_results_agent_eval").on(t.agentName, t.evalName),
  ]
);

// ============================================================
// Routing Analytics — tracks orchestrator routing decisions
// ============================================================

/** Routing Analytics — logs which tools the orchestrator routes to */
export const routingAnalytics = pgTable(
  "routing_analytics",
  {
    id: id(),
    /** The chat session this routing decision belonged to */
    sessionId: uuid("session_id"),
    /** The user's original message (truncated) */
    userMessage: text("user_message").notNull(),
    /** Tool(s) selected by the orchestrator */
    toolsSelected: jsonb("tools_selected").$type<string[]>().notNull(),
    /** Execution strategy used (direct, parallel, sequential) */
    strategy: varchar("strategy", { length: 20 }),
    /** Whether user followed up with a corrective message (implicit negative feedback) */
    hadCorrection: boolean("had_correction").default(false),
    /** User's explicit feedback if any (thumbs up/down) */
    feedbackScore: integer("feedback_score"),
    /** Response latency in ms */
    latencyMs: integer("latency_ms"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_routing_analytics_session").on(t.sessionId),
    index("idx_routing_analytics_created").on(t.createdAt),
    index("idx_routing_analytics_tools").on(t.toolsSelected),
  ]
);

// ============================================================
// Few-Shot Examples — semantic example library for dynamic selection
// ============================================================

/** Few-Shot Examples — stored examples for dynamic prompt selection via vector similarity */
export const fewShotExamples = pgTable(
  "few_shot_examples",
  {
    id: id(),
    /** Which agent/type this example applies to (e.g. "data-science", "demand-forecast") */
    category: varchar("category", { length: 100 }).notNull(),
    /** Example user input */
    userInput: text("user_input").notNull(),
    /** Expected assistant behavior / ideal output */
    expectedBehavior: text("expected_behavior").notNull(),
    /** Whether this example is active */
    isActive: boolean("is_active").notNull().default(true),
    /** Sort order for manual prioritization */
    sortOrder: integer("sort_order").default(0),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_few_shot_category").on(t.category),
    index("idx_few_shot_active").on(t.isActive),
  ]
);

// ============================================================
// Scheduled Tasks — configurable automated jobs
// ============================================================

/** Schedules — defines recurring or one-shot scheduled tasks */
export const schedules = pgTable(
  "schedules",
  {
    id: id(),
    /** Human-readable name (e.g. "Daily Sales Report", "Low Stock Alert") */
    name: varchar("name", { length: 255 }).notNull(),
    /** Task type: report, insight, alert, cleanup, custom */
    taskType: varchar("task_type", { length: 50 }).notNull(),
    /** Cron expression (e.g. "0 8 * * *" = daily at 8 AM). Null for one-shot. */
    cronExpression: varchar("cron_expression", { length: 100 }),
    /** Task configuration — parameters for the scheduled action.
     *  Examples:
     *    report: { reportType: "sales-summary", periodDays: 7, format: "markdown" }
     *    insight: { analysisType: "anomaly-detection", timeframeDays: 30 }
     *    alert: { metric: "low-stock", threshold: 10 }
     *    cleanup: { target: "old-sessions", olderThanDays: 90 }
     */
    taskConfig: jsonb("task_config").$type<Record<string, unknown>>().notNull().default({}),
    /** Whether this schedule is active */
    isActive: boolean("is_active").notNull().default(true),
    /** Timezone for the cron expression (e.g. "Africa/Nairobi", "America/New_York") */
    timezone: varchar("timezone", { length: 100 }).default("UTC"),
    /** When this schedule last ran successfully */
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    /** When this schedule is next expected to run */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    /** Number of consecutive failures */
    failureCount: integer("failure_count").notNull().default(0),
    /** Max consecutive failures before auto-disabling (0 = never disable) */
    maxFailures: integer("max_failures").notNull().default(5),
    /** User who created this schedule */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_schedules_type").on(t.taskType),
    index("idx_schedules_active").on(t.isActive),
    index("idx_schedules_next_run").on(t.nextRunAt),
    index("idx_schedules_cron").on(t.cronExpression),
  ]
);

/** Schedule Executions — audit trail for every scheduled run */
export const scheduleExecutions = pgTable(
  "schedule_executions",
  {
    id: id(),
    /** FK to the schedule that triggered this execution */
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    /** Execution status: running, completed, failed, skipped */
    status: varchar("status", { length: 20 }).notNull().default("running"),
    /** When execution started */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** When execution finished (null if still running) */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Duration in milliseconds */
    durationMs: integer("duration_ms"),
    /** Result summary (e.g. report ID produced, alert count, rows cleaned) */
    result: jsonb("result").$type<Record<string, unknown>>(),
    /** Error message if failed */
    errorMessage: text("error_message"),
    /** Trigger source: cron, manual, api */
    triggerSource: varchar("trigger_source", { length: 20 }).notNull().default("cron"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_sched_exec_schedule").on(t.scheduleId),
    index("idx_sched_exec_status").on(t.status),
    index("idx_sched_exec_started").on(t.startedAt),
  ]
);

// Schedule Relations
export const schedulesRelations = relations(schedules, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [schedules.createdBy],
    references: [users.id],
  }),
  executions: many(scheduleExecutions),
}));

export const scheduleExecutionsRelations = relations(scheduleExecutions, ({ one }) => ({
  schedule: one(schedules, {
    fields: [scheduleExecutions.scheduleId],
    references: [schedules.id],
  }),
}));

// ============================================================
// Agent Telemetry — OpenTelemetry span tracking
// ============================================================

/** Agent Telemetry — records spans for agent invocations, LLM calls, tool executions */
export const agentTelemetry = pgTable(
  "agent_telemetry",
  {
    id: id(),
    /** Agent name (e.g. "data-science", "insights-analyzer") */
    agentName: varchar("agent_name", { length: 100 }).notNull(),
    /** Span type: "agent" | "llm" | "tool" | "sandbox" | "db_query" */
    spanType: varchar("span_type", { length: 30 }).notNull(),
    /** Span name (e.g. "generateText", "query_database", "run_analysis") */
    spanName: varchar("span_name", { length: 255 }).notNull(),
    /** Status: "ok" | "error" */
    status: varchar("status", { length: 20 }).notNull().default("ok"),
    /** Duration in milliseconds */
    durationMs: integer("duration_ms"),
    /** Chat session ID if from a conversation */
    sessionId: uuid("session_id"),
    /** Parent span ID for nested spans */
    parentSpanId: varchar("parent_span_id", { length: 100 }),
    /** Error message if status=error */
    errorMessage: text("error_message"),
    /** Span attributes (model, token counts, input size, etc.) */
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),
    /** When the span started */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index("idx_telemetry_agent").on(t.agentName),
    index("idx_telemetry_span_type").on(t.spanType),
    index("idx_telemetry_status").on(t.status),
    index("idx_telemetry_session").on(t.sessionId),
    index("idx_telemetry_started").on(t.startedAt),
    index("idx_telemetry_agent_type").on(t.agentName, t.spanType),
  ]
);

// ============================================================
// Tool Invocations — detailed tool usage analytics
// ============================================================

/** Tool Invocations — tracks every tool call with timing, success, and context */
export const toolInvocations = pgTable(
  "tool_invocations",
  {
    id: id(),
    /** The tool that was called (e.g. "query_database", "analyze_trends") */
    toolName: varchar("tool_name", { length: 255 }).notNull(),
    /** Agent that initiated the call */
    agentName: varchar("agent_name", { length: 100 }).notNull(),
    /** Status: "success" | "error" | "timeout" */
    status: varchar("status", { length: 20 }).notNull().default("success"),
    /** Duration in milliseconds */
    durationMs: integer("duration_ms"),
    /** Chat session ID */
    sessionId: uuid("session_id"),
    /** Input size in characters (truncated input for analysis, not full content) */
    inputSizeChars: integer("input_size_chars"),
    /** Output size in characters */
    outputSizeChars: integer("output_size_chars"),
    /** Error type if failed (e.g. "timeout", "auth", "generic") */
    errorType: varchar("error_type", { length: 50 }),
    /** Error message if failed */
    errorMessage: text("error_message"),
    /** Tool-specific attributes (SQL query length, sandbox runtime, report format, etc.) */
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    index("idx_tool_inv_tool").on(t.toolName),
    index("idx_tool_inv_agent").on(t.agentName),
    index("idx_tool_inv_status").on(t.status),
    index("idx_tool_inv_session").on(t.sessionId),
    index("idx_tool_inv_created").on(t.createdAt),
    index("idx_tool_inv_tool_status").on(t.toolName, t.status),
  ]
);

// ============================================================
// Webhook Sources & Events — persistent webhook configuration
// ============================================================

/** Webhook Sources — registered external webhook senders */
export const webhookSources = pgTable(
  "webhook_sources",
  {
    id: id(),
    /** Short identifier (e.g. "stripe", "mpesa", "shopify") */
    name: varchar("name", { length: 50 }).notNull(),
    /** HMAC secret for signature verification (env var name or raw value) */
    secret: text("secret"),
    /** Header name containing the HMAC signature */
    signatureHeader: varchar("signature_header", { length: 100 }).default("x-signature"),
    /** Hash algorithm for HMAC (sha256, sha1, etc.) */
    hashAlgorithm: varchar("hash_algorithm", { length: 20 }).default("sha256"),
    /** Agent or service to route the event to */
    handler: varchar("handler", { length: 100 }).notNull().default("data-science"),
    /** Whether to process synchronously or async */
    isAsync: boolean("is_async").notNull().default(true),
    /** Whether the source is active */
    isActive: boolean("is_active").notNull().default(true),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idx_webhook_sources_name").on(t.name),
    index("idx_webhook_sources_active").on(t.isActive),
  ]
);

/** Webhook Events — log of received webhook events */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    /** Source name (denormalized for fast queries) */
    source: varchar("source", { length: 50 }).notNull(),
    /** Processing status: accepted, rejected, error */
    status: varchar("status", { length: 20 }).notNull(),
    /** HTTP status code returned */
    statusCode: integer("status_code").notNull(),
    /** Handler that processed the event */
    handler: varchar("handler", { length: 100 }).notNull(),
    /** Processing duration in milliseconds */
    durationMs: integer("duration_ms"),
    /** Error message if status=error */
    errorMessage: text("error_message"),
    /** Event payload summary (first 1KB) */
    payloadPreview: text("payload_preview"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_webhook_events_source").on(t.source),
    index("idx_webhook_events_status").on(t.status),
    index("idx_webhook_events_created").on(t.createdAt),
  ]
);

// ============================================================
// Chat Attachments — file metadata for S3-stored attachments
// ============================================================

/** Attachments — metadata for files uploaded to chat sessions */
export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    /** Chat session this attachment belongs to */
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    /** Uploader user ID */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Original filename */
    filename: varchar("filename", { length: 255 }).notNull(),
    /** MIME content type */
    contentType: varchar("content_type", { length: 100 }).notNull(),
    /** File size in bytes */
    sizeBytes: integer("size_bytes").notNull(),
    /** S3 object key */
    s3Key: varchar("s3_key", { length: 500 }).notNull(),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_attachments_session").on(t.sessionId),
    index("idx_attachments_user").on(t.userId),
    index("idx_attachments_created").on(t.createdAt),
  ]
);

// ============================================================
// Document Ingestion System
// ============================================================

/**
 * Document Ingestions — tracks each scanned document through the
 * parse → dedup → stage → approve → commit pipeline.
 *
 * A single ingestion corresponds to one scanned document (invoice, stock
 * sheet, receipt). It holds the raw scanner output and the overall status
 * while its child rows (document_ingestion_items) hold per-line-item results.
 */
export const documentIngestions = pgTable(
  "document_ingestions",
  {
    id: id(),
    /** Scan mode used: invoice, stock-sheet, barcode */
    mode: varchar("mode", { length: 30 }).notNull(),
    /** Overall status: staged → pending_review → approved → committed | rejected */
    status: varchar("status", { length: 30 }).notNull().default("staged"),
    /** SHA-256 hash of the original file (first dedup layer) */
    documentHash: varchar("document_hash", { length: 64 }),
    /** External reference extracted from document (invoice number, PO number) */
    externalRef: varchar("external_ref", { length: 255 }),
    /** Source filename */
    sourceFilename: varchar("source_filename", { length: 255 }),
    /** Scanner confidence score (0-1) */
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    /** Raw text extracted by the scanner */
    rawText: text("raw_text"),
    /** Full structured JSON output from the scanner agent */
    scannerOutput: jsonb("scanner_output").$type<Record<string, unknown>>(),
    /** Number of line items extracted */
    itemCount: integer("item_count").notNull().default(0),
    /** User who uploaded / initiated the scan */
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    /** User who reviewed (approved/rejected) */
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    /** When the review happened */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Reviewer notes */
    reviewNotes: text("review_notes"),
    /** Linked approval request (if approval workflow exists for this action) */
    approvalRequestId: uuid("approval_request_id"),
    /** Linked chat attachment ID (traceability) */
    attachmentId: uuid("attachment_id"),
    /** Linked chat session ID */
    sessionId: uuid("session_id"),
    /** Warehouse context (for stock sheets) */
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_doc_ingestions_mode").on(t.mode),
    index("idx_doc_ingestions_status").on(t.status),
    index("idx_doc_ingestions_hash").on(t.documentHash),
    index("idx_doc_ingestions_extref").on(t.externalRef),
    index("idx_doc_ingestions_uploader").on(t.uploadedBy),
    index("idx_doc_ingestions_created").on(t.createdAt),
  ]
);

/**
 * Document Ingestion Items — per-line-item dedup results.
 *
 * Each row represents one item extracted from the scanned document,
 * with dedup resolution (matched product, match type, confidence).
 * The "action" field defines what happens on commit: create, update, skip.
 */
export const documentIngestionItems = pgTable(
  "document_ingestion_items",
  {
    id: id(),
    /** Parent ingestion */
    ingestionId: uuid("ingestion_id")
      .notNull()
      .references(() => documentIngestions.id, { onDelete: "cascade" }),
    /** Line order within the document */
    lineNumber: integer("line_number").notNull(),
    /** Raw name as extracted from document */
    rawName: varchar("raw_name", { length: 500 }),
    /** Raw SKU as extracted */
    rawSku: varchar("raw_sku", { length: 100 }),
    /** Raw barcode as extracted */
    rawBarcode: varchar("raw_barcode", { length: 100 }),
    /** Quantity from document */
    quantity: integer("quantity"),
    /** Unit of measure from document */
    unit: varchar("unit", { length: 50 }),
    /** Unit price from document */
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    /** Total price from document */
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }),
    /** Resolved action: create_product, update_inventory, update_price, skip, needs_review */
    action: varchar("action", { length: 30 }).notNull().default("needs_review"),
    /** Dedup match type: hash, external_ref, sku_exact, barcode_exact, name_fuzzy, none */
    matchType: varchar("match_type", { length: 30 }),
    /** Match confidence (0-1, 1 = exact) */
    matchConfidence: numeric("match_confidence", { precision: 3, scale: 2 }),
    /** Matched product ID (null if no match or new product) */
    matchedProductId: uuid("matched_product_id").references(() => products.id),
    /** Override: user can manually select a different product or action */
    userOverrideProductId: uuid("user_override_product_id").references(() => products.id),
    userOverrideAction: varchar("user_override_action", { length: 30 }),
    /** Full raw data from scanner for this line item */
    rawData: jsonb("raw_data").$type<Record<string, unknown>>(),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_doc_ingestion_items_parent").on(t.ingestionId),
    index("idx_doc_ingestion_items_product").on(t.matchedProductId),
    index("idx_doc_ingestion_items_action").on(t.action),
  ]
);

// ── Document Ingestion Relations ──

export const documentIngestionsRelations = relations(documentIngestions, ({ one, many }) => ({
  uploadedByUser: one(users, {
    fields: [documentIngestions.uploadedBy],
    references: [users.id],
    relationName: "ingestionUploader",
  }),
  reviewedByUser: one(users, {
    fields: [documentIngestions.reviewedBy],
    references: [users.id],
    relationName: "ingestionReviewer",
  }),
  warehouse: one(warehouses, {
    fields: [documentIngestions.warehouseId],
    references: [warehouses.id],
  }),
  items: many(documentIngestionItems),
}));

export const documentIngestionItemsRelations = relations(documentIngestionItems, ({ one }) => ({
  ingestion: one(documentIngestions, {
    fields: [documentIngestionItems.ingestionId],
    references: [documentIngestions.id],
  }),
  matchedProduct: one(products, {
    fields: [documentIngestionItems.matchedProductId],
    references: [products.id],
  }),
}));

// ============================================================
// Approval Workflow System
// ============================================================

/**
 * Approval Workflows — configurable approval chains for business actions.
 * Each workflow defines what action type requires approval and under what conditions.
 * Examples: inventory.delivery_request, inventory.adjustment, order.create
 */
export const approvalWorkflows = pgTable(
  "approval_workflows",
  {
    id: id(),
    /** Machine-readable action type: inventory.delivery_request, inventory.adjustment, order.create */
    actionType: varchar("action_type", { length: 100 }).notNull(),
    /** Human-readable name: "Inventory Delivery Request", "Stock Adjustment", "Large Order" */
    name: varchar("name", { length: 255 }).notNull(),
    /** Description of what this workflow covers */
    description: text("description"),
    /** Whether this workflow is active */
    isActive: boolean("is_active").notNull().default(true),
    /** Optional condition (JSON) — e.g. { "field": "amount", "operator": ">", "value": 50000 } */
    condition: jsonb("condition").$type<Record<string, unknown>>(),
    /** Number of approval steps required */
    stepCount: integer("step_count").notNull().default(1),
    /** Whether to auto-approve if the requester's role meets or exceeds the required level */
    autoApproveAboveRole: varchar("auto_approve_above_role", { length: 50 }),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idx_approval_workflows_action").on(t.actionType),
    index("idx_approval_workflows_active").on(t.isActive),
  ]
);

/**
 * Approval Steps — ordered steps within a workflow.
 * Each step specifies who must approve (by role level or specific user).
 */
export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: id(),
    /** Which workflow this step belongs to */
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => approvalWorkflows.id, { onDelete: "cascade" }),
    /** Step order (1 = first approver, 2 = second, etc.) */
    stepOrder: integer("step_order").notNull(),
    /** Role required to approve this step: staff, manager, admin, super_admin */
    approverRole: varchar("approver_role", { length: 50 }).notNull(),
    /** Optional: specific user ID required (overrides role-based routing) */
    approverUserId: uuid("approver_user_id").references(() => users.id),
    /** Label for this step: "Warehouse Manager Review", "Admin Final Approval" */
    label: varchar("label", { length: 255 }),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_approval_steps_workflow").on(t.workflowId),
    index("idx_approval_steps_order").on(t.workflowId, t.stepOrder),
  ]
);

/**
 * Approval Requests — pending/completed approval instances.
 * Created when a user performs an action that requires approval.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    /** Workflow that governs this request */
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => approvalWorkflows.id),
    /** Action type (denormalized for fast queries) */
    actionType: varchar("action_type", { length: 100 }).notNull(),
    /** User who initiated the action */
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    /** Current step in the approval chain (1-based) */
    currentStep: integer("current_step").notNull().default(1),
    /** Overall status: pending, approved, rejected, cancelled */
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    /** Reference to the entity being approved (order, inventory record, etc.) */
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    /** Entity ID (UUID of the order, inventory record, etc.) */
    entityId: uuid("entity_id").notNull(),
    /** Snapshot of the action data at request time (for audit) */
    actionData: jsonb("action_data").$type<Record<string, unknown>>(),
    /** Requester's note/reason */
    requesterNote: text("requester_note"),
    /** Warehouse/branch context (if applicable) */
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    /** Resolved at (final approval or rejection timestamp) */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_approval_requests_workflow").on(t.workflowId),
    index("idx_approval_requests_requester").on(t.requesterId),
    index("idx_approval_requests_status").on(t.status),
    index("idx_approval_requests_entity").on(t.entityType, t.entityId),
    index("idx_approval_requests_warehouse").on(t.warehouseId),
    index("idx_approval_requests_created").on(t.createdAt),
  ]
);

/**
 * Approval Decisions — individual approve/reject decisions per step.
 * One record per approver action on a specific request step.
 */
export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: id(),
    /** Which request this decision belongs to */
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    /** Which step this decision is for */
    stepId: uuid("step_id")
      .notNull()
      .references(() => approvalSteps.id),
    /** Which step number (denormalized) */
    stepOrder: integer("step_order").notNull(),
    /** User who made this decision */
    deciderId: uuid("decider_id")
      .notNull()
      .references(() => users.id),
    /** Decision: approved, rejected */
    decision: varchar("decision", { length: 20 }).notNull(),
    /** Approver's comment/reason */
    comment: text("comment"),
    /** Timestamp of the decision */
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_approval_decisions_request").on(t.requestId),
    index("idx_approval_decisions_step").on(t.stepId),
    index("idx_approval_decisions_decider").on(t.deciderId),
    index("idx_approval_decisions_decided").on(t.decidedAt),
  ]
);

// ============================================================
// Product Search Analytics
// ============================================================

/**
 * Product Search Log — captures every product search event for AI analytics.
 * Enables demand forecasting, cross-branch hoarding detection, and
 * inventory movement intelligence.
 */
export const productSearchLog = pgTable(
  "product_search_log",
  {
    id: id(),
    /** Who searched (null for unauthenticated / system searches) */
    userId: uuid("user_id").references(() => users.id),
    /** The raw search term entered */
    searchTerm: varchar("search_term", { length: 500 }).notNull(),
    /** Which warehouse/branch context the search was scoped to (null = all) */
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    /** Category filter active during search (null = all categories) */
    categoryFilter: varchar("category_filter", { length: 255 }),
    /** Number of results returned */
    resultCount: integer("result_count").notNull().default(0),
    /** Product clicked/selected from results (null if none clicked) */
    productIdClicked: uuid("product_id_clicked").references(() => products.id),
    /** Time taken to complete the search (ms) */
    searchDurationMs: integer("search_duration_ms"),
    /** Search source: products_page, scan_lookup, pos, api, agent */
    source: varchar("source", { length: 50 }).notNull().default("products_page"),
    /** Device/client info */
    deviceType: varchar("device_type", { length: 30 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_search_log_user").on(t.userId),
    index("idx_search_log_warehouse").on(t.warehouseId),
    index("idx_search_log_term").on(t.searchTerm),
    index("idx_search_log_product").on(t.productIdClicked),
    index("idx_search_log_source").on(t.source),
    index("idx_search_log_created").on(t.createdAt),
  ]
);

export const productSearchLogRelations = relations(productSearchLog, ({ one }) => ({
  user: one(users, {
    fields: [productSearchLog.userId],
    references: [users.id],
  }),
  warehouse: one(warehouses, {
    fields: [productSearchLog.warehouseId],
    references: [warehouses.id],
  }),
  productClicked: one(products, {
    fields: [productSearchLog.productIdClicked],
    references: [products.id],
  }),
}));

// ============================================================
// Cross-Branch Product Requests (Borrow / Request)
// ============================================================

/**
 * Product Requests — tracks when staff request or borrow inventory
 * from another location. "borrow" = from another branch,
 * "request" = from a warehouse. AI agents use this data for
 * demand forecasting, hoarding detection, and redistribution insights.
 */
export const productRequests = pgTable(
  "product_requests",
  {
    id: id(),
    /** Staff member who made the request */
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    /** Product being requested */
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    /** Branch/location of the requester (where they need the stock) */
    fromWarehouseId: uuid("from_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    /** Location that has the stock (source of the borrow/request) */
    toWarehouseId: uuid("to_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    /** "borrow" (branch→branch) or "request" (branch→warehouse) */
    requestType: varchar("request_type", { length: 20 }).notNull(),
    /** Quantity requested */
    quantity: integer("quantity").notNull().default(1),
    /** Urgency: low, normal, high, critical */
    urgency: varchar("urgency", { length: 20 }).notNull().default("normal"),
    /** Free-text reason/notes from staff */
    reason: text("reason"),
    /** Status: pending, approved, rejected, fulfilled, cancelled */
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    /** Who approved/rejected (null while pending) */
    deciderId: uuid("decider_id").references(() => users.id),
    /** When the decision was made */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Decider's comment */
    deciderComment: text("decider_comment"),
    /** Search term that led to this request (links to search analytics) */
    originSearchTerm: varchar("origin_search_term", { length: 500 }),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_product_requests_requester").on(t.requesterId),
    index("idx_product_requests_product").on(t.productId),
    index("idx_product_requests_from").on(t.fromWarehouseId),
    index("idx_product_requests_to").on(t.toWarehouseId),
    index("idx_product_requests_type").on(t.requestType),
    index("idx_product_requests_status").on(t.status),
    index("idx_product_requests_created").on(t.createdAt),
  ]
);

export const productRequestsRelations = relations(productRequests, ({ one }) => ({
  requester: one(users, {
    fields: [productRequests.requesterId],
    references: [users.id],
  }),
  product: one(products, {
    fields: [productRequests.productId],
    references: [products.id],
  }),
  fromWarehouse: one(warehouses, {
    fields: [productRequests.fromWarehouseId],
    references: [warehouses.id],
  }),
  toWarehouse: one(warehouses, {
    fields: [productRequests.toWarehouseId],
    references: [warehouses.id],
  }),
  decider: one(users, {
    fields: [productRequests.deciderId],
    references: [users.id],
  }),
}));
