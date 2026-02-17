/**
 * KRA (Kenya Revenue Authority) & eTIMS Integration Service
 *
 * Placeholder integrations for the developer.go.ke API catalog.
 * All methods return mock/simulated data. In production, replace with
 * real HTTP calls to the KRA API gateway.
 *
 * Relevant KRA APIs from developer.go.ke:
 *  1. Authorization           — OAuth token generation for all KRA APIs
 *  2. eTIMS OSCU Integration  — Real-time invoice/receipt submission (the big one)
 *  3. PIN Checker by PIN      — Validate customer/supplier KRA PINs
 *  4. Tax Compliance Cert     — Verify TCC validity
 *  5. Invoice Checker         — Query eTIMS invoice details by invoice number
 *  6. VAT Withholding PRN     — Generate payment reference for VAT withholding
 */

import * as settingsSvc from "./settings";

// ════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════

export interface KraConfig {
  enabled: boolean;
  environment: "sandbox" | "production";
  /** KRA API username/client ID */
  clientId: string;
  /** KRA API secret */
  clientSecret: string;
  /** eTIMS device serial number (assigned by KRA to the taxpayer's OSCU) */
  etimsDeviceSerial: string;
  /** KRA PIN of the business (taxpayer) */
  businessPin: string;
  /** eTIMS branch ID */
  branchId: string;
}

export interface KraAuthToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
}

export interface PinValidationResult {
  valid: boolean;
  pin: string;
  taxpayerName: string | null;
  taxObligations: string[];
  status: "active" | "inactive" | "dormant" | "unknown";
  message: string;
}

export interface TccValidationResult {
  valid: boolean;
  pin: string;
  certificateNumber: string;
  taxpayerName: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  status: "valid" | "expired" | "revoked" | "not_found";
  message: string;
}

export interface EtimsInvoice {
  /** Internal/local invoice number */
  localInvoiceNumber: string;
  /** KRA-assigned Control Unit Invoice Number (CUIN) */
  cuInvoiceNumber: string | null;
  /** QR code data for the fiscal receipt */
  qrCode: string | null;
  /** SCU (Signature Creation Unit) signature */
  scuSignature: string | null;
  /** Date/time the invoice was signed by eTIMS */
  signedAt: string | null;
  status: "pending" | "submitted" | "accepted" | "rejected" | "error";
  errorMessage: string | null;
}

export interface EtimsSubmissionRequest {
  /** Local invoice/receipt number */
  invoiceNumber: string;
  /** Invoice date (ISO 8601) */
  invoiceDate: string;
  /** Seller KRA PIN */
  sellerPin: string;
  /** Buyer KRA PIN (optional for B2C under threshold) */
  buyerPin?: string;
  /** Buyer name */
  buyerName?: string;
  /** Invoice type: normal, credit_note, debit_note */
  invoiceType: "normal" | "credit_note" | "debit_note";
  /** Transaction type: sale, refund */
  transactionType: "sale" | "refund";
  /** Payment method used */
  paymentMethod: string;
  /** Line items */
  items: Array<{
    itemName: string;
    itemCode: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    /** KRA tax category code */
    taxCode: string;
    taxRate: number;
    taxAmount: number;
    totalAmount: number;
  }>;
  /** Totals */
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
}

export interface EtimsSubmissionResult {
  success: boolean;
  cuInvoiceNumber: string | null;
  qrCode: string | null;
  scuSignature: string | null;
  signedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Matches the real KRA Invoice Checker response.
 * POST https://sbx.kra.go.ke/checker/v1/invoice
 *
 * Response codes:
 *  40000 = Success
 *  40001 = Invoice not found
 *  40005 = Unable to process request
 *  50000 = Internal server error
 */
export interface InvoiceCheckResult {
  responseCode: number;
  responseDesc: string;
  status: "OK" | "ERROR";
  invoiceDetails: {
    salesDate: string | null;
    transmissionDate: string | null;
    invoiceDate: string | null;
    totalItemCount: number;
    supplierPIN: string | null;
    supplierName: string | null;
    deviceSerialNumber: string | null;
    customerPin: string | null;
    customerName: string | null;
    controlUnitInvoiceNumber: string | null;
    traderSystemInvoiceNumber: string | null;
    totalInvoiceAmount: number | null;
    totalTaxableAmount: number | null;
    totalTaxAmount: number | null;
    exemptionCertificateNo: string | null;
    totalDiscountAmount: number | null;
    itemDetails: unknown[];
  } | null;
}

export interface VatWithholdingPrnResult {
  success: boolean;
  prn: string | null;
  amount: number;
  supplierPin: string;
  expiryDate: string | null;
  message: string;
}

export interface KraProviderStatus {
  kra: {
    enabled: boolean;
    configured: boolean;
    environment: string;
    etimsDeviceSerial: string;
    businessPin: string;
  };
}

// ════════════════════════════════════════════════════════════════
// Config Loader
// ════════════════════════════════════════════════════════════════

const KRA_SANDBOX_URL = "https://sandbox.kra.go.ke/api";
const KRA_PRODUCTION_URL = "https://api.kra.go.ke/api";

export async function getKraConfig(): Promise<KraConfig> {
  const s = await settingsSvc.getAllSettings();

  return {
    enabled: s.kraEnabled === "true",
    environment: (s.kraEnvironment as "sandbox" | "production") || "sandbox",
    clientId: s.kraClientId || "",
    clientSecret: s.kraClientSecret || "",
    etimsDeviceSerial: s.kraEtimsDeviceSerial || "",
    businessPin: s.kraBusinessPin || "",
    branchId: s.kraBranchId || "00",
  };
}

export function getKraBaseUrl(environment: "sandbox" | "production"): string {
  return environment === "production" ? KRA_PRODUCTION_URL : KRA_SANDBOX_URL;
}

export async function getKraProviderStatus(): Promise<KraProviderStatus> {
  const cfg = await getKraConfig();
  return {
    kra: {
      enabled: cfg.enabled,
      configured: !!(cfg.clientId && cfg.clientSecret && cfg.businessPin),
      environment: cfg.environment,
      etimsDeviceSerial: cfg.etimsDeviceSerial,
      businessPin: cfg.businessPin,
    },
  };
}

// ════════════════════════════════════════════════════════════════
// 1. KRA Authorization — OAuth Token
// ════════════════════════════════════════════════════════════════

/**
 * Get an OAuth2 access token from KRA API Gateway.
 * All other KRA API calls require this token in the Authorization header.
 *
 * Real API: POST https://api.kra.go.ke/token
 * Headers:  Authorization: Basic base64(clientId:clientSecret)
 * Body:     grant_type=client_credentials
 */
export async function getKraAuthToken(): Promise<KraAuthToken> {
  const cfg = await getKraConfig();

  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error("KRA API credentials not configured. Set Client ID and Secret in Settings → Tax & Compliance.");
  }

  // ── PLACEHOLDER: Return mock token ──
  // In production, replace with:
  //
  // const baseUrl = getKraBaseUrl(cfg.environment);
  // const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  // const res = await fetch(`${baseUrl}/token`, {
  //   method: "POST",
  //   headers: {
  //     "Authorization": `Basic ${credentials}`,
  //     "Content-Type": "application/x-www-form-urlencoded",
  //   },
  //   body: "grant_type=client_credentials",
  // });
  // const data = await res.json();
  // return {
  //   accessToken: data.access_token,
  //   tokenType: data.token_type,
  //   expiresIn: data.expires_in,
  //   expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  // };

  const expiresIn = 3600;
  return {
    accessToken: `kra_mock_token_${Date.now().toString(36)}`,
    tokenType: "Bearer",
    expiresIn,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════
// 2. eTIMS OSCU Integration — Invoice Submission
// ════════════════════════════════════════════════════════════════

/**
 * Submit an invoice/receipt to KRA eTIMS for fiscal signing.
 *
 * This is the core compliance integration. Every sale must be submitted
 * to eTIMS, which returns a Control Unit Invoice Number (CUIN),
 * QR code, and SCU digital signature for the receipt.
 *
 * Real API: POST https://api.kra.go.ke/etims/oscu/invoice/save
 * Headers:  Authorization: Bearer <token>
 * Body:     eTIMS-specific JSON schema (see KRA eTIMS Technical Guide)
 */
export async function submitEtimsInvoice(
  request: EtimsSubmissionRequest
): Promise<EtimsSubmissionResult> {
  const cfg = await getKraConfig();

  if (!cfg.enabled) {
    return {
      success: false,
      cuInvoiceNumber: null,
      qrCode: null,
      scuSignature: null,
      signedAt: null,
      errorCode: "DISABLED",
      errorMessage: "eTIMS integration is not enabled. Enable it in Settings → Tax & Compliance.",
    };
  }

  if (!cfg.etimsDeviceSerial || !cfg.businessPin) {
    return {
      success: false,
      cuInvoiceNumber: null,
      qrCode: null,
      scuSignature: null,
      signedAt: null,
      errorCode: "NOT_CONFIGURED",
      errorMessage: "eTIMS device serial and business PIN must be configured.",
    };
  }

  // ── PLACEHOLDER: Return mock eTIMS response ──
  // In production, replace with:
  //
  // const token = await getKraAuthToken();
  // const baseUrl = getKraBaseUrl(cfg.environment);
  // const res = await fetch(`${baseUrl}/etims/oscu/invoice/save`, {
  //   method: "POST",
  //   headers: {
  //     "Authorization": `${token.tokenType} ${token.accessToken}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     tin: cfg.businessPin,
  //     bhfId: cfg.branchId,
  //     dvcSrlNo: cfg.etimsDeviceSerial,
  //     invcNo: request.invoiceNumber,
  //     orgInvcNo: request.invoiceType === "credit_note" ? request.invoiceNumber : undefined,
  //     custTin: request.buyerPin || "",
  //     custNm: request.buyerName || "Walk-in Customer",
  //     rcptTyCd: request.transactionType === "sale" ? "S" : "R",
  //     pmtTyCd: mapPaymentMethod(request.paymentMethod),
  //     salesDt: request.invoiceDate,
  //     itemList: request.items.map((item, idx) => ({
  //       itemSeq: idx + 1,
  //       itemCd: item.itemCode,
  //       itemNm: item.itemName,
  //       qty: item.quantity,
  //       prc: item.unitPrice,
  //       dcRt: 0,
  //       dcAmt: item.discount,
  //       taxTyCd: item.taxCode,
  //       taxAmt: item.taxAmount,
  //       totAmt: item.totalAmount,
  //     })),
  //     totItemCnt: request.items.length,
  //     totTaxblAmt: request.subtotal,
  //     totTaxAmt: request.taxAmount,
  //     totDcAmt: request.discountAmount,
  //     totAmt: request.totalAmount,
  //   }),
  // });
  // const data = await res.json();
  // if (data.resultCd === "000") {
  //   return {
  //     success: true,
  //     cuInvoiceNumber: data.data?.intrlData,
  //     qrCode: data.data?.rcptSign,
  //     scuSignature: data.data?.sdcId,
  //     signedAt: new Date().toISOString(),
  //     errorCode: null,
  //     errorMessage: null,
  //   };
  // }

  const cuInvoiceNumber = `CU${cfg.branchId}${Date.now().toString(36).toUpperCase()}`;
  const signedAt = new Date().toISOString();

  return {
    success: true,
    cuInvoiceNumber,
    qrCode: `https://etims.kra.go.ke/verify/${cuInvoiceNumber}`,
    scuSignature: `SCU-${cfg.etimsDeviceSerial}-${Date.now().toString(36)}`,
    signedAt,
    errorCode: null,
    errorMessage: null,
  };
}

/**
 * Query status of a previously submitted eTIMS invoice.
 *
 * Real API: POST https://api.kra.go.ke/etims/oscu/invoice/lookup
 */
export async function queryEtimsInvoice(invoiceNumber: string): Promise<EtimsInvoice> {
  const cfg = await getKraConfig();

  // ── PLACEHOLDER ──
  // In production:
  //
  // const token = await getKraAuthToken();
  // const baseUrl = getKraBaseUrl(cfg.environment);
  // const res = await fetch(`${baseUrl}/etims/oscu/invoice/lookup`, {
  //   method: "POST",
  //   headers: {
  //     "Authorization": `${token.tokenType} ${token.accessToken}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({ tin: cfg.businessPin, bhfId: cfg.branchId, invcNo: invoiceNumber }),
  // });

  return {
    localInvoiceNumber: invoiceNumber,
    cuInvoiceNumber: `CU${cfg.branchId}-MOCK-${invoiceNumber}`,
    qrCode: `https://etims.kra.go.ke/verify/CU${cfg.branchId}-MOCK-${invoiceNumber}`,
    scuSignature: `SCU-MOCK-${invoiceNumber}`,
    signedAt: new Date().toISOString(),
    status: "accepted",
    errorMessage: null,
  };
}

// ════════════════════════════════════════════════════════════════
// 3. PIN Checker — Validate KRA PIN
// ════════════════════════════════════════════════════════════════

/**
 * Validate a KRA PIN and retrieve basic taxpayer info.
 * Useful for verifying customer/supplier PINs before transactions.
 *
 * Real API: GET https://api.kra.go.ke/pin-checker/query/{pin}
 * Headers:  Authorization: Bearer <token>
 */
export async function validatePin(pin: string): Promise<PinValidationResult> {
  if (!pin || !/^[A-Z]\d{9}[A-Z]$/i.test(pin)) {
    return {
      valid: false,
      pin: pin || "",
      taxpayerName: null,
      taxObligations: [],
      status: "unknown",
      message: "Invalid KRA PIN format. Expected: A123456789B (letter + 9 digits + letter).",
    };
  }

  // ── PLACEHOLDER ──
  // In production:
  //
  // const token = await getKraAuthToken();
  // const baseUrl = getKraBaseUrl((await getKraConfig()).environment);
  // const res = await fetch(`${baseUrl}/pin-checker/query/${pin.toUpperCase()}`, {
  //   headers: { "Authorization": `${token.tokenType} ${token.accessToken}` },
  // });
  // const data = await res.json();

  return {
    valid: true,
    pin: pin.toUpperCase(),
    taxpayerName: `[Placeholder] Taxpayer for PIN ${pin.toUpperCase()}`,
    taxObligations: ["Income Tax", "VAT", "PAYE"],
    status: "active",
    message: `PIN ${pin.toUpperCase()} is valid and active. (Placeholder — real API call required for production)`,
  };
}

// ════════════════════════════════════════════════════════════════
// 4. Tax Compliance Certificate (TCC) Checker
// ════════════════════════════════════════════════════════════════

/**
 * Verify a Tax Compliance Certificate by PIN or certificate number.
 *
 * Real API: GET https://api.kra.go.ke/tcc-checker/query
 * Params:   pin=A123456789B or certNo=KRA-TCC-XXXX
 */
export async function validateTcc(
  pin: string,
  certificateNumber?: string
): Promise<TccValidationResult> {
  if (!pin) {
    return {
      valid: false,
      pin: "",
      certificateNumber: certificateNumber || "",
      taxpayerName: null,
      issueDate: null,
      expiryDate: null,
      status: "not_found",
      message: "KRA PIN is required to check Tax Compliance Certificate.",
    };
  }

  // ── PLACEHOLDER ──
  // In production:
  //
  // const token = await getKraAuthToken();
  // const baseUrl = getKraBaseUrl((await getKraConfig()).environment);
  // const params = new URLSearchParams({ pin: pin.toUpperCase() });
  // if (certificateNumber) params.append("certNo", certificateNumber);
  // const res = await fetch(`${baseUrl}/tcc-checker/query?${params}`, {
  //   headers: { "Authorization": `${token.tokenType} ${token.accessToken}` },
  // });

  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);

  return {
    valid: true,
    pin: pin.toUpperCase(),
    certificateNumber: certificateNumber || `TCC-${pin.toUpperCase()}-${new Date().getFullYear()}`,
    taxpayerName: `[Placeholder] Certificate holder for ${pin.toUpperCase()}`,
    issueDate: new Date().toISOString().split("T")[0],
    expiryDate: expiryDate.toISOString().split("T")[0],
    status: "valid",
    message: `Tax Compliance Certificate is valid. (Placeholder — real API required)`,
  };
}

// ════════════════════════════════════════════════════════════════
// 5. Invoice Checker
// ════════════════════════════════════════════════════════════════

/**
 * Verify a supplier invoice against KRA eTIMS records.
 *
 * Real API:  POST https://sbx.kra.go.ke/checker/v1/invoice   (sandbox)
 *            POST https://api.developer.go.ke/checker/v1/invoice (production)
 * Headers:   Content-Type: application/json
 *            Authorization: Bearer <token>
 * Body:      { "invoiceDate": "YYYY-MM-DD", "invoiceNumber": "00407..." }
 */
export async function checkInvoice(
  invoiceNumber: string,
  invoiceDate: string
): Promise<InvoiceCheckResult> {
  if (!invoiceNumber || !invoiceDate) {
    return {
      responseCode: 40001,
      responseDesc: "Invoice number and invoice date are both required.",
      status: "ERROR",
      invoiceDetails: null,
    };
  }

  // ── PLACEHOLDER ──
  // In production, replace with real HTTP call:
  //
  // const token = await getKraAuthToken();
  // const cfg = await getKraConfig();
  // const baseUrl = cfg.environment === "production"
  //   ? "https://api.developer.go.ke/checker/v1"
  //   : "https://sbx.kra.go.ke/checker/v1";
  // const res = await fetch(`${baseUrl}/invoice`, {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     "Authorization": `Bearer ${token.accessToken}`,
  //   },
  //   body: JSON.stringify({ invoiceDate, invoiceNumber }),
  // });
  // return await res.json();

  return {
    responseCode: 40000,
    responseDesc: "Invoice details retrieved successfully. (Placeholder)",
    status: "OK",
    invoiceDetails: {
      salesDate: invoiceDate,
      transmissionDate: new Date().toISOString(),
      invoiceDate: new Date().toISOString(),
      totalItemCount: 2,
      supplierPIN: "P051xxx23G",
      supplierName: "[Placeholder] Supplier Ltd",
      deviceSerialNumber: "KRAMW079757",
      customerPin: null,
      customerName: null,
      controlUnitInvoiceNumber: `CU-${invoiceNumber.slice(-7)}`,
      traderSystemInvoiceNumber: invoiceNumber,
      totalInvoiceAmount: 1764.0,
      totalTaxableAmount: 1520.69,
      totalTaxAmount: 243.31,
      exemptionCertificateNo: null,
      totalDiscountAmount: 0.0,
      itemDetails: [],
    },
  };
}

// ════════════════════════════════════════════════════════════════
// 6. VAT Withholding PRN Generation
// ════════════════════════════════════════════════════════════════

/**
 * Generate a Payment Registration Number (PRN) for VAT withholding.
 * Used when your business is an appointed VAT Withholding Agent.
 *
 * Real API: POST https://api.kra.go.ke/vat-withholding/prn/generate
 */
export async function generateVatWithholdingPrn(
  supplierPin: string,
  amount: number,
  description?: string
): Promise<VatWithholdingPrnResult> {
  if (!supplierPin || amount <= 0) {
    return {
      success: false,
      prn: null,
      amount,
      supplierPin: supplierPin || "",
      expiryDate: null,
      message: "Supplier PIN and positive amount are required.",
    };
  }

  // ── PLACEHOLDER ──
  // In production:
  //
  // const token = await getKraAuthToken();
  // const cfg = await getKraConfig();
  // const baseUrl = getKraBaseUrl(cfg.environment);
  // const res = await fetch(`${baseUrl}/vat-withholding/prn/generate`, {
  //   method: "POST",
  //   headers: {
  //     "Authorization": `${token.tokenType} ${token.accessToken}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     withholdingAgentPin: cfg.businessPin,
  //     supplierPin: supplierPin.toUpperCase(),
  //     amount,
  //     description: description || "VAT Withholding",
  //   }),
  // });

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);

  return {
    success: true,
    prn: `PRN-${Date.now().toString(36).toUpperCase()}`,
    amount,
    supplierPin: supplierPin.toUpperCase(),
    expiryDate: expiryDate.toISOString().split("T")[0],
    message: `VAT Withholding PRN generated for KES ${amount.toLocaleString()}. (Placeholder — real API required)`,
  };
}

// ════════════════════════════════════════════════════════════════
// Helper: Map internal payment methods to KRA eTIMS codes
// ════════════════════════════════════════════════════════════════

/**
 * KRA eTIMS payment type codes:
 *  01 = Cash
 *  02 = Credit
 *  03 = Cash/Credit (mixed)
 *  04 = Bank Check
 *  05 = Debit & Credit Card
 *  06 = Mobile Money
 *  07 = Wire/Transfer
 */
export function mapPaymentMethodToEtims(method: string): string {
  const map: Record<string, string> = {
    cash: "01",
    credit: "02",
    card: "05",
    card_pdq: "05",
    paystack: "05",
    mpesa: "06",
    mobile_money: "06",
    bank_transfer: "07",
    wire: "07",
    cheque: "04",
    check: "04",
  };
  return map[method.toLowerCase()] || "01";
}
