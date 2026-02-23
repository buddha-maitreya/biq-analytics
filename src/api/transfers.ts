/**
 * Transfer API Routes — Inter-branch inventory transfers
 *
 * Endpoints:
 *   POST   /api/transfers                    — Create a new transfer order
 *   GET    /api/transfers                    — List transfer orders (filterable)
 *   GET    /api/transfers/stats              — Transfer summary stats
 *   GET    /api/transfers/:id                — Get transfer order with items
 *   POST   /api/transfers/:id/items          — Add item to draft order
 *   DELETE /api/transfers/:id/items/:itemId  — Remove item from draft
 *   POST   /api/transfers/:id/dispatch       — Dispatch (deduct source stock)
 *   POST   /api/transfers/:id/receive        — Receive items (manual count batch)
 *   POST   /api/transfers/:id/receive/scan   — Receive item by barcode scan
 *   POST   /api/transfers/:id/complete       — Complete (credit dest stock)
 *   DELETE /api/transfers/:id                — Cancel draft order
 *
 * All endpoints require authentication. Transfer operations require
 * the "inventory" permission.
 */

import { createRouter, validator } from "@agentuity/runtime";
import { s } from "@agentuity/schema";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware, getAppUser, requirePermission } from "@lib/auth";
import {
  createTransferOrder,
  getTransferOrder,
  listTransferOrders,
  addTransferItem,
  removeTransferItem,
  dispatchTransferOrder,
  receiveTransferItem,
  receiveTransferByBarcode,
  receiveTransferItems,
  completeTransferOrder,
  cancelTransferOrder,
  getTransferStats,
} from "@services/transfer";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

// ── POST /api/transfers — Create transfer order ─────────────

export const createTransferBody = s.object({
  fromWarehouseId: s.string(),
  toWarehouseId: s.string(),
  notes: s.optional(s.string()),
  acceptanceMode: s.optional(s.string()),
  items: s.array(s.object({
    productId: s.string(),
    quantity: s.number(),
  })),
});

router.post("/transfers",
  requirePermission("inventory"),
  validator({ input: createTransferBody }),
  async (c) => {
    const user = getAppUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const body = c.req.valid("json");
    const result = await createTransferOrder(body as any, user.id);
    return c.json({ data: result }, 201);
  }
);

// ── GET /api/transfers — List transfer orders ───────────────

router.get("/transfers",
  requirePermission("inventory"),
  async (c) => {
    const { status, fromWarehouseId, toWarehouseId, limit, offset } = c.req.query();
    const result = await listTransferOrders({
      status: status || undefined,
      fromWarehouseId: fromWarehouseId || undefined,
      toWarehouseId: toWarehouseId || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return c.json({ data: result });
  }
);

// ── GET /api/transfers/stats — Transfer summary ─────────────

router.get("/transfers/stats",
  requirePermission("inventory"),
  async (c) => {
    const stats = await getTransferStats();
    return c.json({ data: stats });
  }
);

// ── GET /api/transfers/:id — Get transfer order ─────────────

router.get("/transfers/:id", async (c) => {
  const id = c.req.param("id");
  const order = await getTransferOrder(id);
  return c.json({ data: order });
});

// ── POST /api/transfers/:id/items — Add item to draft ───────

export const addItemBody = s.object({
  productId: s.string(),
  quantity: s.optional(s.number()),
});

router.post("/transfers/:id/items",
  requirePermission("inventory"),
  validator({ input: addItemBody }),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const item = await addTransferItem(id, body as any);
    return c.json({ data: item }, 201);
  }
);

// ── DELETE /api/transfers/:id/items/:itemId — Remove item ───

router.delete("/transfers/:id/items/:itemId",
  requirePermission("inventory"),
  async (c) => {
    const orderId = c.req.param("id");
    const itemId = c.req.param("itemId");
    await removeTransferItem(orderId, itemId);
    return c.json({ data: { deleted: true } });
  }
);

// ── POST /api/transfers/:id/dispatch — Dispatch order ───────

router.post("/transfers/:id/dispatch",
  requirePermission("inventory"),
  async (c) => {
    const user = getAppUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const id = c.req.param("id");
    const order = await dispatchTransferOrder(id, user.id);
    return c.json({ data: order });
  }
);

// ── POST /api/transfers/:id/receive — Receive items (manual batch) ──

export const receiveBody = s.object({
  items: s.array(s.object({
    itemId: s.string(),
    receivedQuantity: s.number(),
    discrepancyReason: s.optional(s.string()),
    discrepancyNote: s.optional(s.string()),
  })),
});

router.post("/transfers/:id/receive",
  requirePermission("inventory"),
  validator({ input: receiveBody }),
  async (c) => {
    const user = getAppUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const id = c.req.param("id");
    const body = c.req.valid("json");
    const items = await receiveTransferItems(id, body as any, user.id);
    return c.json({ data: items });
  }
);

// ── POST /api/transfers/:id/receive/scan — Receive by barcode ──

export const receiveScanBody = s.object({
  barcode: s.string(),
  quantity: s.optional(s.number()),
});

router.post("/transfers/:id/receive/scan",
  requirePermission("inventory"),
  validator({ input: receiveScanBody }),
  async (c) => {
    const user = getAppUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const id = c.req.param("id");
    const body = c.req.valid("json");
    const result = await receiveTransferByBarcode(
      id,
      body.barcode as string,
      (body.quantity as number) ?? 1,
      user.id
    );

    const status = "success" in result && result.success ? 200 : 404;
    return c.json({ data: result }, status);
  }
);

// ── POST /api/transfers/:id/complete — Complete transfer ────

router.post("/transfers/:id/complete",
  requirePermission("inventory"),
  async (c) => {
    const user = getAppUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const id = c.req.param("id");
    const order = await completeTransferOrder(id, user.id);
    return c.json({ data: order });
  }
);

// ── DELETE /api/transfers/:id — Cancel draft ────────────────

router.delete("/transfers/:id",
  requirePermission("inventory"),
  async (c) => {
    const id = c.req.param("id");
    const result = await cancelTransferOrder(id);
    return c.json({ data: result });
  }
);

export default router;
