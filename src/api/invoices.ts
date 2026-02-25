import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { paginationSchema } from "@lib/pagination";
import * as svc from "@services/invoices";
import { db, invoices as invoicesTable } from "@db/index";
import { eq } from "drizzle-orm";

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
    status:     c.req.query("status"),
    startDate:  c.req.query("startDate"),
    endDate:    c.req.query("endDate"),
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

// POST /api/invoices/from-scan — Save an invoice extracted by the scanner UI
router.post("/invoices/from-scan", async (c) => {
  const body = await c.req.json();
  const invoiceNumber = body.invoiceNumber || null;

  // If an invoice with this external number already exists, return 409
  if (invoiceNumber) {
    const existing = await db.query.invoices.findFirst({
      where: eq(invoicesTable.invoiceNumber, invoiceNumber),
      columns: { id: true },
    });
    if (existing) {
      return c.json({ error: `Invoice ${invoiceNumber} already exists` }, 409);
    }
  }

  // Generate a synthetic ingestion id for provenance
  const ingestionId = `ui-scan-${crypto.randomUUID()}`;

  const created = await svc.createInvoiceFromScan({
    externalInvoiceNumber: body.invoiceNumber ?? null,
    supplierName: body.supplierName ?? null,
    subtotal: body.subtotal ?? null,
    taxAmount: body.taxAmount ?? null,
    totalAmount: body.totalAmount ?? null,
    dueDate: body.dueDate ?? null,
    ingestionId,
    notes: body.warnings ? `Scanner warnings: ${JSON.stringify(body.warnings)}` : null,
  });

  return c.json({ data: created }, 201);
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
