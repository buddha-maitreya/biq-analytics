import { createRouter } from "@agentuity/runtime";
import { errorMiddleware, ValidationError } from "@lib/errors";
import { authMiddleware } from "@services/auth";
import * as paymentsSvc from "@services/payments-integration";

const router = createRouter();
router.use(errorMiddleware());
router.use(authMiddleware());

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
  const body = await c.req.json();
  // In production: parse ResultCode, MpesaReceiptNumber, update order payment status
  // The callback body shape from Daraja:
  // { Body: { stkCallback: { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } } }
  const callback = body?.Body?.stkCallback;
  if (callback) {
    const resultCode = callback.ResultCode;
    const resultDesc = callback.ResultDesc;
    // TODO: Update order payment status in database
    // if (resultCode === 0) { /* Payment successful */ }
    console.log(`M-Pesa STK Callback: ResultCode=${resultCode}, Desc=${resultDesc}`);
  }
  // Always respond with success to Safaricom
  return c.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/** POST /api/payments/mpesa/c2b/confirmation — C2B payment confirmation from Safaricom */
router.post("/payments/mpesa/c2b/confirmation", async (c) => {
  const body = await c.req.json();
  // In production: record the payment, update order status
  // Body contains: TransactionType, TransID, TransTime, TransAmount, BusinessShortCode, BillRefNumber, etc.
  console.log("M-Pesa C2B Confirmation:", JSON.stringify(body));
  return c.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

/** POST /api/payments/mpesa/c2b/validation — C2B payment validation from Safaricom */
router.post("/payments/mpesa/c2b/validation", async (c) => {
  // Return 0 to accept, non-zero to reject
  return c.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

export default router;
