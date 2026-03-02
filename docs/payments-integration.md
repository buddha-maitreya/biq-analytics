# Payment Integration — M-Pesa & Paystack

> Last updated: 2026-03-02
> Status: Production-ready (live API calls implemented)

---

## Architecture — Single-Tenant Model

Each client runs as their **own Agentuity project**. Their credentials are set as
Agentuity environment variables and never touch the codebase or the database.

```
agentuity cloud env set MPESA_CONSUMER_KEY=abc123         # client-specific
agentuity cloud env set MPESA_CONSUMER_SECRET=xyz789
agentuity cloud env set PAYSTACK_SECRET_KEY=sk_live_...
```

Config precedence in `payments-integration.ts`:
1. **Agentuity env var** (always wins — credentials live here)
2. **DB business_settings** (fallback for non-sensitive UI-managed config)

Sensitive values (keys, secrets, passkeys) → env vars only.
Non-sensitive config (currency, payment type, labels) → DB or env.

---

## M-Pesa (Safaricom Daraja)

### Required Env Vars

| Variable | Description |
|----------|-------------|
| `MPESA_ENABLED` | `true` to enable |
| `MPESA_ENVIRONMENT` | `sandbox` or `production` |
| `MPESA_CONSUMER_KEY` | From Daraja developer portal |
| `MPESA_CONSUMER_SECRET` | From Daraja developer portal |
| `MPESA_SHORTCODE` | Your till or paybill number |
| `MPESA_PASSKEY` | Lipa Na M-Pesa passkey from Daraja |
| `MPESA_PAYMENT_TYPE` | `till` (Buy Goods) or `paybill` |
| `MPESA_TILL_NUMBER` | If payment_type=till |
| `MPESA_PAYBILL_NUMBER` | If payment_type=paybill |
| `MPESA_ACCOUNT_REFERENCE` | Text shown on customer receipt (e.g. shop name) |
| `MPESA_CALLBACK_URL` | `https://YOUR_DOMAIN/api/payments/mpesa/callback` |

### How STK Push Works

```
Frontend: POST /api/payments/mpesa/stkpush { phoneNumber, amount, orderId }
  → Daraja OAuth token fetched (cached 48 min)
  → POST https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest
  → Customer phone receives PIN prompt
  → checkoutRequestId stored in pendingSTKPushes Map (10 min TTL)
  → Returns: { checkoutRequestId, merchantRequestId, customerMessage }

Safaricom: POST /api/payments/mpesa/callback (unauthenticated — no session required)
  → Parses CallbackMetadata: Amount, MpesaReceiptNumber, PhoneNumber
  → If ResultCode=0: looks up orderId from pendingSTKPushes Map
  → Updates orders.paymentStatus = "paid", orders.paymentReference = receiptNumber
  → Always returns { ResultCode: 0, ResultDesc: "Accepted" }
```

### How C2B (Till/Paybill) Works

Customer walks to till, pays physically, enters your till/paybill number:

```
Safaricom: POST /api/payments/mpesa/c2b/confirmation
  → Parses: TransID (receipt), TransAmount, BillRefNumber (order number), MSISDN (phone)
  → Looks up order by BillRefNumber (order_number column)
  → Updates orders.paymentStatus = "paid", orders.paymentReference = TransID
```

**Important:** BillRefNumber must match your order number format exactly.
Customers should enter the order number when paying at the till.

### C2B URL Registration (one-time setup)

```bash
POST /api/payments/mpesa/c2b/register
{ "validationUrl": "https://YOUR_DOMAIN/api/payments/mpesa/c2b/validation",
  "confirmationUrl": "https://YOUR_DOMAIN/api/payments/mpesa/c2b/confirmation" }
```

Run this once after deploying with production credentials.

### Daraja API Reference

- Developer Portal: https://developer.safaricom.co.ke
- STK Push endpoint: `POST /mpesa/stkpush/v1/processrequest`
- STK Query: `POST /mpesa/stkpushquery/v1/query`
- C2B Register: `POST /mpesa/c2b/v1/registerurl`
- OAuth: `GET /oauth/v1/generate?grant_type=client_credentials`
- Sandbox base: `https://sandbox.safaricom.co.ke`
- Production base: `https://api.safaricom.co.ke`

---

## Paystack (Card Payments)

### Required Env Vars

| Variable | Description |
|----------|-------------|
| `PAYSTACK_ENABLED` | `true` to enable |
| `PAYSTACK_PUBLIC_KEY` | `pk_live_...` — safe for frontend |
| `PAYSTACK_SECRET_KEY` | `sk_live_...` — backend only, never expose |
| `PAYSTACK_CURRENCY` | `KES` for Kenya |

### How Card Payment Works

```
Frontend: POST /api/payments/paystack/initialize { email, amount, orderId, metadata }
  → POST https://api.paystack.co/transaction/initialize
  → Returns: { reference, publicKey, amount, currency, email }
  → Frontend opens Paystack Inline popup using publicKey + reference

Customer completes payment in popup:
Frontend: POST /api/payments/paystack/verify { reference, orderId }
  → GET https://api.paystack.co/transaction/verify/{reference}
  → If verified: updates orders.paymentStatus = "paid", paymentReference = reference
  → Returns: { verified, amount, currency, channel, paidAt }
```

### Paystack Webhook IP Whitelist

Paystack only sends webhooks from these IPs — whitelist in your firewall:
- `52.31.139.75`
- `52.49.173.169`
- `52.214.14.220`

### Paystack API Reference

- Dashboard: https://dashboard.paystack.com/#/settings/developers
- Initialize: `POST https://api.paystack.co/transaction/initialize`
- Verify: `GET https://api.paystack.co/transaction/verify/:reference`
- Webhook signature: HMAC SHA-512 of request body using secret key
  (validated in `src/services/pos-adapters/adapter-paystack.ts`)

---

## What's NOT Implemented (Phase 2)

| Feature | Notes |
|---------|-------|
| iKhokha adapter | `adapter-ikhokha.ts` missing |
| eTIMS/iTax adapter | KRA compliance adapter missing |
| Africa's Talking SMS alerts | Low-stock SMS not implemented |
| Payment reconciliation | Can't match POS sales to bank settlement statements |
| Partial refunds | Return system handles full returns only |
| Offline conflict resolution | Manual review required for offline POS replays |

---

## Security Notes

- Callback endpoints (`/mpesa/callback`, `/c2b/confirmation`, `/c2b/validation`) are
  intentionally public — they are called by Safaricom servers with no session cookie.
- Authenticated endpoints (STK push initiation, Paystack initialize/verify, provider status)
  require a valid session cookie.
- M-Pesa IP whitelisting is not yet implemented (Safaricom uses source IP for C2B, not HMAC).
  In production, add IP validation middleware using Safaricom's published IP ranges.
- Never store `MPESA_CONSUMER_SECRET` or `PAYSTACK_SECRET_KEY` in the database or code.
  Always use `agentuity cloud env set`.
