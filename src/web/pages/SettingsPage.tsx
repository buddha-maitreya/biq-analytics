import React, { useState, useEffect } from "react";
import type { AppConfig } from "../types";

interface SettingsPageProps {
  config: AppConfig;
  onSaved: () => void;
}

// Default payment config keys
const PAYMENT_DEFAULTS = {
  // Paystack
  paystackEnabled: "false",
  paystackPublicKey: "",
  paystackSecretKey: "",
  paystackCurrency: "KES",
  // M-Pesa
  mpesaEnabled: "false",
  mpesaEnvironment: "sandbox",
  mpesaConsumerKey: "",
  mpesaConsumerSecret: "",
  mpesaShortcode: "",
  mpesaPasskey: "",
  mpesaPaymentType: "till",
  mpesaTillNumber: "",
  mpesaPaybillNumber: "",
  mpesaAccountReference: "",
  mpesaCallbackUrl: "",
  // KRA / eTIMS
  kraEnabled: "false",
  kraEnvironment: "sandbox",
  kraClientId: "",
  kraClientSecret: "",
  kraBusinessPin: "",
  kraEtimsDeviceSerial: "",
  kraBranchId: "00",
};

export default function SettingsPage({ config, onSaved }: SettingsPageProps) {
  const [settings, setSettings] = useState({
    businessName: "",
    businessLogoUrl: "",
    businessTagline: "",
    primaryColor: "#3b82f6",
    ...PAYMENT_DEFAULTS,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [activeSection, setActiveSection] = useState<"business" | "payments" | "tax">("business");

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const json = await res.json();
      if (json.data) {
        setSettings((prev) => ({
          ...prev,
          businessName: json.data.businessName || "",
          businessLogoUrl: json.data.businessLogoUrl || "",
          businessTagline: json.data.businessTagline || "",
          primaryColor: json.data.primaryColor || "#3b82f6",
          // Payment settings
          ...Object.fromEntries(
            Object.keys(PAYMENT_DEFAULTS).map((k) => [k, json.data[k] ?? (PAYMENT_DEFAULTS as Record<string, string>)[k]])
          ),
        }));
      }
    } catch {
      // Use defaults
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Settings saved successfully!" });
        onSaved();
      } else {
        setMessage({ type: "error", text: "Failed to save settings." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error. Please try again." });
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h2>🎨 Settings</h2>
        </div>
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  const upd = (key: string, val: string) => setSettings((p) => ({ ...p, [key]: val }));

  return (
    <div className="page">
      <div className="page-header">
        <h2>⚙️ Settings</h2>
        <span className="text-muted">Manage your business identity and payment integrations</span>
      </div>

      {message && (
        <div className={`alert alert-${message.type}`}>
          {message.type === "success" ? "✅" : "❌"} {message.text}
        </div>
      )}

      {/* Section Tabs */}
      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeSection === "business" ? "active" : ""}`}
          onClick={() => setActiveSection("business")}
        >
          🏢 Business Identity
        </button>
        <button
          className={`settings-tab ${activeSection === "payments" ? "active" : ""}`}
          onClick={() => setActiveSection("payments")}
        >
          💳 Payment Providers
        </button>
        <button
          className={`settings-tab ${activeSection === "tax" ? "active" : ""}`}
          onClick={() => setActiveSection("tax")}
        >
          🏛️ Tax &amp; Compliance
        </button>
      </div>

      {/* ═══ BUSINESS IDENTITY SECTION ═══ */}
      {activeSection === "business" && (
        <div className="settings-grid">
          {/* Business Identity Card */}
          <div className="card settings-card">
            <h3>🏢 Business Identity</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              These appear in the sidebar and throughout the application.
            </p>

            <div className="form-grid" style={{ gap: 16 }}>
              <label>
                <span className="form-label">Business Name</span>
                <input
                  type="text"
                  placeholder="e.g. Safari Adventures Kenya"
                  value={settings.businessName}
                  onChange={(e) => upd("businessName", e.target.value)}
                />
                <span className="form-hint">Displayed in the sidebar header</span>
              </label>

              <label>
                <span className="form-label">Tagline</span>
                <input
                  type="text"
                  placeholder="e.g. Your Gateway to African Wildlife"
                  value={settings.businessTagline}
                  onChange={(e) => upd("businessTagline", e.target.value)}
                />
                <span className="form-hint">Short description shown below the business name</span>
              </label>

              <label>
                <span className="form-label">Logo URL</span>
                <input
                  type="text"
                  placeholder="https://example.com/logo.png"
                  value={settings.businessLogoUrl}
                  onChange={(e) => upd("businessLogoUrl", e.target.value)}
                />
                <span className="form-hint">Direct URL to your logo image (PNG, SVG, or JPG)</span>
              </label>
            </div>

            {/* Live Preview */}
            <div className="settings-preview">
              <span className="preview-label">Preview</span>
              <div className="preview-sidebar">
                {settings.businessLogoUrl && (
                  <img
                    src={settings.businessLogoUrl}
                    alt=""
                    className="preview-logo"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <div className="preview-text">
                  <strong>{settings.businessName || "Business IQ"}</strong>
                  {settings.businessTagline && (
                    <span className="preview-tagline">{settings.businessTagline}</span>
                  )}
                </div>
                <span className="preview-powered">Powered by Business IQ</span>
              </div>
            </div>
          </div>

          {/* Appearance Card */}
          <div className="card settings-card">
            <h3>🎨 Appearance</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Customize the look and feel.
            </p>

            <div className="form-grid">
              <label>
                <span className="form-label">Primary Color</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="color"
                    value={settings.primaryColor}
                    onChange={(e) => upd("primaryColor", e.target.value)}
                    style={{ width: 48, height: 36, padding: 2, cursor: "pointer" }}
                  />
                  <input
                    type="text"
                    value={settings.primaryColor}
                    onChange={(e) => upd("primaryColor", e.target.value)}
                    style={{ width: 120 }}
                  />
                </div>
                <span className="form-hint">Used for buttons, active nav items, and accents</span>
              </label>
            </div>
          </div>

          {/* Current Config (Read-Only) */}
          <div className="card settings-card">
            <h3>📋 Environment Configuration</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Set by your deployment administrator via environment variables.
            </p>

            <div className="config-table">
              <div className="config-row">
                <span className="config-key">Currency</span>
                <span className="config-value">{config.currency}</span>
              </div>
              <div className="config-row">
                <span className="config-key">Timezone</span>
                <span className="config-value">{config.timezone}</span>
              </div>
              <div className="config-row">
                <span className="config-key">{config.labels.product} Label</span>
                <span className="config-value">{config.labels.product} / {config.labels.productPlural}</span>
              </div>
              <div className="config-row">
                <span className="config-key">{config.labels.order} Label</span>
                <span className="config-value">{config.labels.order} / {config.labels.orderPlural}</span>
              </div>
              <div className="config-row">
                <span className="config-key">{config.labels.customer} Label</span>
                <span className="config-value">{config.labels.customer} / {config.labels.customerPlural}</span>
              </div>
              <div className="config-row">
                <span className="config-key">{config.labels.warehouse} Label</span>
                <span className="config-value">{config.labels.warehouse}</span>
              </div>
              <div className="config-row">
                <span className="config-key">Default Unit</span>
                <span className="config-value">{config.labels.unitDefault}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PAYMENT PROVIDERS SECTION ═══ */}
      {activeSection === "payments" && (
        <div className="settings-grid">
          {/* ── Paystack (Card Payments) ── */}
          <div className="card settings-card payment-card">
            <div className="payment-card-header">
              <div>
                <h3>💳 Paystack — Card Payments</h3>
                <p className="text-muted">Accept Visa, Mastercard, and bank payments via Paystack</p>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.paystackEnabled === "true"}
                  onChange={(e) => upd("paystackEnabled", e.target.checked ? "true" : "false")}
                />
                <span className="toggle-slider" />
                <span className="toggle-label">{settings.paystackEnabled === "true" ? "Enabled" : "Disabled"}</span>
              </label>
            </div>

            {settings.paystackEnabled === "true" && (
              <div className="payment-fields">
                <div className="form-field">
                  <label>Public Key</label>
                  <input
                    type="text"
                    placeholder="pk_live_xxxxxxxxxxxx"
                    value={settings.paystackPublicKey}
                    onChange={(e) => upd("paystackPublicKey", e.target.value)}
                  />
                  <span className="form-hint">Found in your Paystack Dashboard → Settings → API Keys</span>
                </div>
                <div className="form-field">
                  <label>Secret Key</label>
                  <input
                    type="password"
                    placeholder="sk_live_xxxxxxxxxxxx"
                    value={settings.paystackSecretKey}
                    onChange={(e) => upd("paystackSecretKey", e.target.value)}
                  />
                  <span className="form-hint">Keep this secret — used for server-side verification</span>
                </div>
                <div className="form-field">
                  <label>Currency</label>
                  <select
                    value={settings.paystackCurrency}
                    onChange={(e) => upd("paystackCurrency", e.target.value)}
                  >
                    <option value="KES">KES — Kenya Shilling</option>
                    <option value="NGN">NGN — Nigerian Naira</option>
                    <option value="GHS">GHS — Ghana Cedi</option>
                    <option value="ZAR">ZAR — South African Rand</option>
                    <option value="USD">USD — US Dollar</option>
                  </select>
                </div>
                <div className="payment-status-bar">
                  {settings.paystackPublicKey && settings.paystackSecretKey ? (
                    <span className="status-pill" style={{ background: "#dcfce7", color: "#166534" }}>✅ Keys configured</span>
                  ) : (
                    <span className="status-pill" style={{ background: "#fef3c7", color: "#92400e" }}>⚠️ Enter both keys to activate</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── M-Pesa Daraja (Mobile Money) ── */}
          <div className="card settings-card payment-card">
            <div className="payment-card-header">
              <div>
                <h3>📱 M-Pesa — Mobile Money</h3>
                <p className="text-muted">Accept M-Pesa payments via Safaricom Daraja API (STK Push, Till, Paybill)</p>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.mpesaEnabled === "true"}
                  onChange={(e) => upd("mpesaEnabled", e.target.checked ? "true" : "false")}
                />
                <span className="toggle-slider" />
                <span className="toggle-label">{settings.mpesaEnabled === "true" ? "Enabled" : "Disabled"}</span>
              </label>
            </div>

            {settings.mpesaEnabled === "true" && (
              <div className="payment-fields">
                {/* Environment */}
                <div className="form-field">
                  <label>Environment</label>
                  <div className="env-toggle">
                    <button
                      className={`env-btn ${settings.mpesaEnvironment === "sandbox" ? "active" : ""}`}
                      onClick={() => upd("mpesaEnvironment", "sandbox")}
                    >
                      🧪 Sandbox
                    </button>
                    <button
                      className={`env-btn ${settings.mpesaEnvironment === "production" ? "active" : ""}`}
                      onClick={() => upd("mpesaEnvironment", "production")}
                    >
                      🚀 Production
                    </button>
                  </div>
                  <span className="form-hint">Use Sandbox for testing, Production for live payments</span>
                </div>

                {/* API Credentials */}
                <div className="payment-subsection">
                  <h4>🔑 API Credentials</h4>
                  <div className="form-field">
                    <label>Consumer Key</label>
                    <input
                      type="text"
                      placeholder="From Daraja portal"
                      value={settings.mpesaConsumerKey}
                      onChange={(e) => upd("mpesaConsumerKey", e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>Consumer Secret</label>
                    <input
                      type="password"
                      placeholder="From Daraja portal"
                      value={settings.mpesaConsumerSecret}
                      onChange={(e) => upd("mpesaConsumerSecret", e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>Business Shortcode</label>
                    <input
                      type="text"
                      placeholder="e.g. 174379"
                      value={settings.mpesaShortcode}
                      onChange={(e) => upd("mpesaShortcode", e.target.value)}
                    />
                    <span className="form-hint">Your Safaricom business shortcode</span>
                  </div>
                  <div className="form-field">
                    <label>Passkey (Lipa Na M-Pesa)</label>
                    <input
                      type="password"
                      placeholder="From Daraja portal"
                      value={settings.mpesaPasskey}
                      onChange={(e) => upd("mpesaPasskey", e.target.value)}
                    />
                    <span className="form-hint">Required for STK Push (Lipa Na M-Pesa Online)</span>
                  </div>
                </div>

                {/* Payment Type */}
                <div className="payment-subsection">
                  <h4>💰 Payment Type</h4>
                  <div className="payment-type-grid">
                    <button
                      className={`payment-type-card ${settings.mpesaPaymentType === "till" || settings.mpesaPaymentType === "both" ? "active" : ""}`}
                      onClick={() => upd("mpesaPaymentType", settings.mpesaPaymentType === "both" ? "paybill" : settings.mpesaPaymentType === "till" ? "both" : "till")}
                    >
                      <span className="payment-type-icon">🏪</span>
                      <span className="payment-type-title">Buy Goods (Till)</span>
                      <span className="payment-type-desc">Customer pays to your Till Number</span>
                      <span className={`payment-type-check ${settings.mpesaPaymentType === "till" || settings.mpesaPaymentType === "both" ? "checked" : ""}`}>
                        {settings.mpesaPaymentType === "till" || settings.mpesaPaymentType === "both" ? "✓" : ""}
                      </span>
                    </button>
                    <button
                      className={`payment-type-card ${settings.mpesaPaymentType === "paybill" || settings.mpesaPaymentType === "both" ? "active" : ""}`}
                      onClick={() => upd("mpesaPaymentType", settings.mpesaPaymentType === "both" ? "till" : settings.mpesaPaymentType === "paybill" ? "both" : "paybill")}
                    >
                      <span className="payment-type-icon">🏦</span>
                      <span className="payment-type-title">Paybill</span>
                      <span className="payment-type-desc">Customer pays to Paybill + Account No.</span>
                      <span className={`payment-type-check ${settings.mpesaPaymentType === "paybill" || settings.mpesaPaymentType === "both" ? "checked" : ""}`}>
                        {settings.mpesaPaymentType === "paybill" || settings.mpesaPaymentType === "both" ? "✓" : ""}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Till / Paybill Numbers */}
                <div className="payment-subsection">
                  <h4>🔢 Payment Numbers</h4>
                  {(settings.mpesaPaymentType === "till" || settings.mpesaPaymentType === "both") && (
                    <div className="form-field">
                      <label>Till Number (Buy Goods)</label>
                      <input
                        type="text"
                        placeholder="e.g. 5001234"
                        value={settings.mpesaTillNumber}
                        onChange={(e) => upd("mpesaTillNumber", e.target.value)}
                      />
                      <span className="form-hint">Safaricom Buy Goods Till Number</span>
                    </div>
                  )}
                  {(settings.mpesaPaymentType === "paybill" || settings.mpesaPaymentType === "both") && (
                    <>
                      <div className="form-field">
                        <label>Paybill Number</label>
                        <input
                          type="text"
                          placeholder="e.g. 888880"
                          value={settings.mpesaPaybillNumber}
                          onChange={(e) => upd("mpesaPaybillNumber", e.target.value)}
                        />
                        <span className="form-hint">Safaricom Paybill Business Number</span>
                      </div>
                      <div className="form-field">
                        <label>Default Account Reference</label>
                        <input
                          type="text"
                          placeholder="e.g. INV001 or company name"
                          value={settings.mpesaAccountReference}
                          onChange={(e) => upd("mpesaAccountReference", e.target.value)}
                        />
                        <span className="form-hint">Used as default Account No. in STK Push prompts</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Callback URL */}
                <div className="payment-subsection">
                  <h4>🔗 Callback URL</h4>
                  <div className="form-field">
                    <label>M-Pesa Callback URL</label>
                    <input
                      type="text"
                      placeholder="https://your-app.agentuity.run/api/payments/mpesa/callback"
                      value={settings.mpesaCallbackUrl}
                      onChange={(e) => upd("mpesaCallbackUrl", e.target.value)}
                    />
                    <span className="form-hint">Safaricom sends payment confirmations to this URL. Must be publicly accessible (HTTPS).</span>
                  </div>
                </div>

                {/* Status */}
                <div className="payment-status-bar">
                  {settings.mpesaConsumerKey && settings.mpesaConsumerSecret && settings.mpesaShortcode ? (
                    <span className="status-pill" style={{ background: "#dcfce7", color: "#166534" }}>✅ API credentials configured</span>
                  ) : (
                    <span className="status-pill" style={{ background: "#fef3c7", color: "#92400e" }}>⚠️ Enter API credentials to activate</span>
                  )}
                  {(settings.mpesaPaymentType === "till" || settings.mpesaPaymentType === "both") && settings.mpesaTillNumber && (
                    <span className="status-pill" style={{ background: "#dbeafe", color: "#1e40af" }}>🏪 Till: {settings.mpesaTillNumber}</span>
                  )}
                  {(settings.mpesaPaymentType === "paybill" || settings.mpesaPaymentType === "both") && settings.mpesaPaybillNumber && (
                    <span className="status-pill" style={{ background: "#dbeafe", color: "#1e40af" }}>🏦 Paybill: {settings.mpesaPaybillNumber}</span>
                  )}
                  <span className="status-pill" style={{ background: settings.mpesaEnvironment === "production" ? "#fef3c7" : "#e0e7ff", color: settings.mpesaEnvironment === "production" ? "#92400e" : "#3730a3" }}>
                    {settings.mpesaEnvironment === "production" ? "🚀 Live" : "🧪 Sandbox"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ TAX & COMPLIANCE SECTION ═══ */}
      {activeSection === "tax" && (
        <div className="settings-grid">
          <div className="card settings-card payment-card">
            <div className="payment-card-header">
              <div>
                <h3>🏛️ KRA eTIMS — Tax Compliance</h3>
                <p className="text-muted">Connect to Kenya Revenue Authority's electronic Tax Invoice Management System</p>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.kraEnabled === "true"}
                  onChange={(e) => upd("kraEnabled", e.target.checked ? "true" : "false")}
                />
                <span className="toggle-slider" />
                <span className="toggle-label">{settings.kraEnabled === "true" ? "Enabled" : "Disabled"}</span>
              </label>
            </div>

            {settings.kraEnabled === "true" && (
              <div className="payment-fields">
                {/* Environment */}
                <div className="form-field">
                  <label>Environment</label>
                  <div className="env-toggle">
                    <button
                      className={`env-btn ${settings.kraEnvironment === "sandbox" ? "active" : ""}`}
                      onClick={() => upd("kraEnvironment", "sandbox")}
                    >
                      🧪 Sandbox
                    </button>
                    <button
                      className={`env-btn ${settings.kraEnvironment === "production" ? "active" : ""}`}
                      onClick={() => upd("kraEnvironment", "production")}
                    >
                      🚀 Production
                    </button>
                  </div>
                  <span className="form-hint">Use Sandbox (sbx.kra.go.ke) for testing, Production for live tax submissions</span>
                </div>

                {/* API Credentials */}
                <div className="payment-subsection">
                  <h4>🔑 API Credentials</h4>
                  <div className="form-field">
                    <label>Client ID (App ID)</label>
                    <input
                      type="text"
                      placeholder="From KRA eTIMS portal"
                      value={settings.kraClientId}
                      onChange={(e) => upd("kraClientId", e.target.value)}
                    />
                    <span className="form-hint">Your eTIMS OSCU application ID (apigee_app_id)</span>
                  </div>
                  <div className="form-field">
                    <label>Client Secret</label>
                    <input
                      type="password"
                      placeholder="From KRA eTIMS portal"
                      value={settings.kraClientSecret}
                      onChange={(e) => upd("kraClientSecret", e.target.value)}
                    />
                    <span className="form-hint">Used for OAuth token generation (Basic auth)</span>
                  </div>
                </div>

                {/* Business Details */}
                <div className="payment-subsection">
                  <h4>🏢 Business Details</h4>
                  <div className="form-field">
                    <label>KRA PIN</label>
                    <input
                      type="text"
                      placeholder="e.g. A123456789B"
                      value={settings.kraBusinessPin}
                      onChange={(e) => upd("kraBusinessPin", e.target.value)}
                    />
                    <span className="form-hint">Your business KRA PIN (TIN) — used as the eTIMS 'tin' header</span>
                  </div>
                  <div className="form-field">
                    <label>eTIMS Device Serial (cmcKey)</label>
                    <input
                      type="text"
                      placeholder="e.g. KRAICD000000001"
                      value={settings.kraEtimsDeviceSerial}
                      onChange={(e) => upd("kraEtimsDeviceSerial", e.target.value)}
                    />
                    <span className="form-hint">Your registered eTIMS OSCU device serial number</span>
                  </div>
                  <div className="form-field">
                    <label>Branch ID (bhfId)</label>
                    <input
                      type="text"
                      placeholder="00"
                      value={settings.kraBranchId}
                      onChange={(e) => upd("kraBranchId", e.target.value)}
                    />
                    <span className="form-hint">Branch identifier — '00' for head office, '01', '02', etc. for branches</span>
                  </div>
                </div>

                {/* Status */}
                <div className="payment-status-bar">
                  {settings.kraClientId && settings.kraClientSecret && settings.kraBusinessPin ? (
                    <span className="status-pill" style={{ background: "#dcfce7", color: "#166534" }}>✅ Credentials configured</span>
                  ) : (
                    <span className="status-pill" style={{ background: "#fef3c7", color: "#92400e" }}>⚠️ Enter credentials to activate</span>
                  )}
                  <span className="status-pill" style={{ background: settings.kraEnvironment === "production" ? "#fef3c7" : "#e0e7ff", color: settings.kraEnvironment === "production" ? "#92400e" : "#3730a3" }}>
                    {settings.kraEnvironment === "production" ? "🚀 Live" : "🧪 Sandbox"}
                  </span>
                </div>

                {/* Info Box */}
                <div className="card" style={{ background: "#f0f9ff", border: "1px solid #bae6fd", padding: 16, marginTop: 12 }}>
                  <p style={{ margin: 0, fontSize: 13, color: "#0c4a6e" }}>
                    <strong>ℹ️ Note:</strong> Full eTIMS OSCU integration (automatic invoice submission, credit notes, stock management)
                    will be implemented when you have a production KRA account. This configuration prepares your system for connection.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="settings-actions">
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "💾 Save Settings"}
        </button>
      </div>
    </div>
  );
}
