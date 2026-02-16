import { createRouter } from "@agentuity/runtime";
import { toAppError } from "@lib/errors";
import * as svc from "@services/categories";

const router = createRouter();

router.get("/categories", async (c) => {
  try {
    const result = await svc.listCategories();
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.get("/categories/tree", async (c) => {
  try {
    const result = await svc.getCategoryTree();
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.get("/categories/:id", async (c) => {
  try {
    const category = await svc.getCategory(c.req.param("id"));
    return c.json({ data: category });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/categories", async (c) => {
  try {
    const body = await c.req.json();
    const category = await svc.createCategory(body);
    return c.json({ data: category }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.put("/categories/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const category = await svc.updateCategory(id, body);
    return c.json({ data: category });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.delete("/categories/:id", async (c) => {
  try {
    await svc.deleteCategory(c.req.param("id"));
    return c.json({ deleted: true });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

export default router;
