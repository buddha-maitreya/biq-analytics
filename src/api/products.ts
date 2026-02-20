import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import { paginationSchema } from "@lib/pagination";
import { createProductSchema, updateProductSchema } from "@lib/validation";
import * as svc from "@services/products";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

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

router.post("/products", validator({ input: createProductSchema }), async (c) => {
  const body = c.req.valid("json");
  const product = await svc.createProduct(body);
  return c.json({ data: product }, 201);
});

router.put("/products/:id", validator({ input: updateProductSchema }), async (c) => {
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const product = await svc.updateProduct(id, body);
  return c.json({ data: product });
});

router.delete("/products/:id", async (c) => {
  await svc.deleteProduct(c.req.param("id"));
  return c.json({ deleted: true });
});

export default router;
