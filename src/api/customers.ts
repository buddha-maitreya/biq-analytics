import { createRouter } from "@agentuity/runtime";
import { toAppError } from "@lib/errors";
import { paginationSchema } from "@lib/pagination";
import * as svc from "@services/customers";

const router = createRouter();

router.get("/customers", async (c) => {
  try {
    const params = paginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
      search: c.req.query("search"),
    });
    const result = await svc.listCustomers(params);
    return c.json(result);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.get("/customers/search", async (c) => {
  try {
    const q = c.req.query("q") ?? "";
    const limit = parseInt(c.req.query("limit") ?? "20");
    const result = await svc.searchCustomers(q, limit);
    return c.json({ data: result });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.get("/customers/:id", async (c) => {
  try {
    const customer = await svc.getCustomer(c.req.param("id"));
    return c.json({ data: customer });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/customers", async (c) => {
  try {
    const body = await c.req.json();
    const customer = await svc.createCustomer(body);
    return c.json({ data: customer }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.put("/customers/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const customer = await svc.updateCustomer(id, body);
    return c.json({ data: customer });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.delete("/customers/:id", async (c) => {
  try {
    await svc.deleteCustomer(c.req.param("id"));
    return c.json({ deleted: true });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

export default router;
