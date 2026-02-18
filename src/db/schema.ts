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

/** Warehouses — storage locations */
export const warehouses = pgTable("warehouses", {
  id: id(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  address: text("address"),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
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
    type: varchar("type", { length: 50 }).notNull(), // e.g. "receipt", "sale", "adjustment", "transfer"
    quantity: integer("quantity").notNull(),
    referenceType: varchar("reference_type", { length: 50 }), // e.g. "order", "manual", "transfer"
    referenceId: uuid("reference_id"),
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
// Sales Tables
// ============================================================

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
    /** Warehouse/branch IDs this user can access. null = all warehouses. */
    assignedWarehouses: jsonb("assigned_warehouses").$type<string[]>(),
    /** UUID of the user who created/invited this user (for hierarchy enforcement) */
    createdBy: uuid("created_by"),
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("idx_users_email").on(t.email),
    index("idx_users_role").on(t.role),
    index("idx_users_active").on(t.isActive),
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

export const usersRelations = relations(users, ({ many }) => ({
  auditLogs: many(auditLog),
  notifications: many(notifications),
  chatSessions: many(chatSessions),
  assignedAssets: many(assets),
  guidedBookings: many(serviceBookings),
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
