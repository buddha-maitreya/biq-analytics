import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import { createCategorySchema, updateCategorySchema } from "@lib/validation";
import * as svc from "@services/categories";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

router.get("/categories", async (c) => {
  const result = await svc.listCategories();
  return c.json({ data: result });
});

router.get("/categories/tree", async (c) => {
  const result = await svc.getCategoryTree();
  return c.json({ data: result });
});

router.get("/categories/:id", async (c) => {
  const category = await svc.getCategory(c.req.param("id"));
  return c.json({ data: category });
});

router.post("/categories", validator({ input: createCategorySchema }), async (c) => {
  const body = c.req.valid("json");
  const category = await svc.createCategory(body);
  return c.json({ data: category }, 201);
});

router.put("/categories/:id", validator({ input: updateCategorySchema }), async (c) => {
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const category = await svc.updateCategory(id, body);
  return c.json({ data: category });
});

router.delete("/categories/:id", async (c) => {
  await svc.deleteCategory(c.req.param("id"));
  return c.json({ deleted: true });
});

export default router;
