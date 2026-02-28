/**
 * M-Pesa Daraja C2B Adapter — normalizes Safaricom Daraja API
 * C2B (Customer-to-Business) confirmation callbacks.
 *
 * Daraja C2B confirmation payload fields:
 *   TransactionType    — "Pay Bill" or "Buy Goods and Services"
 *   TransID            — Unique M-Pesa transaction ID (e.g. "QCI70N4I6O")
 *   TransTime          — Timestamp in YYYYMMDDHHmmss format
 *   TransAmount        — Payment amount
 *   BusinessShortCode  — Paybill/Till number
 *   BillRefNumber      — Account/reference number (client-defined, may encode SKU or order number)
 *   InvoiceNumber      — Optional invoice number
 *   OrgAccountBalance  — Business account balance after transaction
 *   ThirdPartyTransID  — Third-party transaction reference
 *   MSISDN             — Customer phone number (254XXXXXXXXX format)
 *   FirstName          — Customer first name
 *   MiddleName         — Customer middle name (may be empty)
 *   LastName           — Customer last name (may be empty)
 *
 * Note: M-Pesa C2B confirmations are payment events, NOT itemized sales.
 * The BillRefNumber is the only field that might map to a product or order.
 * How this field is interpreted is client-specific — configured via vendor settings.
 */

import { createHmac } from "crypto";
import type { PosAdapter, PosTransaction, PosLineItem } from "./types";

interface DarajaC2BPayload {
  TransactionType?: string;
  TransID?: string;
  TransTime?: string;
  TransAmount?: string | number;
  BusinessShortCode?: string;
  BillRefNumber?: string;
  InvoiceNumber?: string;
  OrgAccountBalance?: string | number;
  ThirdPartyTransID?: string;
  MSISDN?: string;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
}

/** Parse Daraja timestamp (YYYYMMDDHHmmss) to Date */
function parseDarajaTime(transTime?: string): Date {
  if (!transTime || transTime.length < 14) return new Date();
  const year = transTime.slice(0, 4);
  const month = transTime.slice(4, 6);
  const day = transTime.slice(6, 8);
  const hour = transTime.slice(8, 10);
  const min = transTime.slice(10, 12);
  const sec = transTime.slice(12, 14);
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}+03:00`);
}

/** Format Kenyan phone number to 254XXXXXXXXX */
function normalizePhone(msisdn?: string): string | undefined {
  if (!msisdn) return undefined;
  const cleaned = msisdn.replace(/\D/g, "");
  if (cleaned.startsWith("254")) return cleaned;
  if (cleaned.startsWith("0")) return `254${cleaned.slice(1)}`;
  return cleaned;
}

export const mpesaAdapter: PosAdapter = {
  vendor: "mpesa",

  normalize(payload: unknown): PosTransaction {
    const data = payload as DarajaC2BPayload;

    const amount = Number(data.TransAmount ?? 0);
    const posTxId = data.TransID ?? crypto.randomUUID();

    // Build customer name from available name fields
    const nameParts = [data.FirstName, data.MiddleName, data.LastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    // M-Pesa is a single payment, not an itemized sale.
    // We create a single line item with the BillRefNumber as the reference.
    // The ingestion service will attempt to resolve this via SKU/barcode lookup.
    const items: PosLineItem[] = [];
    if (data.BillRefNumber) {
      items.push({
        sku: data.BillRefNumber,
        name: `M-Pesa payment (ref: ${data.BillRefNumber})`,
        quantity: 1,
        unitPrice: amount,
        totalAmount: amount,
      });
    }

    return {
      posVendor: "mpesa",
      posTxId,
      eventType: "sale",
      timestamp: parseDarajaTime(data.TransTime),
      items,
      subtotal: amount,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: amount,
      paymentMethod: "mpesa",
      paymentReference: posTxId,
      customerId: normalizePhone(data.MSISDN),
      customerName: nameParts || undefined,
      locationId: data.BusinessShortCode,
      rawPayload: payload,
    };
  },

  /** M-Pesa doesn't use HMAC signatures in C2B — IP whitelisting is the security model */
  verifySignature(): boolean {
    // Daraja C2B uses IP whitelisting, not payload signing.
    // Return true — signature verification is a no-op for M-Pesa.
    return true;
  },
};
