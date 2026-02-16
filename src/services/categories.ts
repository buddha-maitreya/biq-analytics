import { db, categories } from "@db/index";
import { eq, isNull } from "drizzle-orm";
import { config } from "@lib/config";
import { createCategorySchema, updateCategorySchema } from "@lib/validation";
import { NotFoundError } from "@lib/errors";

export async function createCategory(data: unknown) {
  const parsed = createCategorySchema.parse(data);

  const [category] = await db
    .insert(categories)
    .values(parsed)
    .returning();

  return category;
}

export async function updateCategory(id: string, data: unknown) {
  const parsed = updateCategorySchema.parse(data);

  const [category] = await db
    .update(categories)
    .set(parsed)
    .where(eq(categories.id, id))
    .returning();

  if (!category) throw new NotFoundError("Category", id);
  return category;
}

export async function deleteCategory(id: string) {
  const [category] = await db
    .update(categories)
    .set({ isActive: false })
    .where(eq(categories.id, id))
    .returning();

  if (!category) throw new NotFoundError("Category", id);
  return category;
}

export async function getCategory(id: string) {
  const category = await db.query.categories.findFirst({
    where: eq(categories.id, id),
    with: { children: true, products: true },
  });
  if (!category) throw new NotFoundError("Category", id);
  return category;
}

export async function listCategories() {
  return db.query.categories.findMany({
    where: eq(categories.isActive, true),
    orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
  });
}

/** Returns top-level categories with nested children */
export async function getCategoryTree() {
  const all = await db.query.categories.findMany({
    where: eq(categories.isActive, true),
    with: { children: true },
    orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
  });

  // Filter to roots only — children are attached via relations
  return all.filter((c) => !c.parentId);
}
