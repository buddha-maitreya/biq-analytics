import React from "react";
import type { AppConfig } from "../types";

interface AboutPageProps {
  config: AppConfig;
}

const CAPABILITIES = [
  {
    icon: "🧠",
    title: "AI-Native Architecture",
    description:
      "Not a legacy system with AI bolted on. Every workflow — from inventory forecasting to report generation — is powered by AI agents that reason, learn, and act autonomously.",
  },
  {
    icon: "💬",
    title: "Conversational Intelligence",
    description:
      "Ask your business questions in plain English. The AI Assistant understands your data, generates insights, and can execute actions — no dashboards to learn, no reports to build.",
  },
  {
    icon: "📊",
    title: "AI-Generated Reports",
    description:
      "Select a time period and let AI analyze your data to produce executive-ready reports with trends, anomalies, and actionable recommendations. Export as PDF, Excel, or CSV.",
  },
  {
    icon: "🔍",
    title: "KRA/eTIMS Compliance",
    description:
      "Built-in KRA PIN validation, TCC verification, eTIMS invoice submission, and VAT withholding — keeping your business compliant with Kenyan tax regulations automatically.",
  },
  {
    icon: "🏭",
    title: "Multi-Location Inventory",
    description:
      "Track stock across unlimited warehouses, branches, or stores. AI monitors levels in real-time and alerts you before stockouts happen — not after.",
  },
  {
    icon: "🔐",
    title: "Enterprise Security",
    description:
      "JWT authentication, role-based access control with 5-tier permissions, per-warehouse access scoping, and complete audit trails. Your data stays yours.",
  },
  {
    icon: "🌍",
    title: "Industry-Agnostic Design",
    description:
      "One platform, any industry. Safari companies, restaurants, hardware stores, chemical suppliers — configure labels, units, and workflows without touching code.",
  },
  {
    icon: "⚡",
    title: "Real-Time Everything",
    description:
      "WebSocket-powered live updates. When stock moves, an order lands, or a payment clears — every connected user sees it instantly. No refresh needed.",
  },
];

const DIFFERENTIATORS = [
  {
    stat: "Zero",
    label: "External AI Libraries",
    detail: "Pure Agentuity agents — no LangChain, no vector DB bolt-ons",
  },
  {
    stat: "5-Tier",
    label: "Role Hierarchy",
    detail: "Super Admin → Admin → Manager → Staff → Viewer",
  },
  {
    stat: "100%",
    label: "Config-Driven",
    detail: "Change the industry by changing environment variables",
  },
  {
    stat: "Single",
    label: "Tenant Isolation",
    detail: "Dedicated DB, compute, and storage per client",
  },
];

export default function AboutPage({ config }: AboutPageProps) {
  return (
    <div className="about-page">
      {/* Hero */}
      <section className="about-hero">
        <div className="about-hero-badge">AI-NATIVE SOFTWARE</div>
        <h1 className="about-hero-title">
          Business IQ Enterprise
        </h1>
        <p className="about-hero-subtitle">
          The intelligent inventory &amp; sales management platform that
          doesn't just store your data — it <em>understands</em> it.
        </p>
      </section>

      {/* What Makes It Different */}
      <section className="about-section">
        <h2 className="about-section-title">What Makes It Different</h2>
        <p className="about-section-intro">
          Most business software treats AI as a feature. We built the entire
          platform around it. Every module — inventory, orders, invoices,
          reports, compliance — is orchestrated by autonomous AI agents that
          collaborate to run your business.
        </p>
        <div className="about-stats-grid">
          {DIFFERENTIATORS.map((d, i) => (
            <div key={i} className="about-stat-card">
              <div className="about-stat-number">{d.stat}</div>
              <div className="about-stat-label">{d.label}</div>
              <div className="about-stat-detail">{d.detail}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities */}
      <section className="about-section">
        <h2 className="about-section-title">Platform Capabilities</h2>
        <div className="about-capabilities-grid">
          {CAPABILITIES.map((cap, i) => (
            <div key={i} className="about-capability-card">
              <div className="about-capability-icon">{cap.icon}</div>
              <h3 className="about-capability-title">{cap.title}</h3>
              <p className="about-capability-desc">{cap.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tech Stack */}
      <section className="about-section">
        <h2 className="about-section-title">Built With</h2>
        <div className="about-tech-grid">
          {[
            { name: "Agentuity", role: "AI Agent Platform" },
            { name: "Bun", role: "Runtime" },
            { name: "TypeScript", role: "Language" },
            { name: "React", role: "Frontend" },
            { name: "Hono", role: "API Framework" },
            { name: "Neon Postgres", role: "Database" },
            { name: "Drizzle ORM", role: "Data Layer" },
            { name: "Vercel AI SDK", role: "AI Integration" },
            { name: "jose", role: "JWT Auth" },
          ].map((t, i) => (
            <div key={i} className="about-tech-chip">
              <span className="about-tech-name">{t.name}</span>
              <span className="about-tech-role">{t.role}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Philosophy */}
      <section className="about-section about-philosophy">
        <blockquote className="about-quote">
          "The best business software is the one that runs itself. We built
          Business IQ Enterprise so you can focus on growing your business
          while AI handles the rest."
        </blockquote>
        <div className="about-version">
          <span>Business IQ Enterprise v1.0.0</span>
          <span className="about-separator">·</span>
          <span>© 2026 Ruskins AI Consulting LTD</span>
        </div>
      </section>
    </div>
  );
}
