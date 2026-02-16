import { createRouter } from "@agentuity/runtime";
import { toAppError } from "@lib/errors";
import { paginationSchema } from "@lib/pagination";
import * as svc from "@services/invoices";

const router = createRouter();

router.get("/invoices", async (c) => {
  try {
    const params = paginationSchema.parse({
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });
    const result = await svc.listInvoices(params, {
      customerId: c.req.query("customerId"),
      status: c.req.query("status"),
    });
    return c.json(result);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.get("/invoices/:id", async (c) => {
  try {
    const invoice = await svc.getInvoice(c.req.param("id"));
    return c.json({ data: invoice });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/invoices", async (c) => {
  try {
    const body = await c.req.json();
    const invoice = await svc.generateInvoice(body);
    return c.json({ data: invoice }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/invoices/:id/payment", async (c) => {
  try {
    const body = await c.req.json();
    const payment = await svc.recordPayment({
      ...body,
      invoiceId: c.req.param("id"),
    });
    return c.json({ data: payment }, 201);
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/invoices/:id/send", async (c) => {
  try {
    const invoice = await svc.markInvoiceSent(c.req.param("id"));
    return c.json({ data: invoice });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

router.post("/invoices/:id/void", async (c) => {
  try {
    const invoice = await svc.voidInvoice(c.req.param("id"));
    return c.json({ data: invoice });
  } catch (err) {
    const e = toAppError(err);
    return c.json({ error: e.message, code: e.code }, e.statusCode as any);
  }
});

export default router;
