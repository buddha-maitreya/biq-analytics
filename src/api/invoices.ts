import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import { paginationSchema } from "@lib/pagination";
import { createInvoiceSchema, recordPaymentSchema } from "@lib/validation";
import * as svc from "@services/invoices";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

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

router.post("/invoices", validator({ input: createInvoiceSchema }), async (c) => {
  const body = c.req.valid("json");
  const invoice = await svc.generateInvoice(body);
  return c.json({ data: invoice }, 201);
});

router.post("/invoices/:id/payment", validator({ input: recordPaymentSchema }), async (c) => {
  const body = c.req.valid("json");
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

/** POST /invoices/check-duplicate — check if invoice number exists */
router.post("/invoices/check-duplicate", async (c) => {
  const { invoiceNumber } = await c.req.json();
  if (!invoiceNumber) return c.json({ error: "invoiceNumber required" }, 400);
  const existing = await svc.checkInvoiceExists(invoiceNumber);
  return c.json({ exists: !!existing, invoice: existing });
});

/** POST /invoices/from-scan — create invoice from OCR data */
router.post("/invoices/from-scan", async (c) => {
  const body = await c.req.json();
  if (!body.invoiceNumber) return c.json({ error: "invoiceNumber required" }, 400);
  const result = await svc.createFromScan(body);
  if (result.duplicate) {
    return c.json({ data: result }, 409);
  }
  return c.json({ data: result }, 201);
});

export default router;
