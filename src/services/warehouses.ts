import { db, warehouses } from "@db/index";
import { eq } from "drizzle-orm";
import { config } from "@lib/config";
import { createWarehouseSchema, updateWarehouseSchema } from "@lib/validation";
import { NotFoundError } from "@lib/errors";

export async function createWarehouse(data: unknown) {
  const parsed = createWarehouseSchema.parse(data);

  // If marking as default, unset all others first
  if (parsed.isDefault) {
    await db
      .update(warehouses)
      .set({ isDefault: false })
      .where(eq(warehouses.isDefault, true));
  }

  const [warehouse] = await db
    .insert(warehouses)
    .values(parsed)
    .returning();

  return warehouse;
}

export async function updateWarehouse(id: string, data: unknown) {
  const parsed = updateWarehouseSchema.parse(data);

  if (parsed.isDefault) {
    await db
      .update(warehouses)
      .set({ isDefault: false })
      .where(eq(warehouses.isDefault, true));
  }

  const [warehouse] = await db
    .update(warehouses)
    .set(parsed)
    .where(eq(warehouses.id, id))
    .returning();

  if (!warehouse) throw new NotFoundError(config.labels.warehouse, id);
  return warehouse;
}

export async function deleteWarehouse(id: string) {
  const [warehouse] = await db
    .update(warehouses)
    .set({ isActive: false })
    .where(eq(warehouses.id, id))
    .returning();

  if (!warehouse) throw new NotFoundError(config.labels.warehouse, id);
  return warehouse;
}

export async function getWarehouse(id: string) {
  const warehouse = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, id),
    with: { inventory: { with: { product: true } } },
  });
  if (!warehouse) throw new NotFoundError(config.labels.warehouse, id);
  return warehouse;
}

export async function listWarehouses() {
  return db.query.warehouses.findMany({
    where: eq(warehouses.isActive, true),
    orderBy: (w, { asc }) => [asc(w.name)],
  });
}

export async function getDefaultWarehouse() {
  return db.query.warehouses.findFirst({
    where: eq(warehouses.isDefault, true),
  });
}
