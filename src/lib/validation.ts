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
  creditLimit: z
    .number()
    .min(0)
    .optional()
    .transform((v) => v?.toString()),
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
  /** Payment method: cash, card, card_pdq, mpesa, bank_transfer */
  paymentMethod: z.string().max(50).optional(),
  /** External reference: PDQ approval code, M-Pesa receipt, Paystack ref */
  paymentReference: z.string().max(255).optional(),
  /** Payment status: pending, paid, partial, refunded */
  paymentStatus: z.enum(["pending", "paid", "partial", "refunded"]).optional(),
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
  /** Attachment IDs from a prior upload (images, documents) */
  attachmentIds: z.array(z.string().uuid()).optional(),
});

export const chatFeedbackSchema = z.object({
  rating: z.enum(["up", "down"]),
});

// --- Auth ---
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

// --- Settings ---
export const updateSettingsSchema = z.record(z.string());

export const testModelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().min(1),
});

// --- Reports ---
export const generateReportSchema = z.object({
  type: z.enum([
    "sales-summary",
    "inventory-health",
    "customer-activity",
    "financial-overview",
  ]),
  periodDays: z.number().int().min(1).optional(),
});

// --- Admin: Order Statuses ---
export const createAdminOrderStatusSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  color: z.string().max(20).optional(),
  sortOrder: z.number().int().optional(),
  isFinal: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  metadata: metadataSchema,
});

export const updateAdminOrderStatusSchema = createAdminOrderStatusSchema.partial();

// --- Admin: Tax Rules ---
export const createTaxRuleSchema = z.object({
  name: z.string().min(1).max(100),
  rate: z.number().min(0).max(1),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  metadata: metadataSchema,
});

export const updateTaxRuleSchema = createTaxRuleSchema.partial();

// --- Admin: Users ---
export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.string().min(1).max(50),
  password: z.string().min(6).optional(),
  permissions: z.array(z.string()).optional(),
  assignedWarehouses: z.array(z.string().uuid()).optional(),
  metadata: metadataSchema,
});

export const updateUserSchema = createUserSchema.partial();

export const updateUserPermissionsSchema = z.object({
  permissions: z.array(z.string()).optional(),
  assignedWarehouses: z.array(z.string().uuid()).optional(),
});

// --- Payments ---
export const paystackInitSchema = z.object({
  email: z.string().email(),
  amount: z.number().positive(),
  currency: z.string().max(10).optional(),
  metadata: metadataSchema,
});

export const paystackVerifySchema = z.object({
  reference: z.string().min(1),
});

export const mpesaStkPushSchema = z.object({
  phoneNumber: z.string().min(1),
  amount: z.number().positive(),
  accountReference: z.string().optional(),
  orderId: z.string().optional(),
  description: z.string().optional(),
});

export const mpesaStkQuerySchema = z.object({
  checkoutRequestId: z.string().min(1),
});

export const mpesaC2bRegisterSchema = z.object({
  validationUrl: z.string().url(),
  confirmationUrl: z.string().url(),
});

// --- Pricing ---
export const bulkPricingSchema = z.object({
  items: z.array(z.object({
    productId: uuidParam,
    quantity: z.number().int().min(1).default(1),
  })).min(1),
});

// --- Documents ---
export const uploadDocumentSchema = z.object({
  content: z.string().min(1),
  title: z.string().min(1),
  filename: z.string().min(1),
  category: z.string().optional(),
  chunkSize: z.number().int().min(100).optional(),
  overlap: z.number().int().min(0).optional(),
});

export const queryDocumentSchema = z.object({
  question: z.string().min(1),
});

// --- KRA / eTIMS ---
export const validatePinSchema = z.object({
  pin: z.string().min(1),
});

export const validateTccSchema = z.object({
  pin: z.string().min(1),
  certificateNumber: z.string().optional(),
});

export const queryEtimsInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
});

export const checkInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().min(1),
});

export const vatWithholdingPrnSchema = z.object({
  supplierPin: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
});

// --- Custom Tools ---
export const createCustomToolSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]{0,98}[a-z0-9]$/, "Must be snake_case"),
  label: z.string().min(1).max(255),
  description: z.string().min(1),
  toolType: z.enum(["server", "client"]).optional(),
  // Server tool fields
  webhookUrl: z.string().url().optional(),
  webhookMethod: z.string().optional(),
  webhookHeaders: z.record(z.string()).optional(),
  webhookTimeoutSecs: z.number().int().min(1).max(300).optional(),
  authType: z.string().optional(),
  authConfig: z.record(z.string()).optional(),
  pathParamsSchema: z.array(z.record(z.unknown())).optional(),
  queryParamsSchema: z.array(z.record(z.unknown())).optional(),
  requestBodySchema: z.record(z.unknown()).optional(),
  // Parameter schema (generic)
  parameterSchema: z.record(z.unknown()).optional(),
  parameters: z.record(z.unknown()).optional(),
  // Client tool fields
  expectsResponse: z.boolean().optional(),
  // Shared behaviour
  disableInterruptions: z.boolean().optional(),
  preToolSpeech: z.string().optional(),
  preToolSpeechText: z.string().optional(),
  executionMode: z.string().optional(),
  toolCallSound: z.string().optional(),
  dynamicVariables: z.record(z.unknown()).optional(),
  dynamicVariableAssignments: z.array(z.record(z.unknown())).optional(),
  // Common
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  metadata: metadataSchema,
});

export const updateCustomToolSchema = createCustomToolSchema.partial();

export const testCustomToolSchema = z.object({
  params: z.record(z.unknown()).optional(),
});

// --- Agent Configs ---
export const updateAgentConfigSchema = z.object({
  displayName: z.string().min(1),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  modelOverride: z.string().optional(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  maxSteps: z.number().int().min(1).max(20).optional().nullable(),
  timeoutMs: z.number().int().min(1000).max(300000).optional().nullable(),
  customInstructions: z.string().optional(),
  executionPriority: z.number().int().optional().nullable(),
  config: z.record(z.unknown()).optional(),
});

// --- Order Payment ---
export const updateOrderPaymentSchema = z.object({
  paymentMethod: z.string().max(50).optional(),
  paymentReference: z.string().max(255).optional(),
  paymentStatus: z.enum(["pending", "paid", "partial", "refunded"]).optional(),
});

// --- Prompt Templates ---
export const createPromptTemplateSchema = z.object({
  agentName: z.string().min(1).max(100),
  sectionKey: z.string().min(1).max(100),
  template: z.string().min(1),
  changeNotes: z.string().optional(),
  metadata: metadataSchema,
});

export const updatePromptTemplateSchema = z.object({
  template: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  changeNotes: z.string().optional(),
  metadata: metadataSchema,
});

export const testPromptSchema = z.object({
  agentName: z.string().min(1).max(100),
  message: z.string().min(1),
  promptOverrides: z.record(z.string()).optional(),
});

// --- Few-Shot Examples ---
export const createFewShotExampleSchema = z.object({
  category: z.string().min(1).max(100),
  userInput: z.string().min(1),
  expectedBehavior: z.string().min(1),
  sortOrder: z.number().int().optional(),
  metadata: metadataSchema,
});

export const updateFewShotExampleSchema = z.object({
  userInput: z.string().min(1).optional(),
  expectedBehavior: z.string().min(1).optional(),
  category: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  metadata: metadataSchema,
});

// --- Schedules ---
export const createScheduleSchema = z.object({
  name: z.string().min(1).max(255),
  taskType: z.enum(["report", "insight", "alert", "cleanup", "custom"]),
  cronExpression: z.string().max(100).optional(),
  taskConfig: z.record(z.unknown()).default({}),
  timezone: z.string().max(100).optional(),
  maxFailures: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  metadata: metadataSchema,
});

export const updateScheduleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  cronExpression: z.string().max(100).nullable().optional(),
  taskConfig: z.record(z.unknown()).optional(),
  timezone: z.string().max(100).optional(),
  maxFailures: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  metadata: metadataSchema,
});
