import { db, products, taxRules } from "@db/index";
import { eq, asc } from "drizzle-orm";
import { config } from "@lib/config";
import { NotFoundError } from "@lib/errors";

interface PriceLineItem {
  productId: string;
  quantity: number;
  overridePrice?: number;
  discountPercent?: number;
  discountAmount?: number;
}

interface PriceBreakdown {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

/** Calculate price details for a single product */
export async function calculatePrice(productId: string) {
  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
  });
  if (!product) throw new NotFoundError(config.labels.product, productId);

  const taxRate = Number(product.taxRate ?? config.taxRate);
  const price = Number(product.price);
  const costPrice = Number(product.costPrice ?? 0);
  const taxAmount = price * taxRate;

  return {
    productId: product.id,
    productName: product.name,
    unitPrice: price,
    costPrice,
    taxRate,
    taxAmount,
    priceWithTax: price + taxAmount,
    margin: price - costPrice,
    marginPercent: price > 0 ? ((price - costPrice) / price) * 100 : 0,
  };
}

/** Calculate prices for multiple items (cart / quote) */
export async function bulkCalculate(items: PriceLineItem[]) {
  if (!items.length) return { items: [], totals: { subtotal: 0, discount: 0, tax: 0, total: 0 } };

  const breakdown: PriceBreakdown[] = [];
  let grandSubtotal = 0;
  let grandDiscount = 0;
  let grandTax = 0;

  for (const item of items) {
    const product = await db.query.products.findFirst({
      where: eq(products.id, item.productId),
    });
    if (!product) throw new NotFoundError(config.labels.product, item.productId);

    const unitPrice = item.overridePrice ?? Number(product.price);
    const subtotal = unitPrice * item.quantity;

    let discount = item.discountAmount ?? 0;
    if (item.discountPercent) {
      discount = subtotal * (item.discountPercent / 100);
    }

    const taxRate = Number(product.taxRate ?? config.taxRate);
    const taxableAmount = subtotal - discount;
    const taxAmount = taxableAmount * taxRate;
    const total = taxableAmount + taxAmount;

    breakdown.push({
      productId: product.id,
      productName: product.name,
      unitPrice,
      quantity: item.quantity,
      subtotal,
      discountAmount: discount,
      taxRate,
      taxAmount,
      total,
    });

    grandSubtotal += subtotal;
    grandDiscount += discount;
    grandTax += taxAmount;
  }

  return {
    items: breakdown,
    totals: {
      subtotal: grandSubtotal,
      discount: grandDiscount,
      tax: grandTax,
      total: grandSubtotal - grandDiscount + grandTax,
    },
  };
}

/** Get configured tax rules */
export async function getTaxRules() {
  return db.query.taxRules.findMany({
    orderBy: [asc(taxRules.name)],
  });
}
