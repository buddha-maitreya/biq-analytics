import { createRouter } from "@agentuity/runtime";
import { toAppError } from "@lib/errors";
import { paginationSchema } from "@lib/pagination";
import * as svc from "@services/products";

const router = createRouter();

router.get("/products", async (c) => {
  try {
    const params = paginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
      search: c.req.query("search"),
    });
    const result = await svc.listProducts(params);
    return c.json(result);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.get("/products/search", async (c) => {
  try {
    const q = c.req.query("q") ?? "";
    const limit = parseInt(c.req.query("limit") ?? "20");
    const result = await svc.searchProducts(q, limit);
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.get("/products/:id", async (c) => {
  try {
    const product = await svc.getProduct(c.req.param("id"));
    return c.json({ data: product });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/products", async (c) => {
  try {
    const body = await c.req.json();
    const product = await svc.createProduct(body);
    return c.json({ data: product }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.put("/products/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const product = await svc.updateProduct(id, body);
    return c.json({ data: product });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.delete("/products/:id", async (c) => {
  try {
    await svc.deleteProduct(c.req.param("id"));
    return c.json({ deleted: true });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

export default router;
