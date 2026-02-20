import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { AppConfig } from "../types";

interface POSPageProps {
  config: AppConfig;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  price: string;
  unit: string;
  categoryId: string | null;
}

interface Category {
  id: string;
  name: string;
}

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

interface CartItem {
  product: Product;
  quantity: number;
  unitPrice: number;
  total: number;
}

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", icon: "" },
  { value: "card", label: "Card", icon: "" },
  { value: "mpesa", label: "M-Pesa", icon: "" },
  { value: "bank_transfer", label: "Bank Transfer", icon: "" },
  { value: "credit", label: "On Credit", icon: "" },
];

export default function POSPage({ config }: POSPageProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Order state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [orderNote, setOrderNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [processing, setProcessing] = useState(false);
  const [lastOrder, setLastOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        const [prodRes, catRes, custRes] = await Promise.all([
          fetch("/api/products"),
          fetch("/api/categories"),
          fetch("/api/customers"),
        ]);
        const prodData = await prodRes.json();
        const catData = await catRes.json();
        const custData = await custRes.json();
        setProducts(prodData.data ?? []);
        setCategories(catData.data ?? []);
        setCustomers(custData.data ?? []);
      } catch {
        // defaults to empty
      }
      setLoading(false);
    };
    loadAll();
  }, []);

  // Filter products
  const filteredProducts = useMemo(() => {
    let list = products;
    if (selectedCategory) list = list.filter((p) => p.categoryId === selectedCategory);
    if (productSearch) {
      const q = productSearch.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }
    return list;
  }, [products, selectedCategory, productSearch]);

  // Filter customers
  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 8);
    const q = customerSearch.toLowerCase();
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
  }, [customers, customerSearch]);

  // Cart math
  const cartSubtotal = useMemo(() => cart.reduce((sum, item) => sum + item.total, 0), [cart]);
  const taxRate = parseFloat(process.env.TAX_RATE || "0.16") || 0;
  const cartTax = cartSubtotal * taxRate;
  const cartTotal = cartSubtotal + cartTax;

  /** Handle barcode/QR scan from camera capture */
  const handleBarcodeScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setScanning(true);
    try {
      // Send image to document-scanner agent via chat attachment flow
      const formData = new FormData();
      formData.append("file", file);
      // Use a temporary scan approach — send to a simple barcode extraction endpoint
      // For now, we'll extract any visible text/barcode using the AI
      const reader = new FileReader();
      reader.onload = () => {
        // Use the image data to search by any extracted barcode visually
        // Set as search term to help user find the product
        setProductSearch("[scanning...]");
        // Simulate: In production, this calls the document-scanner agent
        setTimeout(() => {
          setProductSearch("");
          alert("📷 Barcode scanner captured! For full barcode recognition, use the AI Assistant — attach the photo and say \"scan this barcode\".");
          setScanning(false);
        }, 500);
      };
      reader.readAsDataURL(file);
    } catch {
      setScanning(false);
    }
  };

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.unitPrice }
            : item
        );
      }
      const price = parseFloat(product.price) || 0;
      return [...prev, { product, quantity: 1, unitPrice: price, total: price }];
    });
  };

  const updateQuantity = (productId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((item) => item.product.id !== productId));
    } else {
      setCart((prev) =>
        prev.map((item) =>
          item.product.id === productId
            ? { ...item, quantity: qty, total: qty * item.unitPrice }
            : item
        )
      );
    }
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const clearAll = () => {
    setCart([]);
    setSelectedCustomer(null);
    setOrderNote("");
    setPaymentMethod("cash");
    setPaymentReference("");
    setLastOrder(null);
  };

  // Submit order
  const submitOrder = useCallback(async () => {
    if (cart.length === 0) return;
    setProcessing(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer?.id ?? null,
          notes: orderNote || ("Sale  " + (PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label ?? paymentMethod)),
          paymentMethod,
          paymentReference: paymentReference || null,
          paymentStatus: paymentMethod === "credit" ? "pending" : "paid",
          items: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setLastOrder({ id: data.data?.id, orderNumber: data.data?.orderNumber ?? "" });
        setCart([]);
        setOrderNote("");
        setPaymentReference("");
      } else {
        alert("Order failed: " + (data.error ?? "Unknown error"));
      }
    } catch {
      alert("Network error creating order.");
    }
    setProcessing(false);
  }, [cart, selectedCustomer, orderNote, paymentMethod, paymentReference]);

  const fmt = (n: number) =>
    config.currency + " " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state"><div className="spinner" />Loading</div>
      </div>
    );
  }

  return (
    <div className="page order-entry-page">
      <div className="page-header">
        <h2> New {config.labels.order}</h2>
        <span className="text-muted">Create a new sale or order  inventory is deducted on submission</span>
      </div>

      {/* Success banner */}
      {lastOrder && (
        <div className="alert alert-success" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span> {config.labels.order} <strong>{lastOrder.orderNumber}</strong> created successfully!</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-xs btn-secondary" onClick={() => setLastOrder(null)}>Dismiss</button>
            <button className="btn btn-xs btn-primary" onClick={clearAll}>New {config.labels.order}</button>
          </div>
        </div>
      )}

      <div className="order-entry-layout">
        {/*  LEFT: Product Selection  */}
        <div className="order-entry-products">
          {/* Category chips */}
          <div className="filter-chips">
            <button
              className={"chip " + (!selectedCategory ? "active" : "")}
              onClick={() => setSelectedCategory(null)}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={"chip " + (selectedCategory === cat.id ? "active" : "")}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="search-bar" style={{ marginBottom: 12 }}>
            <span className="search-icon"></span>
            <input
              placeholder={"Search " + config.labels.productPlural.toLowerCase() + "…"}
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />
            {productSearch && <button className="search-clear" onClick={() => setProductSearch("")}></button>}
            {/* Barcode scanner */}
            <input ref={scanInputRef} type="file" accept="image/*" capture="environment" onChange={handleBarcodeScan} style={{ display: "none" }} />
            <button
              className="btn btn-icon scan-btn"
              onClick={() => scanInputRef.current?.click()}
              disabled={scanning}
              title="Scan barcode / QR code with camera"
            >
              {scanning ? "⏳" : "📷"}
            </button>
          </div>

          {/* Product grid */}
          <div className="product-grid">
            {filteredProducts.map((p) => {
              const inCart = cart.find((c) => c.product.id === p.id);
              return (
                <button key={p.id} className={"product-card " + (inCart ? "in-cart" : "")} onClick={() => addToCart(p)}>
                  <div className="product-card-name">{p.name}</div>
                  <div className="product-card-sku">{p.sku}</div>
                  <div className="product-card-price">{fmt(parseFloat(p.price) || 0)}</div>
                  <div className="product-card-unit">per {p.unit || config.labels.unitDefault}</div>
                  {inCart && <span className="product-card-qty">{inCart.quantity}</span>}
                </button>
              );
            })}
            {filteredProducts.length === 0 && (
              <div className="empty-state">No {config.labels.productPlural.toLowerCase()} found</div>
            )}
          </div>
        </div>

        {/*  RIGHT: Order Summary  */}
        <div className="order-entry-summary">
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>{config.labels.order} Summary</h3>

            {/* Customer */}
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label>{config.labels.customer}</label>
              {selectedCustomer ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
                  <div>
                    <div className="cell-main">{selectedCustomer.name}</div>
                    <div className="cell-sub">{selectedCustomer.email}</div>
                  </div>
                  <button className="btn btn-xs btn-secondary" onClick={() => { setSelectedCustomer(null); setShowCustomerPicker(true); }}>Change</button>
                </div>
              ) : (
                <button className="btn btn-secondary btn-sm" style={{ width: "100%" }} onClick={() => setShowCustomerPicker(!showCustomerPicker)}>
                   {showCustomerPicker ? "Close" : ("Select " + config.labels.customer)}
                </button>
              )}
              {showCustomerPicker && !selectedCustomer && (
                <div className="customer-picker">
                  <input
                    placeholder={"Search " + config.labels.customerPlural.toLowerCase() + ""}
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    autoFocus
                  />
                  <div className="customer-picker-list">
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        className="customer-picker-option"
                        onClick={() => { setSelectedCustomer(c); setShowCustomerPicker(false); setCustomerSearch(""); }}
                      >
                        <span className="cell-main">{c.name}</span>
                        <span className="cell-sub">{c.email}</span>
                      </button>
                    ))}
                    <button className="customer-picker-option walk-in" onClick={() => { setSelectedCustomer(null); setShowCustomerPicker(false); }}>
                       Walk-in (no {config.labels.customer.toLowerCase()})
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Cart items */}
            <div className="order-entry-items">
              {cart.length === 0 ? (
                <div className="empty-state" style={{ padding: "24px 0", textAlign: "center" }}>
                  <span style={{ fontSize: 32 }}></span>
                  <p>No items yet</p>
                  <p className="text-muted">Click products on the left to add them</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.product.id} className="order-entry-item">
                    <div className="order-entry-item-info">
                      <div className="cell-main">{item.product.name}</div>
                      <div className="cell-sub">{fmt(item.unitPrice)}  {item.quantity}</div>
                    </div>
                    <div className="order-entry-item-controls">
                      <button className="qty-btn" onClick={() => updateQuantity(item.product.id, item.quantity - 1)}></button>
                      <span className="qty-display">{item.quantity}</span>
                      <button className="qty-btn" onClick={() => updateQuantity(item.product.id, item.quantity + 1)}>+</button>
                    </div>
                    <div className="order-entry-item-total">{fmt(item.total)}</div>
                    <button className="remove-btn" onClick={() => removeFromCart(item.product.id)}></button>
                  </div>
                ))
              )}
            </div>

            {/* Totals */}
            {cart.length > 0 && (
              <>
                <div className="order-totals">
                  <div className="order-totals-row">
                    <span>Subtotal</span>
                    <span>{fmt(cartSubtotal)}</span>
                  </div>
                  <div className="order-totals-row">
                    <span>Tax ({(taxRate * 100).toFixed(0)}%)</span>
                    <span>{fmt(cartTax)}</span>
                  </div>
                  <div className="order-totals-row grand">
                    <span>Total</span>
                    <span>{fmt(cartTotal)}</span>
                  </div>
                </div>

                {/* Payment method */}
                <div className="form-field" style={{ marginTop: 12 }}>
                  <label>Payment Method</label>
                  <div className="payment-method-grid">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m.value}
                        className={"payment-method-btn " + (paymentMethod === m.value ? "active" : "")}
                        onClick={() => setPaymentMethod(m.value)}
                      >
                        <span>{m.icon}</span>
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reference (optional) */}
                <div className="form-field" style={{ marginTop: 8 }}>
                  <label>Reference / Receipt No. <span className="text-muted">(optional)</span></label>
                  <input
                    type="text"
                    placeholder={
                      paymentMethod === "mpesa" ? "M-Pesa receipt code"
                        : paymentMethod === "card" ? "Card approval code"
                          : paymentMethod === "bank_transfer" ? "Bank reference"
                            : "Reference number"
                    }
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                  />
                </div>

                {/* Note */}
                <div className="form-field" style={{ marginTop: 8 }}>
                  <label>Note <span className="text-muted">(optional)</span></label>
                  <input
                    placeholder="Order note"
                    value={orderNote}
                    onChange={(e) => setOrderNote(e.target.value)}
                  />
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    disabled={cart.length === 0 || processing}
                    onClick={submitOrder}
                  >
                    {processing ? "Creating" : (" Create " + config.labels.order + "  " + fmt(cartTotal))}
                  </button>
                  <button className="btn btn-secondary" onClick={clearAll} disabled={processing}>
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
