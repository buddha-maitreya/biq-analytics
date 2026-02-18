/** Shared types for the frontend application */

export type Page =
  | "dashboard"
  | "products"
  | "orders"
  | "customers"
  | "inventory"
  | "invoices"
  | "assistant"
  | "reports"
  | "pos"
  | "invoice_checker"
  | "admin"
  | "settings";

/** Authenticated user returned by the auth API */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export interface AppConfig {
  companyName: string;
  companyLogoUrl: string;
  companyTagline: string;
  primaryColor: string;
  currency: string;
  timezone: string;
  labels: {
    product: string;
    productPlural: string;
    order: string;
    orderPlural: string;
    customer: string;
    customerPlural: string;
    warehouse: string;
    invoice: string;
    unitDefault: string;
  };
}
