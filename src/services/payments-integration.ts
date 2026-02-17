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

export async function getPaystackConfig(): Promise<PaystackConfig> {
  const s = await settingsSvc.getAllSettings();
  return {
    enabled: s.paystackEnabled === "true",
    publicKey: s.paystackPublicKey ?? "",
    secretKey: s.paystackSecretKey ?? "",
    currency: s.paystackCurrency ?? "KES",
  };
}

export async function getMpesaConfig(): Promise<MpesaConfig> {
  const s = await settingsSvc.getAllSettings();
  return {
    enabled: s.mpesaEnabled === "true",
    environment: (s.mpesaEnvironment as "sandbox" | "production") ?? "sandbox",
    consumerKey: s.mpesaConsumerKey ?? "",
    consumerSecret: s.mpesaConsumerSecret ?? "",
    shortcode: s.mpesaShortcode ?? "",
    passkey: s.mpesaPasskey ?? "",
    paymentType: (s.mpesaPaymentType as MpesaPaymentType) ?? "till",
    tillNumber: s.mpesaTillNumber ?? "",
    paybillNumber: s.mpesaPaybillNumber ?? "",
    accountReference: s.mpesaAccountReference ?? "BusinessIQ",
    callbackUrl: s.mpesaCallbackUrl ?? "",
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

  // ── PLACEHOLDER: Replace with actual Paystack API call ──
  // const response = await fetch("https://api.paystack.co/transaction/initialize", {
  //   method: "POST",
  //   headers: {
  //     Authorization: `Bearer ${config.secretKey}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     email,
  //     amount: Math.round(amount * 100), // Convert to smallest unit
  //     currency: currency ?? config.currency,
  //     reference,
  //     metadata,
  //   }),
  // });
  // const data = await response.json();
  // if (!data.status) throw new Error(data.message ?? "Paystack initialization failed");

  return {
    reference,
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

  // ── PLACEHOLDER: Replace with actual Paystack verification ──
  // const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
  //   headers: { Authorization: `Bearer ${config.secretKey}` },
  // });
  // const data = await response.json();
  // return {
  //   verified: data.data?.status === "success",
  //   amount: data.data?.amount / 100,
  //   currency: data.data?.currency,
  //   channel: data.data?.channel,
  //   paidAt: data.data?.paid_at,
  // };

  return {
    verified: true,
    amount: 0,
    currency: config.currency,
    channel: "card",
    paidAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// M-Pesa Daraja Integration (Placeholder)
// ═══════════════════════════════════════════════════════════════

/**
 * Get M-Pesa OAuth access token.
 * In production: GET https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials
 * Sandbox:       GET https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials
 */
async function getMpesaAccessToken(): Promise<string> {
  const config = await getMpesaConfig();
  const baseUrl = config.environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

  // ── PLACEHOLDER: Replace with actual Daraja OAuth call ──
  // const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
  // const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
  //   headers: { Authorization: `Basic ${credentials}` },
  // });
  // const data = await response.json();
  // return data.access_token;

  void baseUrl;
  return "PLACEHOLDER_ACCESS_TOKEN";
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

  // ── PLACEHOLDER: Replace with actual Daraja STK Push call ──
  // const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
  //   method: "POST",
  //   headers: {
  //     Authorization: `Bearer ${accessToken}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     BusinessShortCode: businessShortCode,
  //     Password: password,
  //     Timestamp: timestamp,
  //     TransactionType: commandID,
  //     Amount: Math.ceil(request.amount),
  //     PartyA: request.phoneNumber,
  //     PartyB: partyB,
  //     PhoneNumber: request.phoneNumber,
  //     CallBackURL: config.callbackUrl,
  //     AccountReference: request.accountReference || config.accountReference,
  //     TransactionDesc: request.transactionDesc || "Payment",
  //   }),
  // });
  // const data = await response.json();

  // Suppress unused variable warnings for placeholder
  void accessToken;
  void password;
  void businessShortCode;
  void commandID;
  void partyB;
  void baseUrl;

  // Simulated success response matching Daraja API format
  return {
    success: true,
    checkoutRequestId: `ws_CO_${timestamp}_${config.shortcode}_${Math.random().toString(36).slice(2, 8)}`,
    merchantRequestId: `MR_${Date.now()}`,
    responseDescription: "Success. Request accepted for processing",
    customerMessage: `Success. Request accepted for processing. Check your phone (${request.phoneNumber}) to complete payment.`,
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

  // ── PLACEHOLDER: Replace with actual Daraja STK Query call ──
  // const response = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
  //   method: "POST",
  //   headers: {
  //     Authorization: `Bearer ${accessToken}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     BusinessShortCode: config.shortcode,
  //     Password: password,
  //     Timestamp: timestamp,
  //     CheckoutRequestID: checkoutRequestId,
  //   }),
  // });
  // const data = await response.json();

  void accessToken;
  void password;
  void baseUrl;
  void checkoutRequestId;

  // Simulated completed response
  return {
    completed: true,
    resultCode: 0,
    resultDesc: "The service request is processed successfully.",
    mpesaReceiptNumber: `QHL${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
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

  // ── PLACEHOLDER: Replace with actual Daraja C2B registration ──
  // const response = await fetch(`${baseUrl}/mpesa/c2b/v1/registerurl`, {
  //   method: "POST",
  //   headers: {
  //     Authorization: `Bearer ${accessToken}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     ShortCode: config.shortcode,
  //     ResponseType: "Completed",
  //     ConfirmationURL: confirmationUrl,
  //     ValidationURL: validationUrl,
  //   }),
  // });

  void accessToken;
  void baseUrl;
  void validationUrl;
  void confirmationUrl;

  return { success: true, message: "C2B URLs registered successfully (placeholder)" };
}
