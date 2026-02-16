/**
 * Environment-driven configuration loader.
 * All client-specific values come from env vars — never hardcoded.
 */

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envNumber(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? Number(val) : fallback;
}

/** Branding & localization config */
export const config = {
  // Branding
  companyName: env("COMPANY_NAME", "Business IQ"),
  companyLogoUrl: env("COMPANY_LOGO_URL", ""),
  currency: env("CURRENCY", "USD"),
  taxRate: envNumber("TAX_RATE", 0),
  timezone: env("TIMEZONE", "UTC"),

  // Industry terminology — labels shown in UI
  labels: {
    product: env("PRODUCT_LABEL", "Product"),
    productPlural: env("PRODUCT_LABEL_PLURAL", "Products"),
    order: env("ORDER_LABEL", "Order"),
    orderPlural: env("ORDER_LABEL_PLURAL", "Orders"),
    customer: env("CUSTOMER_LABEL", "Customer"),
    customerPlural: env("CUSTOMER_LABEL_PLURAL", "Customers"),
    warehouse: env("WAREHOUSE_LABEL", "Warehouse"),
    invoice: env("INVOICE_LABEL", "Invoice"),
    unitDefault: env("UNIT_DEFAULT", "piece"),
  },
} as const;

export type AppConfig = typeof config;
export type Labels = typeof config.labels;
