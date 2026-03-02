/**
 * Payment Integration Service — Paystack + M-Pesa (Daraja API)
 *
 * This service provides placeholder integrations for:
 * 1. Paystack — Card payments (initialized server-side, completed client-side via Paystack Inline)
 * 2. Safaricom Daraja — M-Pesa STK Push, Till (Buy Goods), and Paybill payments
 *
 * All API keys are stored in business_settings and loaded at runtime.
 * In production, secrets (secret keys, consumer secrets) should also be
 * stored as Agentuity secrets via `agentuity cloud secret set`.
 */

import * as settingsSvc from "@services/settings";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface PaystackConfig {
  enabled: boolean;
  publicKey: string;
  secretKey: string;
  currency: string;
}

export type MpesaPaymentType = "till" | "paybill" | "both";

export interface MpesaConfig {
  enabled: boolean;
  environment: "sandbox" | "production";
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  paymentType: MpesaPaymentType;
  tillNumber: string;
  paybillNumber: string;
  accountReference: string;
  callbackUrl: string;
}

export interface PaymentProviderStatus {
  paystack: { enabled: boolean; configured: boolean };
  mpesa: { enabled: boolean; configured: boolean; paymentType: MpesaPaymentType };
}

export interface InitPaystackResult {
  reference: string;
  publicKey: string;
  amount: number;   // in smallest currency unit (e.g. kobo, cents)
  currency: string;
  email: string;
}

export interface StkPushRequest {
  phoneNumber: string;   // format: 254XXXXXXXXX
  amount: number;
  accountReference: string;
  transactionDesc: string;
  orderId?: string;
}

export interface StkPushResult {
  success: boolean;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  responseDescription: string;
  customerMessage?: string;
}

export interface StkQueryResult {
  completed: boolean;
  resultCode: number;
  resultDesc: string;
  mpesaReceiptNumber?: string;
}

// ═══════════════════════════════════════════════════════════════
// Config Loaders — read from business_settings
// ═══════════════════════════════════════════════════════════════

/**
 * Config loaders — secret precedence:
 *   1. Agentuity environment variable (set per-client via `agentuity cloud env set`)
 *   2. DB business_settings fallback (for UI-managed non-sensitive config)
 *
 * Secrets (keys, secrets, passkeys) MUST come from env vars in production.
 * Non-sensitive config (currency, payment type, display names) can use DB.
 * This supports the single-tenant deployment model: one Agentuity project per client.
 */

export async function getPaystackConfig(): Promise<PaystackConfig> {
  const s = await settingsSvc.getAllSettings();
  return {
    // Sensitive: env var takes precedence — never shipped in code
    enabled: process.env.PAYSTACK_ENABLED === "true" || s.paystackEnabled === "true",
    publicKey: process.env.PAYSTACK_PUBLIC_KEY ?? s.paystackPublicKey ?? "",
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? s.paystackSecretKey ?? "",
    // Non-sensitive: DB / env both fine
    currency: process.env.PAYSTACK_CURRENCY ?? s.paystackCurrency ?? "KES",
  };
}

export async function getMpesaConfig(): Promise<MpesaConfig> {
  const s = await settingsSvc.getAllSettings();
  return {
    // Sensitive: Agentuity env vars per client deployment
    enabled: process.env.MPESA_ENABLED === "true" || s.mpesaEnabled === "true",
    environment: (process.env.MPESA_ENVIRONMENT ?? s.mpesaEnvironment ?? "sandbox") as "sandbox" | "production",
    consumerKey: process.env.MPESA_CONSUMER_KEY ?? s.mpesaConsumerKey ?? "",
    consumerSecret: process.env.MPESA_CONSUMER_SECRET ?? s.mpesaConsumerSecret ?? "",
    shortcode: process.env.MPESA_SHORTCODE ?? s.mpesaShortcode ?? "",
    passkey: process.env.MPESA_PASSKEY ?? s.mpesaPasskey ?? "",
    // Non-sensitive: configurable via DB / env
    paymentType: (process.env.MPESA_PAYMENT_TYPE ?? s.mpesaPaymentType ?? "till") as MpesaPaymentType,
    tillNumber: process.env.MPESA_TILL_NUMBER ?? s.mpesaTillNumber ?? "",
    paybillNumber: process.env.MPESA_PAYBILL_NUMBER ?? s.mpesaPaybillNumber ?? "",
    accountReference: process.env.MPESA_ACCOUNT_REFERENCE ?? s.mpesaAccountReference ?? "BusinessIQ",
    callbackUrl: process.env.MPESA_CALLBACK_URL ?? s.mpesaCallbackUrl ?? "",
  };
}

/** Returns which payment providers are enabled + properly configured */
export async function getPaymentProviderStatus(): Promise<PaymentProviderStatus> {
  const [ps, mp] = await Promise.all([getPaystackConfig(), getMpesaConfig()]);
  return {
    paystack: {
      enabled: ps.enabled,
      configured: !!(ps.publicKey && ps.secretKey),
    },
    mpesa: {
      enabled: mp.enabled,
      configured: !!(mp.consumerKey && mp.consumerSecret && mp.shortcode),
      paymentType: mp.paymentType,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Paystack Integration (Placeholder)
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize a Paystack transaction.
 * In production, this calls POST https://api.paystack.co/transaction/initialize
 * Returns the data needed for the frontend Paystack Inline JS popup.
 */
export async function initializePaystackTransaction(
  email: string,
  amount: number,
  currency?: string,
  metadata?: Record<string, unknown>,
): Promise<InitPaystackResult> {
  const config = await getPaystackConfig();
  if (!config.enabled) throw new Error("Paystack is not enabled");
  if (!config.secretKey) throw new Error("Paystack secret key not configured");

  const reference = `PS_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: Math.round(amount * 100), // Paystack uses smallest currency unit (kobo/cents)
      currency: currency ?? config.currency,
      reference,
      metadata,
    }),
  });

  const data = await response.json() as {
    status: boolean;
    message?: string;
    data?: { authorization_url?: string; access_code?: string; reference?: string };
  };

  if (!data.status) throw new Error(data.message ?? "Paystack initialization failed");

  return {
    reference: data.data?.reference ?? reference,
    publicKey: config.publicKey,
    amount: Math.round(amount * 100),
    currency: currency ?? config.currency,
    email,
  };
}

/**
 * Verify a Paystack transaction after the frontend popup succeeds.
 * In production, calls GET https://api.paystack.co/transaction/verify/:reference
 */
export async function verifyPaystackTransaction(reference: string): Promise<{
  verified: boolean;
  amount: number;
  currency: string;
  channel: string;
  paidAt: string;
}> {
  const config = await getPaystackConfig();
  if (!config.secretKey) throw new Error("Paystack secret key not configured");

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${config.secretKey}` },
  });

  const data = await response.json() as {
    status: boolean;
    message?: string;
    data?: {
      status?: string;
      amount?: number;
      currency?: string;
      channel?: string;
      paid_at?: string;
    };
  };

  if (!data.status) throw new Error(data.message ?? "Paystack verification failed");

  return {
    verified: data.data?.status === "success",
    amount: (data.data?.amount ?? 0) / 100,
    currency: data.data?.currency ?? config.currency,
    channel: data.data?.channel ?? "card",
    paidAt: data.data?.paid_at ?? new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// M-Pesa Daraja Integration (Placeholder)
// ═══════════════════════════════════════════════════════════════

// ── Access token cache (tokens are valid for 3600s; refresh at 80% of TTL) ──
let _mpesaToken: string | null = null;
let _mpesaTokenExpiresAt = 0;

/**
 * Get M-Pesa OAuth access token.
 * Cached in-process for ~48 minutes (80% of the 3600s token lifetime).
 */
async function getMpesaAccessToken(): Promise<string> {
  if (_mpesaToken && Date.now() < _mpesaTokenExpiresAt) return _mpesaToken;

  const config = await getMpesaConfig();
  const baseUrl = config.environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
  const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!response.ok) {
    throw new Error(`M-Pesa OAuth failed: HTTP ${response.status}`);
  }
  const data = await response.json() as { access_token?: string; errorCode?: string; errorMessage?: string };
  if (!data.access_token) {
    throw new Error(`M-Pesa OAuth error: ${data.errorMessage ?? JSON.stringify(data)}`);
  }

  _mpesaToken = data.access_token;
  _mpesaTokenExpiresAt = Date.now() + 48 * 60 * 1000; // cache 48 min
  return _mpesaToken;
}

/**
 * Initiate an M-Pesa STK Push (Lipa Na M-Pesa Online).
 * The customer receives a prompt on their phone to enter their M-Pesa PIN.
 *
 * Works for both Till (Buy Goods) and Paybill depending on config.
 */
export async function initiateSTKPush(request: StkPushRequest): Promise<StkPushResult> {
  const config = await getMpesaConfig();
  if (!config.enabled) throw new Error("M-Pesa is not enabled");
  if (!config.consumerKey || !config.consumerSecret) {
    throw new Error("M-Pesa API credentials not configured");
  }

  const accessToken = await getMpesaAccessToken();
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
  const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString("base64");

  // Determine the command based on payment type
  const businessShortCode = config.shortcode;
  const commandID = config.paymentType === "paybill"
    ? "CustomerPayBillOnline"
    : "CustomerBuyGoodsOnline";

  // For paybill: PartyB = paybillNumber. For till: PartyB = tillNumber
  const partyB = config.paymentType === "paybill"
    ? config.paybillNumber || config.shortcode
    : config.tillNumber || config.shortcode;

  const baseUrl = config.environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

  const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: commandID,
      Amount: Math.ceil(request.amount),
      PartyA: request.phoneNumber,
      PartyB: partyB,
      PhoneNumber: request.phoneNumber,
      CallBackURL: config.callbackUrl,
      AccountReference: request.accountReference || config.accountReference,
      TransactionDesc: request.transactionDesc || "Payment",
    }),
  });

  const data = await response.json() as {
    ResponseCode?: string;
    ResponseDescription?: string;
    CustomerMessage?: string;
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
    errorCode?: string;
    errorMessage?: string;
  };

  if (data.ResponseCode !== "0") {
    return {
      success: false,
      responseDescription: data.errorMessage ?? data.ResponseDescription ?? "STK Push request failed",
    };
  }

  return {
    success: true,
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
    responseDescription: data.ResponseDescription ?? "Success. Request accepted for processing",
    customerMessage: data.CustomerMessage ?? `Check your phone (${request.phoneNumber}) to complete payment.`,
  };
}

/**
 * Query the status of an STK Push transaction.
 * Call this to check if the customer completed the M-Pesa payment.
 */
export async function querySTKPushStatus(checkoutRequestId: string): Promise<StkQueryResult> {
  const config = await getMpesaConfig();
  const accessToken = await getMpesaAccessToken();
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
  const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString("base64");

  const baseUrl = config.environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

  const response = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });

  const data = await response.json() as {
    ResultCode?: string | number;
    ResultDesc?: string;
    errorCode?: string;
    errorMessage?: string;
  };

  const resultCode = Number(data.ResultCode ?? -1);
  return {
    completed: resultCode === 0 || resultCode === 1032, // 1032 = cancelled by user (also final)
    resultCode,
    resultDesc: data.ResultDesc ?? data.errorMessage ?? "Unknown result",
  };
}

/**
 * Register C2B URLs for Till/Paybill confirmation and validation.
 * This is typically done once during setup.
 */
export async function registerC2BUrls(
  validationUrl: string,
  confirmationUrl: string,
): Promise<{ success: boolean; message: string }> {
  const config = await getMpesaConfig();
  const accessToken = await getMpesaAccessToken();

  const baseUrl = config.environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

  const response = await fetch(`${baseUrl}/mpesa/c2b/v1/registerurl`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ShortCode: config.shortcode,
      ResponseType: "Completed",
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl,
    }),
  });

  const data = await response.json() as {
    ResponseCode?: string;
    ResponseDescription?: string;
    errorCode?: string;
    errorMessage?: string;
  };

  if (data.ResponseCode !== "0") {
    return {
      success: false,
      message: data.errorMessage ?? data.ResponseDescription ?? "C2B registration failed",
    };
  }

  return { success: true, message: data.ResponseDescription ?? "C2B URLs registered successfully" };
}
