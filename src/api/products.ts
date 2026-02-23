import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { paginationSchema } from "@lib/pagination";
import * as svc from "@services/products";
import { logSearch } from "@services/search-log";
import { getCrossBranchAvailability } from "@services/product-requests";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

router.get("/products", async (c) => {
  const params = paginationSchema.parse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
    search: c.req.query("search"),
  });
  const warehouseId = c.req.query("warehouseId");
  const startTs = Date.now();
  const result = await svc.listProducts(params);
  const duration = Date.now() - startTs;

  // Fire-and-forget search logging (only if there's a search term)
  const searchTerm = c.req.query("search");
  if (searchTerm) {
    const user = (c.var as any).appUser;
    logSearch({
      userId: user?.id,
      searchTerm,
      warehouseId: warehouseId ?? undefined,
      resultCount: result.data?.length ?? 0,
      searchDurationMs: duration,
      source: "products_page",
      ipAddress: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
    }).catch(() => {});
  }

  return c.json(result);
});

router.get("/products/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = parseInt(c.req.query("limit") ?? "20");
  const warehouseId = c.req.query("warehouseId");
  const startTs = Date.now();
  const result = await svc.searchProducts(q, limit);
  const duration = Date.now() - startTs;

  // Fire-and-forget search logging
  if (q) {
    const user = (c.var as any).appUser;
    logSearch({
      userId: user?.id,
      searchTerm: q,
      warehouseId: warehouseId ?? undefined,
      resultCount: result.length,
      searchDurationMs: duration,
      source: c.req.query("source") ?? "products_page",
      ipAddress: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
    }).catch(() => {});
  }

  return c.json({ data: result });
});

/** Cross-branch stock availability for a product */
router.get("/products/:id/availability", async (c) => {
  const productId = c.req.param("id");
  const excludeWarehouseId = c.req.query("excludeWarehouseId");
  const availability = await getCrossBranchAvailability(
    productId,
    excludeWarehouseId ?? undefined
  );
  return c.json({ data: availability });
});

router.get("/products/:id", async (c) => {
  const product = await svc.getProduct(c.req.param("id"));
  return c.json({ data: product });
});

router.post("/products", async (c) => {
  const body = await c.req.json();
  const product = await svc.createProduct(body);
  return c.json({ data: product }, 201);
});

router.put("/products/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const product = await svc.updateProduct(id, body);
  return c.json({ data: product });
});

router.delete("/products/:id", async (c) => {
  await svc.deleteProduct(c.req.param("id"));
  return c.json({ deleted: true });
});

export default router;
