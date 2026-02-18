/**
 * API routes barrel file.
 *
 * Each route module exports a Hono router created via createRouter().
 * These are imported and mounted in the Agentuity app configuration.
 *
 * Route structure:
 *   /api/config      — App config & health
 *   /api/products    — Product CRUD
 *   /api/categories  — Category CRUD + tree
 *   /api/customers   — Customer CRUD + search
 *   /api/warehouses  — Warehouse CRUD
 *   /api/inventory   — Stock adjust, transfer, low-stock
 *   /api/orders      — Order lifecycle
 *   /api/invoices    — Invoice generation & payments
 *   /api/pricing     — Price calculation & tax rules
 *   /api/admin/*     — Admin console (order statuses, tax rules, users)
 *   /api/admin/documents — Knowledge base document management (RAG)
 *   /api/chat        — Business assistant chat
 *   /api/reports     — AI-powered report generation
 */

export { default as configRoutes } from "./config";
export { default as authRoutes } from "./auth";
export { default as productRoutes } from "./products";
export { default as categoryRoutes } from "./categories";
export { default as customerRoutes } from "./customers";
export { default as warehouseRoutes } from "./warehouses";
export { default as inventoryRoutes } from "./inventory";
export { default as orderRoutes } from "./orders";
export { default as invoiceRoutes } from "./invoices";
export { default as pricingRoutes } from "./pricing";
export { default as adminRoutes } from "./admin";
export { default as settingsRoutes } from "./settings";
export { default as documentRoutes } from "./documents";
export { default as chatRoutes } from "./chat";
export { default as reportRoutes } from "./reports";
