import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import {
  db,
  orders,
  sales,
  products,
  customers,
  invoices,
} from "@db/index";
import { gte, lte, and, desc, asc, eq } from "drizzle-orm";
import { buildExcelBuffer } from "@lib/excel-export";
import { config } from "@lib/config";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

// ── Helpers ──────────────────────────────────────────────────

/** Build gte/lte conditions from ISO date strings. */
function dateConditions(col: any, startDate?: string | null, endDate?: string | null): any[] {
  const conds: any[] = [];
  if (startDate) {
    const d = new Date(startDate);
    if (!isNaN(d.getTime())) conds.push(gte(col, d));
  }
  if (endDate) {
    const d = new Date(endDate);
    d.setHours(23, 59, 59, 999);
    if (!isNaN(d.getTime())) conds.push(lte(col, d));
  }
  return conds;
}

function buildWhere(conditions: any[]) {
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

function xlsxResponse(buf: Uint8Array, filename: string) {
  return new Response(
    // ExcelJS returns a Buffer (Bun-compatible Uint8Array);
    // cast needed due to ArrayBuffer vs SharedArrayBuffer TypeScript constraint
    buf as unknown as BodyInit,
    {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    }
  );
}

function dateLabel(startDate?: string | null, endDate?: string | null) {
  if (startDate && endDate) return `_${startDate}_to_${endDate}`;
  if (startDate) return `_from_${startDate}`;
  if (endDate) return `_to_${endDate}`;
  return "";
}

// ── Orders ───────────────────────────────────────────────────
router.get("/export/orders", async (c) => {
  const startDate = c.req.query("startDate");
  const endDate   = c.req.query("endDate");
  const where = buildWhere(dateConditions(orders.createdAt, startDate, endDate));

  const data = await db.query.orders.findMany({
    where,
    with: { customer: true, status: true },
    orderBy: [desc(orders.createdAt)],
    limit: 50000,
  });

  const rows = data.map((o: any) => ({
    orderNumber:    o.orderNumber,
    customer:       o.customer?.name ?? "Walk-in",
    status:         o.status?.label ?? "—",
    paymentMethod:  o.paymentMethod ?? "—",
    paymentStatus:  o.paymentStatus ?? "—",
    subtotal:       Number(o.subtotal) || 0,
    taxAmount:      Number(o.taxAmount) || 0,
    discountAmount: Number(o.discountAmount) || 0,
    totalAmount:    Number(o.totalAmount) || 0,
    date:           o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "—",
    notes:          o.notes ?? "",
  }));

  const buf = await buildExcelBuffer(
    config.labels.orderPlural,
    [
      { header: `${config.labels.order} #`,         key: "orderNumber",    width: 16 },
      { header: config.labels.customer,              key: "customer",       width: 26 },
      { header: "Status",                            key: "status",         width: 14 },
      { header: "Payment Method",                    key: "paymentMethod",  width: 18 },
      { header: "Payment Status",                    key: "paymentStatus",  width: 16 },
      { header: `Subtotal (${config.currency})`,     key: "subtotal",       width: 16 },
      { header: `Tax (${config.currency})`,          key: "taxAmount",      width: 14 },
      { header: `Discount (${config.currency})`,     key: "discountAmount", width: 14 },
      { header: `Total (${config.currency})`,        key: "totalAmount",    width: 16 },
      { header: "Date",                              key: "date",           width: 14 },
      { header: "Notes",                             key: "notes",          width: 32 },
    ],
    rows,
  );

  return xlsxResponse(buf, `orders${dateLabel(startDate, endDate)}.xlsx`);
});

// ── Sales ────────────────────────────────────────────────────
router.get("/export/sales", async (c) => {
  const startDate  = c.req.query("startDate");
  const endDate    = c.req.query("endDate");
  const warehouseId = c.req.query("warehouseId");

  const conds = dateConditions(sales.saleDate, startDate, endDate);
  if (warehouseId) conds.push(eq(sales.warehouseId, warehouseId));
  const where = buildWhere(conds);

  // Sales has no relational queries set up — use plain select
  let query = db.select().from(sales).orderBy(desc(sales.saleDate)).limit(50000);
  if (where) query = query.where(where) as any;
  const data = await query;

  const rows = data.map((s: any) => ({
    saleNumber:    s.saleNumber,
    sku:           s.sku ?? "—",
    productName:   s.productName ?? "—",
    category:      s.category ?? "—",
    warehouseName: s.warehouseName ?? "—",
    quantity:      Number(s.quantity) || 0,
    unitPrice:     Number(s.unitPrice) || 0,
    totalAmount:   Number(s.totalAmount) || 0,
    paymentMethod: s.paymentMethod ?? "—",
    customerName:  s.customerName ?? "Walk-in",
    date:          s.saleDate ? new Date(s.saleDate).toLocaleDateString() : "—",
  }));

  const buf = await buildExcelBuffer(
    "Sales",
    [
      { header: "Sale #",                           key: "saleNumber",    width: 14 },
      { header: "SKU",                              key: "sku",           width: 16 },
      { header: "Product",                          key: "productName",   width: 28 },
      { header: "Category",                         key: "category",      width: 18 },
      { header: "Branch / Warehouse",               key: "warehouseName", width: 22 },
      { header: "Qty",                              key: "quantity",      width: 8  },
      { header: `Unit Price (${config.currency})`,  key: "unitPrice",     width: 18 },
      { header: `Total (${config.currency})`,       key: "totalAmount",   width: 16 },
      { header: "Payment",                          key: "paymentMethod", width: 16 },
      { header: "Customer",                         key: "customerName",  width: 24 },
      { header: "Date",                             key: "date",          width: 14 },
    ],
    rows,
  );

  return xlsxResponse(buf, `sales${dateLabel(startDate, endDate)}.xlsx`);
});

// ── Products ─────────────────────────────────────────────────
router.get("/export/products", async (c) => {
  const data = await db.query.products.findMany({
    with: { category: true },
    orderBy: [asc(products.name)],
    limit: 50000,
  });

  const rows = data.map((p: any) => ({
    sku:         p.sku ?? "—",
    name:        p.name,
    category:    p.category?.name ?? "Uncategorized",
    price:       Number(p.price) || 0,
    costPrice:   Number(p.costPrice) || 0,
    unit:        p.unit ?? "—",
    isActive:    p.isActive ? "Active" : "Inactive",
    description: p.description ?? "",
  }));

  const buf = await buildExcelBuffer(
    config.labels.productPlural,
    [
      { header: "SKU",                             key: "sku",         width: 18 },
      { header: "Name",                            key: "name",        width: 30 },
      { header: "Category",                        key: "category",    width: 20 },
      { header: `Price (${config.currency})`,      key: "price",       width: 16 },
      { header: `Cost Price (${config.currency})`, key: "costPrice",   width: 16 },
      { header: "Unit",                            key: "unit",        width: 10 },
      { header: "Status",                          key: "isActive",    width: 10 },
      { header: "Description",                     key: "description", width: 36 },
    ],
    rows,
  );

  return xlsxResponse(buf, "products.xlsx");
});

// ── Customers ────────────────────────────────────────────────
router.get("/export/customers", async (c) => {
  const data = await db.query.customers.findMany({
    orderBy: [asc(customers.name)],
    limit: 50000,
  });

  const rows = data.map((cu: any) => ({
    name:      cu.name,
    email:     cu.email ?? "—",
    phone:     cu.phone ?? "—",
    address:   cu.address ?? "—",
    taxId:     cu.taxId ?? "—",
    isActive:  cu.isActive ? "Active" : "Inactive",
    createdAt: cu.createdAt ? new Date(cu.createdAt).toLocaleDateString() : "—",
  }));

  const buf = await buildExcelBuffer(
    config.labels.customerPlural,
    [
      { header: "Name",    key: "name",      width: 28 },
      { header: "Email",   key: "email",     width: 28 },
      { header: "Phone",   key: "phone",     width: 18 },
      { header: "Address", key: "address",   width: 34 },
      { header: "Tax ID",  key: "taxId",     width: 16 },
      { header: "Status",  key: "isActive",  width: 10 },
      { header: "Created", key: "createdAt", width: 14 },
    ],
    rows,
  );

  return xlsxResponse(buf, "customers.xlsx");
});

// ── Invoices ─────────────────────────────────────────────────
router.get("/export/invoices", async (c) => {
  const startDate = c.req.query("startDate");
  const endDate   = c.req.query("endDate");
  const status    = c.req.query("status");

  const conds = dateConditions(invoices.createdAt, startDate, endDate);
  if (status) conds.push(eq(invoices.status, status));
  const where = buildWhere(conds);

  const data = await db.query.invoices.findMany({
    where,
    with: { customer: true },
    orderBy: [desc(invoices.createdAt)],
    limit: 50000,
  });

  const rows = data.map((inv: any) => {
    const total = Number(inv.totalAmount) || 0;
    const paid  = Number(inv.paidAmount)  || 0;
    return {
      invoiceNumber: inv.invoiceNumber,
      supplierName:  inv.supplierName ?? inv.customer?.name ?? "—",
      status:        inv.status ?? "—",
      totalAmount:   total,
      paidAmount:    paid,
      balance:       total - paid,
      dueDate:       inv.dueDate      ? new Date(inv.dueDate).toLocaleDateString()      : "—",
      invoiceDate:   inv.invoiceDate  ? new Date(inv.invoiceDate).toLocaleDateString()  : "—",
      createdAt:     inv.createdAt    ? new Date(inv.createdAt).toLocaleDateString()    : "—",
    };
  });

  const buf = await buildExcelBuffer(
    "Invoices",
    [
      { header: "Invoice #",                    key: "invoiceNumber", width: 16 },
      { header: "Supplier / Customer",          key: "supplierName",  width: 28 },
      { header: "Status",                       key: "status",        width: 12 },
      { header: `Total (${config.currency})`,   key: "totalAmount",   width: 16 },
      { header: `Paid (${config.currency})`,    key: "paidAmount",    width: 14 },
      { header: `Balance (${config.currency})`, key: "balance",       width: 14 },
      { header: "Due Date",                     key: "dueDate",       width: 14 },
      { header: "Invoice Date",                 key: "invoiceDate",   width: 14 },
      { header: "Created",                      key: "createdAt",     width: 14 },
    ],
    rows,
  );

  return xlsxResponse(buf, `invoices${dateLabel(startDate, endDate)}.xlsx`);
});

export default router;
