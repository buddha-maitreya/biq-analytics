import { db, products } from "@db/index";
import { eq, ilike, and, sql, desc } from "drizzle-orm";
import { config } from "@lib/config";
import {
  createProductSchema,
  updateProductSchema,
} from "@lib/validation";
import { NotFoundError, ConflictError } from "@lib/errors";
import { type PaginationParams, paginate, offset } from "@lib/pagination";

export async function createProduct(data: unknown) {
  const parsed = createProductSchema.parse(data);

  const existing = await db.query.products.findFirst({
    where: eq(products.sku, parsed.sku),
  });
  if (existing) {
    throw new ConflictError(
      `${config.labels.product} with SKU '${parsed.sku}' already exists`
    );
  }

  const [product] = await db
    .insert(products)
    .values({
      ...parsed,
      unit: parsed.unit ?? config.labels.unitDefault,
      price: String(parsed.price),
      costPrice: parsed.costPrice != null ? String(parsed.costPrice) : undefined,
      taxRate: parsed.taxRate != null ? String(parsed.taxRate) : undefined,
    })
    .returning();

  return product;
}

export async function updateProduct(id: string, data: unknown) {
  const parsed = updateProductSchema.parse(data);

  const [product] = await db
    .update(products)
    .set({
      ...parsed,
      price: parsed.price != null ? String(parsed.price) : undefined,
      costPrice: parsed.costPrice != null ? String(parsed.costPrice) : undefined,
      taxRate: parsed.taxRate != null ? String(parsed.taxRate) : undefined,
    })
    .where(eq(products.id, id))
    .returning();

  if (!product) throw new NotFoundError(config.labels.product, id);
  return product;
}

export async function deleteProduct(id: string) {
  const [product] = await db
    .update(products)
    .set({ isActive: false })
    .where(eq(products.id, id))
    .returning();

  if (!product) throw new NotFoundError(config.labels.product, id);
  return product;
}

export async function getProduct(id: string) {
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: { category: true, inventory: true },
  });
  if (!product) throw new NotFoundError(config.labels.product, id);
  return product;
}

export async function listProducts(params: PaginationParams) {
  const items = await db.query.products.findMany({
    where: eq(products.isActive, true),
    with: { category: true },
    limit: params.limit,
    offset: offset(params),
    orderBy: [desc(products.createdAt)],
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(eq(products.isActive, true));

  return paginate(items, Number(count), params);
}

export async function searchProducts(term: string, limit = 20) {
  return db.query.products.findMany({
    where: and(eq(products.isActive, true), ilike(products.name, `%${term}%`)),
    with: { category: true },
    limit,
  });
}

/** Look up a product by barcode value */
export async function lookupByBarcode(barcode: string) {
  if (!barcode?.trim()) return null;
  return db.query.products.findFirst({
    where: and(eq(products.isActive, true), eq(products.barcode, barcode.trim())),
    with: { category: true },
  });
}

/** Fuzzy match product by name — returns best matches for OCR-extracted names */
export async function fuzzyMatchProducts(names: string[], limit = 5) {
  const results: Record<string, any[]> = {};
  for (const name of names) {
    if (!name?.trim()) continue;
    // Use trigram-style matching: search for each word
    const words = name.trim().split(/\s+/).filter(w => w.length > 2);
    const term = words.length > 0 ? words[0] : name.trim();
    const matches = await db.query.products.findMany({
      where: and(eq(products.isActive, true), ilike(products.name, `%${term}%`)),
      with: { category: true },
      limit,
    });
    results[name] = matches;
  }
  return results;
}
