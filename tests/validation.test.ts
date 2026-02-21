/**
 * Validation Schema Tests — verifies Zod schemas accept/reject correctly
 */
import { describe, expect, test } from "bun:test";
import {
  createProductSchema,
  createCategorySchema,
  createCustomerSchema,
  createOrderSchema,
  createWarehouseSchema,
  adjustInventorySchema,
  transferInventorySchema,
  chatMessageSchema,
} from "../src/lib/validation";

describe("createProductSchema", () => {
  test("accepts valid product", () => {
    const result = createProductSchema.safeParse({
      sku: "PROD-001",
      name: "Widget",
      price: 9.99,
    });
    expect(result.success).toBe(true);
  });

  test("accepts full product with all optional fields", () => {
    const result = createProductSchema.safeParse({
      sku: "PROD-002",
      name: "Gadget",
      price: 19.99,
      description: "A fine gadget",
      unit: "piece",
      costPrice: 8.0,
      taxRate: 0.16,
      barcode: "123456789",
      minStockLevel: 10,
      maxStockLevel: 1000,
      reorderPoint: 50,
      metadata: { color: "red" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing sku", () => {
    const result = createProductSchema.safeParse({ name: "Widget", price: 9.99 });
    expect(result.success).toBe(false);
  });

  test("rejects missing name", () => {
    const result = createProductSchema.safeParse({ sku: "X", price: 0 });
    expect(result.success).toBe(false);
  });

  test("rejects negative price", () => {
    const result = createProductSchema.safeParse({ sku: "X", name: "Y", price: -1 });
    expect(result.success).toBe(false);
  });

  test("rejects taxRate > 1", () => {
    const result = createProductSchema.safeParse({
      sku: "X",
      name: "Y",
      price: 10,
      taxRate: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("createCategorySchema", () => {
  test("accepts valid category", () => {
    const result = createCategorySchema.safeParse({ name: "Electronics" });
    expect(result.success).toBe(true);
  });

  test("rejects empty name", () => {
    const result = createCategorySchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});

describe("createCustomerSchema", () => {
  test("accepts valid customer with email", () => {
    const result = createCustomerSchema.safeParse({
      name: "Acme Corp",
      email: "info@acme.com",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid email", () => {
    const result = createCustomerSchema.safeParse({
      name: "Acme",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  test("transforms creditLimit to string", () => {
    const result = createCustomerSchema.safeParse({
      name: "Test",
      creditLimit: 5000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.creditLimit).toBe("5000");
    }
  });
});

describe("createOrderSchema", () => {
  const validOrder = {
    items: [{ productId: "550e8400-e29b-41d4-a716-446655440000", quantity: 2, unitPrice: 10 }],
  };

  test("accepts valid order", () => {
    expect(createOrderSchema.safeParse(validOrder).success).toBe(true);
  });

  test("rejects empty items array", () => {
    expect(createOrderSchema.safeParse({ items: [] }).success).toBe(false);
  });

  test("rejects quantity < 1", () => {
    const result = createOrderSchema.safeParse({
      items: [{ productId: "550e8400-e29b-41d4-a716-446655440000", quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });

  test("accepts valid payment status", () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      paymentStatus: "paid",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid payment status", () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      paymentStatus: "unknown",
    });
    expect(result.success).toBe(false);
  });
});

describe("createWarehouseSchema", () => {
  test("accepts valid warehouse", () => {
    const result = createWarehouseSchema.safeParse({ name: "Main", code: "WH-01" });
    expect(result.success).toBe(true);
  });

  test("rejects missing code", () => {
    expect(createWarehouseSchema.safeParse({ name: "Main" }).success).toBe(false);
  });
});

describe("adjustInventorySchema", () => {
  test("accepts positive adjustment", () => {
    const result = adjustInventorySchema.safeParse({
      productId: "550e8400-e29b-41d4-a716-446655440000",
      warehouseId: "550e8400-e29b-41d4-a716-446655440001",
      quantity: 10,
      type: "receipt",
    });
    expect(result.success).toBe(true);
  });

  test("accepts negative adjustment (removal)", () => {
    const result = adjustInventorySchema.safeParse({
      productId: "550e8400-e29b-41d4-a716-446655440000",
      warehouseId: "550e8400-e29b-41d4-a716-446655440001",
      quantity: -5,
      type: "shrinkage",
    });
    expect(result.success).toBe(true);
  });
});

describe("transferInventorySchema", () => {
  test("accepts valid transfer", () => {
    const result = transferInventorySchema.safeParse({
      productId: "550e8400-e29b-41d4-a716-446655440000",
      fromWarehouseId: "550e8400-e29b-41d4-a716-446655440001",
      toWarehouseId: "550e8400-e29b-41d4-a716-446655440002",
      quantity: 5,
    });
    expect(result.success).toBe(true);
  });

  test("rejects quantity < 1", () => {
    const result = transferInventorySchema.safeParse({
      productId: "550e8400-e29b-41d4-a716-446655440000",
      fromWarehouseId: "550e8400-e29b-41d4-a716-446655440001",
      toWarehouseId: "550e8400-e29b-41d4-a716-446655440002",
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("chatMessageSchema", () => {
  test("accepts valid message", () => {
    expect(chatMessageSchema.safeParse({ message: "Hello" }).success).toBe(true);
  });

  test("accepts message with context", () => {
    const result = chatMessageSchema.safeParse({
      message: "What's in stock?",
      context: { warehouseId: "abc" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty message", () => {
    expect(chatMessageSchema.safeParse({ message: "" }).success).toBe(false);
  });
});
