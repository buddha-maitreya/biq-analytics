import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { paginationSchema } from "@lib/pagination";
import * as svc from "@services/invoices";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

router.get("/invoices", async (c) => {
  const params = paginationSchema.parse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
  });
  const result = await svc.listInvoices(params, {
    customerId: c.req.query("customerId"),
    status: c.req.query("status"),
  });
  return c.json(result);
});

router.get("/invoices/:id", async (c) => {
  const invoice = await svc.getInvoice(c.req.param("id"));
  return c.json({ data: invoice });
});

router.post("/invoices", async (c) => {
  const body = await c.req.json();
  const invoice = await svc.generateInvoice(body);
  return c.json({ data: invoice }, 201);
});

router.post("/invoices/:id/payment", async (c) => {
  const body = await c.req.json();
  const payment = await svc.recordPayment({
    ...body,
    invoiceId: c.req.param("id"),
  });
  return c.json({ data: payment }, 201);
});

router.post("/invoices/:id/send", async (c) => {
  const invoice = await svc.markInvoiceSent(c.req.param("id"));
  return c.json({ data: invoice });
});

router.post("/invoices/:id/void", async (c) => {
  const invoice = await svc.voidInvoice(c.req.param("id"));
  return c.json({ data: invoice });
});

export default router;
