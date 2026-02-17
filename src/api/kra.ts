/**
 * KRA / eTIMS API Routes
 *
 * Endpoints for KRA PIN validation, TCC checking, eTIMS invoice
 * submission, invoice verification, and VAT withholding PRN generation.
 */

import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import * as kraSvc from "@services/kra-etims";

const router = createRouter();
router.use(errorMiddleware());

// ── Provider Status ──
router.get("/kra/status", async (c) => {
  const status = await kraSvc.getKraProviderStatus();
  return c.json({ data: status });
});

// ── Authorization (token test) ──
router.post("/kra/auth/token", async (c) => {
  const token = await kraSvc.getKraAuthToken();
  return c.json({ data: token });
});

// ── PIN Checker ──
router.post("/kra/pin/validate", async (c) => {
  const { pin } = await c.req.json<{ pin: string }>();
  const result = await kraSvc.validatePin(pin);
  return c.json({ data: result });
});

// ── Tax Compliance Certificate Checker ──
router.post("/kra/tcc/validate", async (c) => {
  const { pin, certificateNumber } = await c.req.json<{
    pin: string;
    certificateNumber?: string;
  }>();
  const result = await kraSvc.validateTcc(pin, certificateNumber);
  return c.json({ data: result });
});

// ── eTIMS Invoice Submission ──
router.post("/kra/etims/invoice/submit", async (c) => {
  const body = await c.req.json();
  const result = await kraSvc.submitEtimsInvoice(body);
  return c.json({ data: result }, result.success ? 200 : 400);
});

// ── eTIMS Invoice Query ──
router.post("/kra/etims/invoice/query", async (c) => {
  const { invoiceNumber } = await c.req.json<{ invoiceNumber: string }>();
  const result = await kraSvc.queryEtimsInvoice(invoiceNumber);
  return c.json({ data: result });
});

// ── Invoice Checker (KRA TIMS/eTIMS public check) ──
router.post("/kra/invoice/check", async (c) => {
  const { invoiceNumber, invoiceDate } = await c.req.json<{
    invoiceNumber: string;
    invoiceDate: string;
  }>();
  const result = await kraSvc.checkInvoice(invoiceNumber, invoiceDate);
  return c.json({ data: result });
});

// ── VAT Withholding PRN Generation ──
router.post("/kra/vat-withholding/prn", async (c) => {
  const { supplierPin, amount, description } = await c.req.json<{
    supplierPin: string;
    amount: number;
    description?: string;
  }>();
  const result = await kraSvc.generateVatWithholdingPrn(
    supplierPin,
    amount,
    description
  );
  return c.json({ data: result }, result.success ? 200 : 400);
});

// ── eTIMS Payment Method Mapping Helper ──
router.get("/kra/etims/payment-codes", (c) => {
  return c.json({
    data: {
      "01": "Cash",
      "02": "Credit",
      "03": "Cash/Credit (Mixed)",
      "04": "Bank Check",
      "05": "Debit & Credit Card",
      "06": "Mobile Money",
      "07": "Wire/Transfer",
    },
  });
});

export default router;
