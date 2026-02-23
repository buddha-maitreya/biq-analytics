/**
 * Product Requests API — Borrow / Request cross-branch inventory
 *
 * POST   /product-requests           — Create a borrow/request
 * GET    /product-requests/mine      — My requests
 * GET    /product-requests/pending/:warehouseId — Pending for a warehouse
 * GET    /product-requests/:id       — Single request detail
 * PUT    /product-requests/:id       — Update status (approve/reject/fulfil)
 * GET    /product-requests/analytics — AI analytics endpoint
 */
import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import * as svc from "@services/product-requests";
import { getSearchAnalytics } from "@services/search-log";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

/** Create a new borrow/request */
router.post("/product-requests", async (c) => {
  const user = (c.var as any).appUser;
  const body = await c.req.json();
  const request = await svc.createProductRequest(user.id, body);
  return c.json({ data: request }, 201);
});

/** My requests */
router.get("/product-requests/mine", async (c) => {
  const user = (c.var as any).appUser;
  const requests = await svc.listMyRequests(user.id);
  return c.json({ data: requests });
});

/** Pending requests for a warehouse (manager view) */
router.get("/product-requests/pending/:warehouseId", async (c) => {
  const requests = await svc.listPendingForWarehouse(c.req.param("warehouseId"));
  return c.json({ data: requests });
});

/** Request analytics — for AI agents and management */
router.get("/product-requests/analytics", async (c) => {
  const days = parseInt(c.req.query("days") ?? "30");
  const requestAnalytics = await svc.getRequestAnalytics({ days });
  const searchAnalytics = await getSearchAnalytics({ days });
  return c.json({ data: { requests: requestAnalytics, searches: searchAnalytics } });
});

/** Single request detail */
router.get("/product-requests/:id", async (c) => {
  const request = await svc.getProductRequest(c.req.param("id"));
  return c.json({ data: request });
});

/** Update request status */
router.put("/product-requests/:id", async (c) => {
  const user = (c.var as any).appUser;
  const body = await c.req.json();
  const request = await svc.updateRequestStatus(
    c.req.param("id"),
    user.id,
    body
  );
  return c.json({ data: request });
});

export default router;
