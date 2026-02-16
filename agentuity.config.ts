import { defineConfig } from "@agentuity/runtime";

export default defineConfig({
  build: {
    // Vite handles frontend (src/web/), Bun handles server (agents + routes)
  },
  define: {
    // Expose safe env vars to frontend at build time
    "process.env.COMPANY_NAME": JSON.stringify(
      process.env.COMPANY_NAME || "Business IQ"
    ),
    "process.env.COMPANY_LOGO_URL": JSON.stringify(
      process.env.COMPANY_LOGO_URL || ""
    ),
    "process.env.CURRENCY": JSON.stringify(process.env.CURRENCY || "USD"),
    "process.env.PRODUCT_LABEL": JSON.stringify(
      process.env.PRODUCT_LABEL || "Product"
    ),
    "process.env.PRODUCT_LABEL_PLURAL": JSON.stringify(
      process.env.PRODUCT_LABEL_PLURAL || "Products"
    ),
    "process.env.ORDER_LABEL": JSON.stringify(
      process.env.ORDER_LABEL || "Order"
    ),
    "process.env.ORDER_LABEL_PLURAL": JSON.stringify(
      process.env.ORDER_LABEL_PLURAL || "Orders"
    ),
    "process.env.CUSTOMER_LABEL": JSON.stringify(
      process.env.CUSTOMER_LABEL || "Customer"
    ),
    "process.env.CUSTOMER_LABEL_PLURAL": JSON.stringify(
      process.env.CUSTOMER_LABEL_PLURAL || "Customers"
    ),
    "process.env.WAREHOUSE_LABEL": JSON.stringify(
      process.env.WAREHOUSE_LABEL || "Warehouse"
    ),
    "process.env.INVOICE_LABEL": JSON.stringify(
      process.env.INVOICE_LABEL || "Invoice"
    ),
    "process.env.UNIT_DEFAULT": JSON.stringify(
      process.env.UNIT_DEFAULT || "piece"
    ),
  },
});
