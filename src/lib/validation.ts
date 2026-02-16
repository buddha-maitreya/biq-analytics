import { z } from "zod";

/**
 * Shared Zod schemas used across agents and routes.
 * These are generic / industry-agnostic.
 */

// --- Common ---
export const uuidParam = z.string().uuid();

export const idParam = z.object({ id: uuidParam });

export const metadataSchema = z.record(z.unknown()).optional();

// --- Products ---
export const createProductSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  categoryId: uuidParam.optional(),
  unit: z.string().max(50).optional(),
  price: z.number().min(0),
  costPrice: z.number().min(0).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  barcode: z.string().max(100).optional(),
  imageUrl: z.string().url().optional(),
  minStockLevel: z.number().int().min(0).optional(),
  maxStockLevel: z.number().int().min(0).optional(),
  reorderPoint: z.number().int().min(0).optional(),
  metadata: metadataSchema,
});

export const updateProductSchema = createProductSchema.partial();

// --- Categories ---
export const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  parentId: uuidParam.optional(),
  sortOrder: z.number().int().optional(),
  metadata: metadataSchema,
});

export const updateCategorySchema = createCategorySchema.partial();

// --- Customers ---
export const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  address: z.string().optional(),
  taxId: z.string().max(100).optional(),
  creditLimit: z.number().min(0).optional(),
  metadata: metadataSchema,
});

export const updateCustomerSchema = createCustomerSchema.partial();

// --- Orders ---
export const createOrderItemSchema = z.object({
  productId: uuidParam,
  quantity: z.number().int().min(1),
  unitPrice: z.number().min(0).optional(), // defaults to product price
  discountAmount: z.number().min(0).optional(),
  metadata: metadataSchema,
});

export const createOrderSchema = z.object({
  customerId: uuidParam.optional(),
  warehouseId: uuidParam.optional(),
  items: z.array(createOrderItemSchema).min(1),
  notes: z.string().optional(),
  metadata: metadataSchema,
});

export const updateOrderStatusSchema = z.object({
  statusId: uuidParam,
  notes: z.string().optional(),
});

// --- Warehouses ---
export const createWarehouseSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  address: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: metadataSchema,
});

export const updateWarehouseSchema = createWarehouseSchema.partial();

// --- Inventory ---
export const adjustInventorySchema = z.object({
  productId: uuidParam,
  warehouseId: uuidParam,
  quantity: z.number().int(), // positive = add, negative = remove
  type: z.string().min(1).max(50),
  notes: z.string().optional(),
  metadata: metadataSchema,
});

export const transferInventorySchema = z.object({
  productId: uuidParam,
  fromWarehouseId: uuidParam,
  toWarehouseId: uuidParam,
  quantity: z.number().int().min(1),
  notes: z.string().optional(),
});

// --- Invoices ---
export const createInvoiceSchema = z.object({
  orderId: uuidParam,
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  metadata: metadataSchema,
});

// --- Payments ---
export const recordPaymentSchema = z.object({
  invoiceId: uuidParam,
  amount: z.number().min(0),
  method: z.string().min(1).max(50),
  reference: z.string().max(255).optional(),
  notes: z.string().optional(),
  metadata: metadataSchema,
});

// --- Chat ---
export const chatMessageSchema = z.object({
  message: z.string().min(1),
  context: z.record(z.unknown()).optional(),
});
