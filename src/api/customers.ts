import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { paginationSchema } from "@lib/pagination";
import * as svc from "@services/customers";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

router.get("/customers", async (c) => {
  const params = paginationSchema.parse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
    search: c.req.query("search"),
  });
  const result = await svc.listCustomersEnriched(params);
  return c.json(result);
});

router.get("/customers/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = parseInt(c.req.query("limit") ?? "20");
  const result = await svc.searchCustomers(q, limit);
  return c.json({ data: result });
});

router.get("/customers/:id", async (c) => {
  const customer = await svc.getCustomer(c.req.param("id"));
  return c.json({ data: customer });
});

router.post("/customers", async (c) => {
  const body = await c.req.json();
  const customer = await svc.createCustomer(body);
  return c.json({ data: customer }, 201);
});

router.put("/customers/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const customer = await svc.updateCustomer(id, body);
  return c.json({ data: customer });
});

router.delete("/customers/:id", async (c) => {
  await svc.deleteCustomer(c.req.param("id"));
  return c.json({ deleted: true });
});

export default router;
