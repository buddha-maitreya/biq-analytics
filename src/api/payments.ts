import { createRouter } from "@agentuity/runtime";
import { errorMiddleware, ValidationError } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import * as paymentsSvc from "@services/payments-integration";
import { db } from "@db/index";
import { orders } from "@db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * In-process map: CheckoutRequestID → orderId
 * Populated when STK push is initiated; consumed in the callback.
 * TTL is 10 minutes — Safaricom delivers callbacks within 90 seconds.
 */
const pendingSTKPushes = new Map<string, { orderId: string; expiresAt: number }>();

function storePendingSTK(checkoutRequestId: string, orderId: string) {
  pendingSTKPushes.set(checkoutRequestId, {
    orderId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  // Sweep expired entries to avoid unbounded growth
  for (const [k, v] of pendingSTKPushes) {
    if (Date.now() > v.expiresAt) pendingSTKPushes.delete(k);
  }
}

async function markOrderPaid(
  orderId: string,
  paymentReference: string,
  paymentMethod: string,
) {
  await db
    .update(orders)
    .set({
      paymentStatus: "paid",
      paymentReference,
      paymentMethod,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));
}

async function findOrderByReference(billRefNumber: string): Promise<string | null> {
  // BillRefNumber is expected to be an order number (e.g. "ORD-0042") or account reference
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(sql`LOWER(${orders.orderNumber}) = LOWER(${billRefNumber})`)
    .limit(1);
  return row?.id ?? null;
}

const router = createRouter();
router.use(errorMiddleware());

// Session auth — applied only to routes initiated by the frontend.
// Callback routes (/mpesa/callback, /c2b/confirmation, /c2b/validation) are
// intentionally public: they are called by Safaricom/Paystack servers which
// have no session cookie. Security is via Paystack IP whitelist and M-Pesa
// response-type enforcement (always returns ResultCode:0).
router.use("/payments/providers", sessionMiddleware());
router.use("/payments/paystack/initialize", sessionMiddleware());
router.use("/payments/paystack/verify", sessionMiddleware());
router.use("/payments/mpesa/stkpush", sessionMiddleware());
router.use("/payments/mpesa/stkpush/query", sessionMiddleware());
router.use("/payments/mpesa/c2b/register", sessionMiddleware());

// ─── Payment Provider Status ─────────────────────────────────

/** GET /api/payments/providers — which providers are enabled & configured */
router.get("/payments/providers", async (c) => {
  const status = await paymentsSvc.getPaymentProviderStatus();
  return c.json({ data: status });
});

// ─── Paystack ────────────────────────────────────────────────

/** POST /api/payments/paystack/initialize — start a card payment */
router.post("/payments/paystack/initialize", async (c) => {
  const body = await c.req.json();
  const email = body.email;
  const amount = Number(body.amount);
  if (!email || !amount) throw new ValidationError("email and amount are required");

  const result = await paymentsSvc.initializePaystackTransaction(
    email,
    amount,
    body.currency,
    body.metadata,
  );
  return c.json({ data: result });
});

/** POST /api/payments/paystack/verify — confirm payment completed */
router.post("/payments/paystack/verify", async (c) => {
  const body = await c.req.json();
  if (!body.reference) throw new ValidationError("reference is required");

  const result = await paymentsSvc.verifyPaystackTransaction(body.reference);

  // If verified and an orderId was provided, mark the order as paid
  if (result.verified && body.orderId) {
    try {
      await markOrderPaid(body.orderId, body.reference, result.channel ?? "card");
    } catch (err) {
      console.error("Failed to update order payment status after Paystack verify:", err);
    }
  }

  return c.json({ data: result });
});

// ─── M-Pesa Daraja ───────────────────────────────────────────

/** POST /api/payments/mpesa/stkpush — initiate STK Push to customer phone */
router.post("/payments/mpesa/stkpush", async (c) => {
  const body = await c.req.json();
  const phoneNumber = body.phoneNumber?.replace(/\s|-/g, "");
  const amount = Number(body.amount);

  if (!phoneNumber) throw new ValidationError("phoneNumber is required (format: 254XXXXXXXXX)");
  if (!amount || amount <= 0) throw new ValidationError("amount must be a positive number");

  // Normalize Kenyan phone numbers: 07XX → 2547XX, +254 → 254
  let normalizedPhone = phoneNumber;
  if (normalizedPhone.startsWith("+")) normalizedPhone = normalizedPhone.slice(1);
  if (normalizedPhone.startsWith("0")) normalizedPhone = "254" + normalizedPhone.slice(1);

  const result = await paymentsSvc.initiateSTKPush({
    phoneNumber: normalizedPhone,
    amount,
    accountReference: body.accountReference ?? body.orderId ?? "Payment",
    transactionDesc: body.description ?? "POS Payment",
    orderId: body.orderId,
  });

  // Store checkoutRequestId → orderId so the callback can update the order
  if (result.success && result.checkoutRequestId && body.orderId) {
    storePendingSTK(result.checkoutRequestId, body.orderId);
  }

  return c.json({ data: result });
});

/** POST /api/payments/mpesa/stkpush/query — check STK Push status */
router.post("/payments/mpesa/stkpush/query", async (c) => {
  const body = await c.req.json();
  if (!body.checkoutRequestId) throw new ValidationError("checkoutRequestId is required");

  const result = await paymentsSvc.querySTKPushStatus(body.checkoutRequestId);
  return c.json({ data: result });
});

/** POST /api/payments/mpesa/c2b/register — register C2B callback URLs */
router.post("/payments/mpesa/c2b/register", async (c) => {
  const body = await c.req.json();
  if (!body.validationUrl || !body.confirmationUrl) {
    throw new ValidationError("validationUrl and confirmationUrl are required");
  }
  const result = await paymentsSvc.registerC2BUrls(body.validationUrl, body.confirmationUrl);
  return c.json({ data: result });
});

// ─── M-Pesa Callbacks (for Daraja to call back) ─────────────

/** POST /api/payments/mpesa/callback — STK Push result callback from Safaricom */
router.post("/payments/mpesa/callback", async (c) => {
  // Always respond 200 immediately — Safaricom retries on non-200
  const body = await c.req.json();
  const callback = body?.Body?.stkCallback;

  if (callback) {
    const resultCode = Number(callback.ResultCode);
    const checkoutRequestId: string = callback.CheckoutRequestID ?? "";

    if (resultCode === 0) {
      // Payment successful — extract receipt number from CallbackMetadata
      const items: Array<{ Name: string; Value: unknown }> =
        callback.CallbackMetadata?.Item ?? [];
      const get = (name: string) =>
        items.find((i) => i.Name === name)?.Value as string | number | undefined;

      const receiptNumber = String(get("MpesaReceiptNumber") ?? "");
      const amount = Number(get("Amount") ?? 0);
      const phone = String(get("PhoneNumber") ?? "");

      // Find the order via the pending map
      const pending = pendingSTKPushes.get(checkoutRequestId);
      if (pending && Date.now() < pending.expiresAt) {
        try {
          await markOrderPaid(pending.orderId, receiptNumber, "mpesa");
          pendingSTKPushes.delete(checkoutRequestId);
        } catch (err) {
          console.error("Failed to update order payment status:", err);
        }
      }

      console.log(`M-Pesa STK paid: receipt=${receiptNumber} amount=${amount} phone=${phone}`);
    } else {
      console.log(`M-Pesa STK failed: ResultCode=${resultCode} Desc=${callback.ResultDesc}`);
      pendingSTKPushes.delete(checkoutRequestId);
    }
  }

  return c.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/** POST /api/payments/mpesa/c2b/confirmation — C2B (Till/Paybill) payment from Safaricom */
router.post("/payments/mpesa/c2b/confirmation", async (c) => {
  const body = await c.req.json();
  // Daraja C2B confirmation payload:
  // { TransactionType, TransID, TransTime, TransAmount, BusinessShortCode,
  //   BillRefNumber, InvoiceNumber, OrgAccountBalance, MSISDN, FirstName, LastName }

  const transId: string = body.TransID ?? "";
  const amount = Number(body.TransAmount ?? 0);
  const billRef: string = body.BillRefNumber ?? "";
  const phone: string = body.MSISDN ?? "";

  if (transId && billRef) {
    try {
      const orderId = await findOrderByReference(billRef);
      if (orderId) {
        await markOrderPaid(orderId, transId, "mpesa");
      } else {
        console.warn(`M-Pesa C2B: no order found for BillRefNumber="${billRef}" amount=${amount} phone=${phone}`);
      }
    } catch (err) {
      console.error("M-Pesa C2B confirmation error:", err);
    }
  }

  return c.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/** POST /api/payments/mpesa/c2b/validation — C2B payment validation from Safaricom */
router.post("/payments/mpesa/c2b/validation", async (c) => {
  // Return 0 to accept, non-zero to reject
  return c.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

export default router;
