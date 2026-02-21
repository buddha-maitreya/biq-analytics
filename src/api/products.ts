import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { paginationSchema } from "@lib/pagination";
import * as svc from "@services/products";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

router.get("/products", async (c) => {
  const params = paginationSchema.parse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
    search: c.req.query("search"),
  });
  const result = await svc.listProducts(params);
  return c.json(result);
});

router.get("/products/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = parseInt(c.req.query("limit") ?? "20");
  const result = await svc.searchProducts(q, limit);
  return c.json({ data: result });
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
