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

/** Order Items — line items within an order */
export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
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
    metadata: metadata(),
    ...timestamps(),
  },
  (t) => [
    index("idx_order_items_order").on(t.orderId),
    index("idx_order_items_product").on(t.productId),
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

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
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
