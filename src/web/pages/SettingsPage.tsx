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

// Default AI config keys (must match settings.ts AI_KEYS)
const AI_DEFAULTS = {
  aiPersonality: "",
  aiEnvironment: "",
  aiTone: "",
  aiGoal: "",
  aiBusinessContext: "",
  aiResponseFormatting: "",
  aiQueryReasoning: "",
  aiToolGuidelines: "",
  aiGuardrails: "",
  aiInsightsInstructions: "",
  aiReportInstructions: "",
  aiWelcomeMessage: "",
};

export default function SettingsPage({ config, onSaved }: SettingsPageProps) {
  const [settings, setSettings] = useState({
    businessName: "",
    businessLogoUrl: "",
    businessTagline: "",
    primaryColor: "#3b82f6",
    currency: "",
    timezone: "",
    ...PAYMENT_DEFAULTS,
    ...AI_DEFAULTS,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [activeSection, setActiveSection] = useState<"business" | "payments" | "tax" | "ai" | "tools">("business");

  // Custom tools state
  type ToolType = "sandbox" | "webhook" | "client";
  interface CustomTool {
    id?: string;
    toolType: ToolType;
    name: string;
    label: string;
    description: string;
    parameterSchema: Record<string, unknown>;
    // Sandbox
    code: string;
    runtime: string;
    timeoutMs: number;
    networkEnabled: boolean;
    // Webhook
    webhookUrl: string;
    webhookMethod: string;
    webhookHeaders: Record<string, string>;
    webhookTimeoutSecs: number;
    authType: string;
    authConfig: Record<string, string>;
    pathParamsSchema: Array<Record<string, unknown>>;
    queryParamsSchema: Array<Record<string, unknown>>;
    requestBodySchema: Record<string, unknown>;
    // Client
    expectsResponse: boolean;
    // Shared behaviour (webhook + client)
    disableInterruptions: boolean;
    preToolSpeech: string;
    preToolSpeechText: string;
    executionMode: string;
    toolCallSound: string;
    dynamicVariables: Record<string, unknown>;
    dynamicVariableAssignments: Array<Record<string, unknown>>;
    // Common
    isActive: boolean;
    sortOrder: number;
  }
  const [customTools, setCustomTools] = useState<CustomTool[]>([]);
  const [editingTool, setEditingTool] = useState<CustomTool | null>(null);
  const [testParams, setTestParams] = useState("{}");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testingToolId, setTestingToolId] = useState<string | null>(null);

  const newTool = (): CustomTool => ({
    toolType: "sandbox",
    name: "",
    label: "",
    description: "",
    parameterSchema: {},
    code: "",
    runtime: "bun:1",
    timeoutMs: 30000,
    networkEnabled: false,
    webhookUrl: "",
    webhookMethod: "GET",
    webhookHeaders: {},
    webhookTimeoutSecs: 20,
    authType: "none",
    authConfig: {},
    pathParamsSchema: [],
    queryParamsSchema: [],
    requestBodySchema: {},
    expectsResponse: false,
    disableInterruptions: false,
    preToolSpeech: "auto",
    preToolSpeechText: "",
    executionMode: "immediate",
    toolCallSound: "none",
    dynamicVariables: {},
    dynamicVariableAssignments: [],
    isActive: true,
    sortOrder: 0,
  });

  useEffect(() => {
    loadSettings();
    loadCustomTools();
  }, []);

  const loadCustomTools = async () => {
    try {
      const res = await fetch("/api/custom-tools");
      const json = await res.json();
      if (json.data) setCustomTools(json.data);
    } catch {
      // ignore
    }
  };

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
          currency: json.data.currency || "",
          timezone: json.data.timezone || "",
          // Payment settings
          ...Object.fromEntries(
            Object.keys(PAYMENT_DEFAULTS).map((k) => [k, json.data[k] ?? (PAYMENT_DEFAULTS as Record<string, string>)[k]])
          ),
          // AI settings
          ...Object.fromEntries(
            Object.keys(AI_DEFAULTS).map((k) => [k, json.data[k] ?? (AI_DEFAULTS as Record<string, string>)[k]])
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
        <button
          className={`settings-tab ${activeSection === "ai" ? "active" : ""}`}
          onClick={() => setActiveSection("ai")}
        >
          🤖 AI Configuration
        </button>
        <button
          className={`settings-tab ${activeSection === "tools" ? "active" : ""}`}
          onClick={() => setActiveSection("tools")}
        >
          🧩 Custom Tools
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

              <label>
                <span className="form-label">Currency</span>
                <input
                  type="text"
                  placeholder="e.g. USD, KES, EUR, GBP"
                  value={settings.currency}
                  onChange={(e) => upd("currency", e.target.value.toUpperCase())}
                  maxLength={5}
                  style={{ width: 120 }}
                />
                <span className="form-hint">ISO currency code used for all financial displays. Leave empty for environment default ({config.currency}).</span>
              </label>

              <label>
                <span className="form-label">Timezone</span>
                <input
                  type="text"
                  placeholder="e.g. Africa/Nairobi, America/New_York"
                  value={settings.timezone}
                  onChange={(e) => upd("timezone", e.target.value)}
                />
                <span className="form-hint">IANA timezone for date/time displays. Leave empty for environment default ({config.timezone}).</span>
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

      {/* ═══ AI CONFIGURATION SECTION ═══ */}
      {activeSection === "ai" && (
        <div className="settings-grid">
          {/* Identity & Role */}
          <div className="card settings-card">
            <h3>🧠 Identity & Role</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Define who the AI is, its operating environment, and what it should achieve.
            </p>

            <div className="form-grid" style={{ gap: 16 }}>
              <label>
                <span className="form-label">Personality</span>
                <textarea
                  rows={3}
                  placeholder="e.g. You are a knowledgeable business advisor who speaks like a trusted CFO — data-driven, strategic, and action-oriented."
                  value={settings.aiPersonality}
                  onChange={(e) => upd("aiPersonality", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">Who the AI is — its role, expertise, and character traits. Replaces the default "intelligent business assistant."</span>
              </label>

              <label>
                <span className="form-label">Environment</span>
                <textarea
                  rows={3}
                  placeholder="e.g. You operate inside our company ERP. Users are managers and staff who need quick data answers. You have access to the live database, analytics, and uploaded documents."
                  value={settings.aiEnvironment}
                  onChange={(e) => upd("aiEnvironment", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">Where/how the AI operates — interface context, user types, available capabilities.</span>
              </label>

              <label>
                <span className="form-label">Goal</span>
                <textarea
                  rows={2}
                  placeholder="e.g. Help users make data-driven decisions quickly. Surface actionable insights proactively. Reduce the time it takes to get answers from hours to seconds."
                  value={settings.aiGoal}
                  onChange={(e) => upd("aiGoal", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">The AI's primary objective — what it should help users achieve.</span>
              </label>

              <label>
                <span className="form-label">Welcome Message</span>
                <textarea
                  rows={2}
                  placeholder="e.g. Hello! I'm your Business Assistant. Ask me about sales, inventory, customers, or financial reports."
                  value={settings.aiWelcomeMessage}
                  onChange={(e) => upd("aiWelcomeMessage", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">Greeting shown when a user starts a new chat session.</span>
              </label>
            </div>
          </div>

          {/* Communication Style */}
          <div className="card settings-card">
            <h3>🎨 Communication Style</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Control tone, formatting, and how responses are structured.
            </p>

            <div className="form-grid" style={{ gap: 16 }}>
              <label>
                <span className="form-label">Tone</span>
                <textarea
                  rows={2}
                  placeholder="e.g. Professional but approachable. Use clear, direct language. Avoid jargon unless the user uses it first."
                  value={settings.aiTone}
                  onChange={(e) => upd("aiTone", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">Voice and communication style — enthusiastic, professional, casual, formal, etc.</span>
              </label>

              <label>
                <span className="form-label">Response Formatting</span>
                <textarea
                  rows={4}
                  placeholder={"e.g.\n- Use Markdown headers, bullet points, and tables\n- Always show currency amounts with proper symbols\n- Bold key numbers and totals\n- End with a recommended next step when relevant"}
                  value={settings.aiResponseFormatting}
                  onChange={(e) => upd("aiResponseFormatting", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">How to format output — markdown rules, currency display, table usage, section structure.</span>
              </label>
            </div>
          </div>

          {/* Business Knowledge */}
          <div className="card settings-card">
            <h3>🏢 Business Knowledge</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Give the AI context about your business so it can provide more relevant answers.
            </p>

            <div className="form-grid" style={{ gap: 16 }}>
              <label>
                <span className="form-label">Business Context</span>
                <textarea
                  rows={4}
                  placeholder="e.g. We are a B2B wholesale distributor. Our peak season is Q4. We serve 200+ retail clients across 3 regions. Key product lines: electronics, home appliances, and outdoor equipment."
                  value={settings.aiBusinessContext}
                  onChange={(e) => upd("aiBusinessContext", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">Domain knowledge — products, policies, specialties, seasonality, customer segments. Shared across all AI agents.</span>
              </label>
            </div>
          </div>

          {/* Tool & Query Behavior */}
          <div className="card settings-card">
            <h3>🔧 Tool & Query Behavior</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Guide how the AI reasons about questions and selects tools.
            </p>

            <div className="form-grid" style={{ gap: 16 }}>
              <label>
                <span className="form-label">Query Reasoning</span>
                <textarea
                  rows={3}
                  placeholder={"e.g.\n- Before querying, consider which date range makes sense for the question\n- For financial questions, always cross-check against the payments table\n- When comparing periods, use percentage change, not just absolute numbers"}
                  value={settings.aiQueryReasoning}
                  onChange={(e) => upd("aiQueryReasoning", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">Instructions for how the AI should think and reason before calling tools.</span>
              </label>

              <label>
                <span className="form-label">Tool Usage Guidelines</span>
                <textarea
                  rows={4}
                  placeholder={"e.g.\n- For inventory questions, query inventory + inventory_transactions tables\n- For customer insights, check orders + payments together\n- Always check low stock before recommending purchasing actions\n- Use reports for overview questions, database for specific queries"}
                  value={settings.aiToolGuidelines}
                  onChange={(e) => upd("aiToolGuidelines", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">When to use which tool — overrides the default tool selection logic.</span>
              </label>
            </div>
          </div>

          {/* Safety & Guardrails */}
          <div className="card settings-card">
            <h3>🛡️ Safety & Guardrails</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Set boundaries and safety rules for the AI.
            </p>

            <div className="form-grid" style={{ gap: 16 }}>
              <label>
                <span className="form-label">Guardrails</span>
                <textarea
                  rows={4}
                  placeholder={"e.g.\n- Never disclose raw employee salary data\n- Don't make promises about delivery dates — provide estimates only\n- If asked about competitor pricing, decline politely\n- Escalate to a human when the user expresses frustration more than twice"}
                  value={settings.aiGuardrails}
                  onChange={(e) => upd("aiGuardrails", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">Safety rules, boundaries, topics to avoid, escalation policies, data access constraints.</span>
              </label>
            </div>
          </div>

          {/* Specialized Agent Instructions */}
          <div className="card settings-card">
            <h3>📊 Specialized Agent Instructions</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Customize instructions for the insights analyzer and report generator agents.
            </p>

            <div className="form-grid" style={{ gap: 16 }}>
              <label>
                <span className="form-label">Insights Analysis Instructions</span>
                <textarea
                  rows={4}
                  placeholder={"e.g.\n- Focus on conversion rates and seasonal demand patterns\n- Flag any significant month-over-month changes (>20%)\n- Compare revenue per category, not just totals\n- Consider external factors in recommendations"}
                  value={settings.aiInsightsInstructions}
                  onChange={(e) => upd("aiInsightsInstructions", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">Custom instructions for demand forecasting, anomaly detection, and sales trend analysis.</span>
              </label>

              <label>
                <span className="form-label">Report Generation Instructions</span>
                <textarea
                  rows={4}
                  placeholder={"e.g.\n1. Executive Summary with key performance highlights\n2. Revenue breakdown by product category\n3. Customer acquisition and retention metrics\n4. Inventory turnover and health\n5. Forward-looking recommendations"}
                  value={settings.aiReportInstructions}
                  onChange={(e) => upd("aiReportInstructions", e.target.value)}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">Custom structure and focus areas for generated business reports.</span>
              </label>
            </div>
          </div>

          {/* Info box */}
          <div className="card" style={{ background: "#f0f9ff", border: "1px solid #bae6fd", padding: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#0c4a6e" }}>
              <strong>💡 How it works:</strong> These settings are loaded by the AI agents at request time. Changes take effect immediately on the next chat message — no redeployment needed. Leave any field empty to use built-in defaults. The AI always knows your configured terminology ({config.labels.product}, {config.labels.order}, etc.) and currency ({config.currency}) automatically.
            </p>
          </div>
        </div>
      )}

      {/* ═══ CUSTOM TOOLS SECTION ═══ */}
      {activeSection === "tools" && (
        <div className="settings-grid">
          {/* Editor / Creator */}
          <div className="card settings-card">
            <h3>{editingTool?.id ? "✏️ Edit Tool" : "➕ Create Custom Tool"}</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Define custom tools the AI assistant can invoke. Choose a type: <strong>Sandbox</strong> (run code), <strong>Webhook</strong> (call external API), or <strong>Client</strong> (trigger UI action).
            </p>

            <div className="form-grid" style={{ gap: 12 }}>
              {/* Tool Type Selector */}
              <div>
                <span className="form-label">Tool Type</span>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  {([
                    { value: "sandbox" as ToolType, icon: "🖥️", label: "Sandbox", desc: "Run code in isolated container" },
                    { value: "webhook" as ToolType, icon: "🌐", label: "Webhook", desc: "Call an external API endpoint" },
                    { value: "client" as ToolType, icon: "📱", label: "Client", desc: "Trigger a UI action in the browser" },
                  ] as const).map((tt) => (
                    <button
                      key={tt.value}
                      onClick={() => setEditingTool((prev) => ({ ...(prev ?? newTool()), toolType: tt.value }))}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: `2px solid ${(editingTool?.toolType ?? "sandbox") === tt.value ? "#3b82f6" : "#e5e7eb"}`,
                        background: (editingTool?.toolType ?? "sandbox") === tt.value ? "#eff6ff" : "#fafafa",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ fontSize: 16 }}>{tt.icon} {tt.label}</div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{tt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Common fields */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span className="form-label">Tool Name</span>
                  <input
                    type="text"
                    placeholder="e.g. calculate_markup"
                    value={editingTool?.name ?? ""}
                    onChange={(e) => {
                      const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                      setEditingTool((prev) => ({ ...(prev ?? newTool()), name: val }));
                    }}
                  />
                  <span className="form-hint">Unique snake_case identifier (used by the AI)</span>
                </label>
                <label>
                  <span className="form-label">Display Label</span>
                  <input
                    type="text"
                    placeholder="e.g. Calculate Markup"
                    value={editingTool?.label ?? ""}
                    onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), label: e.target.value }))}
                  />
                  <span className="form-hint">Human-readable name shown in the UI</span>
                </label>
              </div>

              <label>
                <span className="form-label">Description (for the AI)</span>
                <textarea
                  rows={2}
                  placeholder="e.g. Calculate the selling price given a cost price and desired markup percentage."
                  value={editingTool?.description ?? ""}
                  onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), description: e.target.value }))}
                  style={{ resize: "vertical" }}
                />
                <span className="form-hint">Tells the AI when and why to use this tool</span>
              </label>

              <label>
                <span className="form-label">Parameters (JSON Schema)</span>
                <textarea
                  rows={3}
                  placeholder={'{\n  "cost_price": { "type": "number", "description": "Cost price" }\n}'}
                  value={editingTool ? JSON.stringify(editingTool.parameterSchema, null, 2) : "{}"}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      setEditingTool((prev) => ({ ...(prev ?? newTool()), parameterSchema: parsed }));
                    } catch { /* Allow invalid JSON while typing */ }
                  }}
                  style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                />
              </label>

              {/* ── Sandbox-specific fields ── */}
              {(editingTool?.toolType ?? "sandbox") === "sandbox" && (
                <>
                  <label>
                    <span className="form-label">Code (TypeScript/JavaScript)</span>
                    <textarea
                      rows={8}
                      placeholder={'async function execute(params) {\n  const { cost_price, markup_pct } = params;\n  return { selling_price: cost_price * (1 + markup_pct / 100) };\n}'}
                      value={editingTool?.code ?? ""}
                      onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), code: e.target.value }))}
                      style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                    />
                    <span className="form-hint">Must define an <code>execute(params)</code> function.</span>
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <label>
                      <span className="form-label">Runtime</span>
                      <select
                        value={editingTool?.runtime ?? "bun:1"}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), runtime: e.target.value }))}
                      >
                        <option value="bun:1">Bun 1.x</option>
                        <option value="node">Node.js</option>
                        <option value="python">Python</option>
                      </select>
                    </label>
                    <label>
                      <span className="form-label">Timeout (ms)</span>
                      <input type="number" min={1000} max={120000} step={1000}
                        value={editingTool?.timeoutMs ?? 30000}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), timeoutMs: Number(e.target.value) }))}
                      />
                    </label>
                    <label>
                      <span className="form-label">Network</span>
                      <select
                        value={editingTool?.networkEnabled ? "true" : "false"}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), networkEnabled: e.target.value === "true" }))}
                      >
                        <option value="false">❌ Disabled</option>
                        <option value="true">✅ Enabled</option>
                      </select>
                    </label>
                  </div>
                </>
              )}

              {/* ── Webhook-specific fields ── */}
              {editingTool?.toolType === "webhook" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
                    <label>
                      <span className="form-label">URL</span>
                      <input type="text" placeholder="https://api.example.com/v1/action"
                        value={editingTool.webhookUrl ?? ""}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), webhookUrl: e.target.value }))}
                      />
                      <span className="form-hint">Supports {"{{variable}}"} placeholders and {"{path_param}"} interpolation</span>
                    </label>
                    <label>
                      <span className="form-label">Method</span>
                      <select value={editingTool.webhookMethod ?? "GET"}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), webhookMethod: e.target.value }))}>
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="PATCH">PATCH</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </label>
                    <label>
                      <span className="form-label">Timeout (s)</span>
                      <input type="number" min={1} max={120} value={editingTool.webhookTimeoutSecs ?? 20}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), webhookTimeoutSecs: Number(e.target.value) }))}
                      />
                    </label>
                  </div>

                  {/* Authentication */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
                    <label>
                      <span className="form-label">Authentication</span>
                      <select value={editingTool.authType ?? "none"}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), authType: e.target.value }))}>
                        <option value="none">None</option>
                        <option value="api_key">API Key</option>
                        <option value="bearer">Bearer Token</option>
                        <option value="basic">Basic Auth</option>
                        <option value="oauth2">OAuth 2.0</option>
                      </select>
                    </label>
                    {editingTool.authType === "bearer" && (
                      <label>
                        <span className="form-label">Bearer Token</span>
                        <input type="password" placeholder="your-api-token"
                          value={editingTool.authConfig?.token ?? ""}
                          onChange={(e) => setEditingTool((prev) => ({
                            ...(prev ?? newTool()), authConfig: { ...(prev?.authConfig ?? {}), token: e.target.value }
                          }))}
                        />
                      </label>
                    )}
                    {editingTool.authType === "api_key" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <label>
                          <span className="form-label">Header Name</span>
                          <input type="text" placeholder="X-API-Key"
                            value={editingTool.authConfig?.headerName ?? ""}
                            onChange={(e) => setEditingTool((prev) => ({
                              ...(prev ?? newTool()), authConfig: { ...(prev?.authConfig ?? {}), headerName: e.target.value }
                            }))}
                          />
                        </label>
                        <label>
                          <span className="form-label">API Key</span>
                          <input type="password" placeholder="sk-..."
                            value={editingTool.authConfig?.apiKey ?? ""}
                            onChange={(e) => setEditingTool((prev) => ({
                              ...(prev ?? newTool()), authConfig: { ...(prev?.authConfig ?? {}), apiKey: e.target.value }
                            }))}
                          />
                        </label>
                      </div>
                    )}
                    {editingTool.authType === "basic" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <label>
                          <span className="form-label">Username</span>
                          <input type="text"
                            value={editingTool.authConfig?.username ?? ""}
                            onChange={(e) => setEditingTool((prev) => ({
                              ...(prev ?? newTool()), authConfig: { ...(prev?.authConfig ?? {}), username: e.target.value }
                            }))}
                          />
                        </label>
                        <label>
                          <span className="form-label">Password</span>
                          <input type="password"
                            value={editingTool.authConfig?.password ?? ""}
                            onChange={(e) => setEditingTool((prev) => ({
                              ...(prev ?? newTool()), authConfig: { ...(prev?.authConfig ?? {}), password: e.target.value }
                            }))}
                          />
                        </label>
                      </div>
                    )}
                    {editingTool.authType === "oauth2" && (
                      <label>
                        <span className="form-label">Access Token</span>
                        <input type="password" placeholder="Obtained via OAuth flow"
                          value={editingTool.authConfig?.accessToken ?? ""}
                          onChange={(e) => setEditingTool((prev) => ({
                            ...(prev ?? newTool()), authConfig: { ...(prev?.authConfig ?? {}), accessToken: e.target.value }
                          }))}
                        />
                      </label>
                    )}
                  </div>

                  {/* Headers */}
                  <label>
                    <span className="form-label">Headers (JSON)</span>
                    <textarea rows={2}
                      placeholder={'{ "X-Custom-Header": "value" }'}
                      value={editingTool ? JSON.stringify(editingTool.webhookHeaders ?? {}, null, 2) : "{}"}
                      onChange={(e) => {
                        try { setEditingTool((prev) => ({ ...(prev ?? newTool()), webhookHeaders: JSON.parse(e.target.value) })); } catch { /* typing */ }
                      }}
                      style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                    />
                    <span className="form-hint">Extra headers (auth is added automatically based on the selection above)</span>
                  </label>

                  {/* Path Parameters */}
                  <label>
                    <span className="form-label">Path Parameters (JSON array)</span>
                    <textarea rows={2}
                      placeholder={'[{ "name": "user_id", "description": "User ID", "required": true }]'}
                      value={editingTool ? JSON.stringify(editingTool.pathParamsSchema ?? [], null, 2) : "[]"}
                      onChange={(e) => {
                        try { setEditingTool((prev) => ({ ...(prev ?? newTool()), pathParamsSchema: JSON.parse(e.target.value) })); } catch { /* typing */ }
                      }}
                      style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                    />
                    <span className="form-hint">Define path segments like {"{user_id}"} in your URL above</span>
                  </label>

                  {/* Query Parameters */}
                  <label>
                    <span className="form-label">Query Parameters (JSON array)</span>
                    <textarea rows={2}
                      placeholder={'[{ "name": "limit", "default": "10" }, { "name": "offset", "default": "0" }]'}
                      value={editingTool ? JSON.stringify(editingTool.queryParamsSchema ?? [], null, 2) : "[]"}
                      onChange={(e) => {
                        try { setEditingTool((prev) => ({ ...(prev ?? newTool()), queryParamsSchema: JSON.parse(e.target.value) })); } catch { /* typing */ }
                      }}
                      style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                    />
                    <span className="form-hint">Default query parameters appended to the URL</span>
                  </label>

                  {/* Request Body Schema (for POST/PUT/PATCH) */}
                  {(editingTool.webhookMethod === "POST" || editingTool.webhookMethod === "PUT" || editingTool.webhookMethod === "PATCH") && (
                    <label>
                      <span className="form-label">Request Body Schema (JSON)</span>
                      <textarea rows={3}
                        placeholder={'{ "message": { "type": "string" }, "priority": { "type": "number", "default": 1 } }'}
                        value={editingTool ? JSON.stringify(editingTool.requestBodySchema ?? {}, null, 2) : "{}"}
                        onChange={(e) => {
                          try { setEditingTool((prev) => ({ ...(prev ?? newTool()), requestBodySchema: JSON.parse(e.target.value) })); } catch { /* typing */ }
                        }}
                        style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                      />
                      <span className="form-hint">Defines the structure of the JSON body sent with the request</span>
                    </label>
                  )}
                </>
              )}

              {/* ── Client-specific fields ── */}
              {editingTool?.toolType === "client" && (
                <div className="card" style={{ background: "#f0f9ff", border: "1px solid #bae6fd", padding: 16 }}>
                  <p style={{ margin: 0, fontSize: 13, color: "#0c4a6e", marginBottom: 12 }}>
                    <strong>📱 Client tools</strong> emit a structured action to the browser via SSE. The frontend handles it (show modals, navigate, display cards).
                  </p>
                  <label>
                    <span className="form-label">Wait for Response?</span>
                    <select
                      value={editingTool.expectsResponse ? "true" : "false"}
                      onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), expectsResponse: e.target.value === "true" }))}
                    >
                      <option value="false">No — fire and forget</option>
                      <option value="true">Yes — wait for user input</option>
                    </select>
                    <span className="form-hint">If yes, the AI pauses until the frontend responds.</span>
                  </label>
                </div>
              )}

              {/* ── Shared behaviour fields (webhook + client) ── */}
              {(editingTool?.toolType === "webhook" || editingTool?.toolType === "client") && (
                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                  <span className="form-label" style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "block" }}>Behaviour Settings</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                    <label>
                      <span className="form-label">Execution Mode</span>
                      <select
                        value={editingTool?.executionMode ?? "immediate"}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), executionMode: e.target.value }))}
                      >
                        <option value="immediate">Immediate</option>
                        <option value="confirm">Ask User First</option>
                      </select>
                    </label>
                    <label>
                      <span className="form-label">Pre-tool Speech</span>
                      <select
                        value={editingTool?.preToolSpeech ?? "auto"}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), preToolSpeech: e.target.value }))}
                      >
                        <option value="auto">Auto</option>
                        <option value="custom">Custom Text</option>
                        <option value="none">None</option>
                      </select>
                    </label>
                    <label>
                      <span className="form-label">Disable Interruptions</span>
                      <select
                        value={editingTool?.disableInterruptions ? "true" : "false"}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), disableInterruptions: e.target.value === "true" }))}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    </label>
                    <label>
                      <span className="form-label">Tool Call Sound</span>
                      <select
                        value={editingTool?.toolCallSound ?? "none"}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), toolCallSound: e.target.value }))}
                      >
                        <option value="none">None</option>
                        <option value="chime">Chime</option>
                        <option value="click">Click</option>
                        <option value="beep">Beep</option>
                      </select>
                    </label>
                  </div>
                  {editingTool?.preToolSpeech === "custom" && (
                    <label style={{ marginTop: 8 }}>
                      <span className="form-label">Custom Pre-tool Text</span>
                      <input type="text" placeholder="e.g. Let me check that for you..."
                        value={editingTool.preToolSpeechText ?? ""}
                        onChange={(e) => setEditingTool((prev) => ({ ...(prev ?? newTool()), preToolSpeechText: e.target.value }))}
                      />
                    </label>
                  )}
                </div>
              )}

              {/* ── Dynamic Variables (all types) ── */}
              {(editingTool?.toolType === "webhook" || editingTool?.toolType === "client") && (
                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                  <span className="form-label" style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "block" }}>Dynamic Variables</span>
                  <label>
                    <span className="form-label">Variables (JSON)</span>
                    <textarea rows={2}
                      placeholder={'{ "user_id": "string", "session_id": "string" }'}
                      value={editingTool ? JSON.stringify(editingTool.dynamicVariables ?? {}, null, 2) : "{}"}
                      onChange={(e) => {
                        try { setEditingTool((prev) => ({ ...(prev ?? newTool()), dynamicVariables: JSON.parse(e.target.value) })); } catch { /* typing */ }
                      }}
                      style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                    />
                    <span className="form-hint">Template variables available in URL, headers, and body via {"{{var_name}}"}</span>
                  </label>
                  <label style={{ marginTop: 8 }}>
                    <span className="form-label">Variable Assignments (JSON array)</span>
                    <textarea rows={2}
                      placeholder={'[{ "var": "user_id", "source": "session.userId", "default": "anonymous" }]'}
                      value={editingTool ? JSON.stringify(editingTool.dynamicVariableAssignments ?? [], null, 2) : "[]"}
                      onChange={(e) => {
                        try { setEditingTool((prev) => ({ ...(prev ?? newTool()), dynamicVariableAssignments: JSON.parse(e.target.value) })); } catch { /* typing */ }
                      }}
                      style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                    />
                    <span className="form-hint">How to populate each variable at runtime (source field or default value)</span>
                  </label>
                </div>
              )}

              {/* Save / Cancel */}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={
                    !editingTool?.name || !editingTool?.label ||
                    ((editingTool?.toolType ?? "sandbox") === "sandbox" && !editingTool?.code) ||
                    (editingTool?.toolType === "webhook" && !editingTool?.webhookUrl)
                  }
                  onClick={async () => {
                    if (!editingTool) return;
                    try {
                      const method = editingTool.id ? "PUT" : "POST";
                      const url = editingTool.id ? `/api/custom-tools/${editingTool.id}` : "/api/custom-tools";
                      const res = await fetch(url, {
                        method,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(editingTool),
                      });
                      if (res.ok) {
                        setMessage({ type: "success", text: `Tool "${editingTool.label}" saved!` });
                        setEditingTool(null);
                        loadCustomTools();
                      } else {
                        const err = await res.json();
                        setMessage({ type: "error", text: err.error || "Failed to save tool" });
                      }
                    } catch {
                      setMessage({ type: "error", text: "Network error saving tool" });
                    }
                  }}
                >
                  {editingTool?.id ? "💾 Update Tool" : "➕ Create Tool"}
                </button>
                {editingTool && (
                  <button className="btn btn-secondary" onClick={() => setEditingTool(null)}>Cancel</button>
                )}
              </div>
            </div>
          </div>

          {/* ── Tools Table ── */}
          <div className="card settings-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>🧩 Your Custom Tools</h3>
              <span className="text-muted" style={{ fontSize: 12 }}>
                {customTools.length} tool{customTools.length !== 1 ? "s" : ""}
              </span>
            </div>

            {customTools.length === 0 ? (
              <p className="text-muted">No custom tools defined yet. Create one above.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
                      <th style={{ padding: "6px 8px", fontWeight: 600, color: "#374151" }}>Name</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, color: "#374151" }}>Type</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, color: "#374151" }}>Description</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, color: "#374151" }}>Mode</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, color: "#374151", textAlign: "center" }}>Status</th>
                      <th style={{ padding: "6px 8px", fontWeight: 600, color: "#374151", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customTools.map((t) => {
                      const typeIcon = t.toolType === "webhook" ? "🌐" : t.toolType === "client" ? "📱" : "🖥️";
                      const typeLabel = t.toolType === "webhook" ? "Webhook" : t.toolType === "client" ? "Client" : "Sandbox";
                      return (
                        <tr key={t.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "8px 8px" }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</div>
                            <div style={{ color: "#64748b", fontFamily: "monospace", fontSize: 11 }}>{t.name}</div>
                          </td>
                          <td style={{ padding: "8px 8px" }}>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#e0e7ff", color: "#3730a3", whiteSpace: "nowrap" }}>
                              {typeIcon} {typeLabel}
                            </span>
                          </td>
                          <td style={{ padding: "8px 8px", color: "#6b7280", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.description.slice(0, 60)}{t.description.length > 60 ? "…" : ""}
                          </td>
                          <td style={{ padding: "8px 8px", fontSize: 11, color: "#64748b", textTransform: "capitalize" }}>
                            {(t as any).executionMode ?? "immediate"}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "center" }}>
                            <span style={{
                              fontSize: 10, padding: "2px 8px", borderRadius: 4,
                              background: t.isActive ? "#dcfce7" : "#f3f4f6",
                              color: t.isActive ? "#166534" : "#6b7280",
                            }}>
                              {t.isActive ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <button className="btn btn-sm" style={{ fontSize: 11, padding: "3px 8px", marginRight: 4 }}
                              onClick={() => setEditingTool({ ...t })}>
                              ✏️
                            </button>
                            <button className="btn btn-sm" style={{ fontSize: 11, padding: "3px 8px", marginRight: 4 }}
                              onClick={async () => {
                                setTestingToolId(t.id!);
                                setTestResult(null);
                                try {
                                  const params = JSON.parse(testParams);
                                  const res = await fetch(`/api/custom-tools/${t.id}/test`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ params }),
                                  });
                                  const json = await res.json();
                                  setTestResult(JSON.stringify(json.data ?? json, null, 2));
                                } catch (err: any) {
                                  setTestResult(`Error: ${err.message}`);
                                }
                                setTestingToolId(null);
                              }}>
                              {testingToolId === t.id ? "⏳" : "▶️"}
                            </button>
                            <button className="btn btn-sm" style={{ fontSize: 11, padding: "3px 8px", color: "#dc2626" }}
                              onClick={async () => {
                                if (!confirm(`Delete tool "${t.label}"?`)) return;
                                await fetch(`/api/custom-tools/${t.id}`, { method: "DELETE" });
                                loadCustomTools();
                              }}>
                              🗑️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Test panel */}
            <div style={{ marginTop: 12 }}>
              <label>
                <span className="form-label" style={{ fontSize: 12 }}>Test Parameters (JSON)</span>
                <textarea rows={2} value={testParams}
                  onChange={(e) => setTestParams(e.target.value)}
                  style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
                  placeholder='{"cost_price": 100, "markup_pct": 30}'
                />
              </label>
              {testResult && (
                <pre style={{
                  background: "#1e293b", color: "#e2e8f0", padding: 12, borderRadius: 8,
                  fontSize: 12, overflow: "auto", maxHeight: 200, marginTop: 8,
                }}>
                  {testResult}
                </pre>
              )}
            </div>
          </div>

          {/* Info box */}
          <div className="card" style={{ background: "#f0f9ff", border: "1px solid #bae6fd", padding: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#0c4a6e" }}>
              <strong>💡 How custom tools work:</strong> The AI discovers active tools at request time and invokes them when relevant.
              <strong> Sandbox</strong> tools run code in isolated containers.
              <strong> Webhook</strong> tools call external APIs with full auth, path/query params, and request body support.
              <strong> Client</strong> tools trigger actions in the user's browser via SSE.
              Add as many tools as you need — changes take effect immediately.
            </p>
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
