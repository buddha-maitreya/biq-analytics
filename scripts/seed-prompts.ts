/**
 * Seed Prompt Templates — CLI Fallback (Static Templates)
 *
 * This script provides OFFLINE / no-API-key seeding of prompt templates
 * using hardcoded industry-aware content. For AI-generated templates,
 * use the UI instead: Admin Console → Prompt Templates → 🌱 AI Seed.
 *
 * The primary workflow is the UI-based AI seed which uses the configured
 * LLM to generate rich, industry-specific templates dynamically.
 *
 * Usage (CLI fallback):
 *   DATABASE_URL=<your-url> bun scripts/seed-prompts.ts
 *   DATABASE_URL=<your-url> bun scripts/seed-prompts.ts --industry=Hospitality --sub=Tourism
 *
 * Idempotent — skips insertion if templates already exist for a given agent+section.
 */

import { createPostgresDrizzle } from "@agentuity/drizzle";
import * as schema from "../src/db/schema";
import { promptTemplates, businessSettings } from "../src/db/schema";
import { eq, and } from "drizzle-orm";

const { db, close } = createPostgresDrizzle({ schema });

// ────────────────────────────────────────────────────────────
// Industry context builder
// ────────────────────────────────────────────────────────────

interface IndustryContext {
  industry: string;
  subIndustry: string;
  /** Short phrase describing what the business does, used in prompt templates */
  descriptor: string;
  /** Industry-specific terminology hints for the AI */
  terminology: string;
  /** Domain-specific guardrails */
  guardrails: string;
  /** Business context paragraph */
  businessContext: string;
}

function buildIndustryContext(industry: string, subIndustry: string): IndustryContext {
  const key = `${industry}::${subIndustry}`.toLowerCase();

  // Industry-specific descriptors
  const descriptors: Record<string, string> = {
    "hospitality::tourism":
      "a safari and tourism business specializing in wildlife experiences, lodge bookings, and expedition planning",
    "hospitality::hotels & lodging":
      "a hospitality business managing hotel rooms, guest services, and accommodation bookings",
    "hospitality::restaurants & catering":
      "a food service business managing menus, table reservations, and catering orders",
    "retail::fashion & apparel":
      "a fashion retail business managing clothing lines, seasonal collections, and style inventory",
    "retail::grocery & supermarket":
      "a grocery retail business managing perishable goods, shelf stock, and daily replenishment",
    "retail::electronics":
      "an electronics retail business managing tech products, warranties, and supplier relationships",
    "agriculture::crop farming":
      "an agricultural business managing crop production, harvest cycles, and farm-to-market operations",
    "agriculture::dairy":
      "a dairy farming and processing business managing milk production, cold chain, and distribution",
    "agriculture::livestock":
      "a livestock business managing animal husbandry, breeding records, and market sales",
    "food & beverage::restaurants":
      "a restaurant business managing menus, kitchen operations, and dining service",
    "manufacturing::textiles":
      "a textile manufacturing business managing fabric production, looms, and wholesale orders",
    "healthcare::hospitals & clinics":
      "a healthcare facility managing medical supplies, patient services, and pharmaceutical inventory",
    "technology::software & saas":
      "a software company managing subscription licenses, support tickets, and product releases",
    "construction::residential":
      "a residential construction company managing building materials, project timelines, and contractor supplies",
    "transport::logistics & freight":
      "a logistics company managing fleet operations, shipment tracking, and warehouse distribution",
    "professional services::consulting":
      "a consulting firm managing client engagements, deliverables, and billable resources",
  };

  // Fallback descriptor from industry alone
  const industryOnly: Record<string, string> = {
    hospitality: "a hospitality business managing guest services, bookings, and facility operations",
    retail: "a retail business managing product inventory, sales, and customer relationships",
    "food & beverage": "a food and beverage business managing menus, ingredients, and service operations",
    agriculture: "an agricultural business managing production, harvest cycles, and supply chain",
    manufacturing: "a manufacturing business managing production lines, raw materials, and order fulfillment",
    healthcare: "a healthcare business managing medical supplies, services, and patient operations",
    education: "an educational institution managing courses, resources, and student services",
    technology: "a technology business managing products, services, and client solutions",
    construction: "a construction business managing materials, projects, and contractor operations",
    transport: "a transport and logistics business managing fleet, shipments, and route planning",
    "professional services": "a professional services firm managing client projects, billing, and resources",
    "beauty & personal care": "a beauty and personal care business managing appointments, products, and treatments",
    energy: "an energy business managing resources, distribution, and infrastructure",
    "arts & entertainment": "an entertainment business managing events, productions, and ticket sales",
  };

  const descriptor =
    descriptors[key] ??
    industryOnly[industry.toLowerCase()] ??
    "a business managing inventory, sales, and customer relationships";

  // Industry-specific terminology
  const terminologyMap: Record<string, string> = {
    hospitality:
      "In this industry: {{PRODUCT_LABEL_PLURAL}} may include room types, safari packages, tours, meals, or experiences. " +
      "{{CUSTOMER_LABEL_PLURAL}} are guests or travelers. {{ORDER_LABEL_PLURAL}} are bookings or reservations. " +
      "Seasonality (high/low season) is a major factor in pricing and demand.",
    retail:
      "In this industry: {{PRODUCT_LABEL_PLURAL}} are items on shelves or online. " +
      "{{CUSTOMER_LABEL_PLURAL}} may be walk-in shoppers or account holders. {{ORDER_LABEL_PLURAL}} are sales transactions. " +
      "Stock turnover, shrinkage, and seasonal promotions are key metrics.",
    "food & beverage":
      "In this industry: {{PRODUCT_LABEL_PLURAL}} include menu items and ingredients. " +
      "{{CUSTOMER_LABEL_PLURAL}} are diners or catering clients. {{ORDER_LABEL_PLURAL}} are food orders or catering contracts. " +
      "Perishability, food costing (COGS %), and waste reduction are critical.",
    agriculture:
      "In this industry: {{PRODUCT_LABEL_PLURAL}} are crops, produce, or livestock outputs. " +
      "{{CUSTOMER_LABEL_PLURAL}} are buyers, cooperatives, or distributors. {{ORDER_LABEL_PLURAL}} are harvest sales or contracts. " +
      "Yield per hectare, weather impact, and market prices drive decisions.",
    manufacturing:
      "In this industry: {{PRODUCT_LABEL_PLURAL}} are finished goods or components. " +
      "{{CUSTOMER_LABEL_PLURAL}} are wholesalers, distributors, or OEM buyers. {{ORDER_LABEL_PLURAL}} are production or purchase orders. " +
      "Bill of materials (BOM), production capacity, and lead times are critical.",
    healthcare:
      "In this industry: {{PRODUCT_LABEL_PLURAL}} include medical supplies, drugs, and equipment. " +
      "{{CUSTOMER_LABEL_PLURAL}} are patients or facilities. {{ORDER_LABEL_PLURAL}} are purchase orders or prescriptions. " +
      "Expiry tracking, cold chain compliance, and regulatory requirements are essential.",
    technology:
      "In this industry: {{PRODUCT_LABEL_PLURAL}} may be software licenses, SaaS subscriptions, or hardware. " +
      "{{CUSTOMER_LABEL_PLURAL}} are clients or accounts. {{ORDER_LABEL_PLURAL}} are subscriptions or contracts. " +
      "MRR/ARR, churn rate, and feature adoption are key metrics.",
    construction:
      "In this industry: {{PRODUCT_LABEL_PLURAL}} are building materials and supplies. " +
      "{{CUSTOMER_LABEL_PLURAL}} are project managers or contractors. {{ORDER_LABEL_PLURAL}} are purchase orders or requisitions. " +
      "Project timelines, material wastage, and supplier reliability matter most.",
    transport:
      "In this industry: {{PRODUCT_LABEL_PLURAL}} may be shipment services or vehicle rentals. " +
      "{{CUSTOMER_LABEL_PLURAL}} are shippers or passengers. {{ORDER_LABEL_PLURAL}} are shipment bookings or trip tickets. " +
      "Fleet utilization, fuel costs, and route efficiency are key metrics.",
  };

  const terminology = terminologyMap[industry.toLowerCase()] ??
    "{{PRODUCT_LABEL_PLURAL}} are the items or services the business offers. " +
    "{{CUSTOMER_LABEL_PLURAL}} are the people or organizations who buy them. " +
    "{{ORDER_LABEL_PLURAL}} represent sales transactions.";

  // Industry-specific guardrails
  const guardrailsMap: Record<string, string> = {
    hospitality:
      "- Never confirm or guarantee availability without checking live inventory/bookings\n" +
      "- Be culturally sensitive to diverse international travelers\n" +
      "- Always mention safety advisories for outdoor/wildlife activities when relevant\n" +
      "- Respect guest privacy — never expose personal details across bookings",
    healthcare:
      "- NEVER provide medical diagnoses or treatment recommendations\n" +
      "- All pharmaceutical inventory data must flag expiry dates prominently\n" +
      "- Patient data is confidential — never cross-reference patient records in analytics\n" +
      "- Flag controlled substances separately in any inventory reports",
    "food & beverage":
      "- Always note allergen information when discussing menu items or ingredients\n" +
      "- Flag perishable items approaching expiry prominently in stock reports\n" +
      "- Food safety compliance (HACCP, health inspections) should be referenced when relevant\n" +
      "- Never suggest serving expired or recalled products",
  };

  const guardrails = guardrailsMap[industry.toLowerCase()] ??
    "- Never fabricate data — if information is not available, say so\n" +
    "- Respect data boundaries — only reference data the user has access to\n" +
    "- When uncertain about a metric, explain assumptions clearly";

  // Business context paragraph
  const subText = subIndustry ? ` (${subIndustry})` : "";
  const businessContext =
    `This is ${descriptor}. The business operates in the ${industry}${subText} sector. ` +
    `AI assistants should tailor their language, analysis, and recommendations to this domain. ` +
    `Use industry-appropriate KPIs, benchmarks, and best practices when generating insights or reports.`;

  return { industry, subIndustry, descriptor, terminology, guardrails, businessContext };
}

// ────────────────────────────────────────────────────────────
// Template definitions
// ────────────────────────────────────────────────────────────

interface TemplateEntry {
  agentName: string;
  sectionKey: string;
  template: string;
  changeNotes: string;
}

function generateTemplates(ctx: IndustryContext): TemplateEntry[] {
  const { industry, subIndustry, descriptor, terminology, guardrails, businessContext } = ctx;
  const subText = subIndustry ? ` / ${subIndustry}` : "";

  return [
    // ── Global (*) templates — apply to all agents as fallback ──

    {
      agentName: "*",
      sectionKey: "role",
      template:
        `You are the AI business intelligence assistant for a ${industry}${subText} company — ${descriptor}. ` +
        `You help staff understand their data, surface actionable insights, and make informed decisions. ` +
        `Always be professional, accurate, and context-aware for the ${industry.toLowerCase()} domain.`,
      changeNotes: `Seeded for ${industry}${subText}`,
    },
    {
      agentName: "*",
      sectionKey: "terminology",
      template: terminology,
      changeNotes: `Industry terminology for ${industry}`,
    },
    {
      agentName: "*",
      sectionKey: "guardrails",
      template:
        `Safety rules and boundaries:\n${guardrails}\n` +
        `- Always use the business's configured currency ({{CURRENCY}}) for financial values\n` +
        `- Present dates in the business timezone ({{TIMEZONE}})\n` +
        `- Never expose raw database credentials, API keys, or internal system details\n` +
        `- If you cannot answer a question with available data, say so honestly`,
      changeNotes: `Industry guardrails for ${industry}`,
    },
    {
      agentName: "*",
      sectionKey: "business-context",
      template: businessContext,
      changeNotes: `Business context for ${industry}${subText}`,
    },
    {
      agentName: "*",
      sectionKey: "formatting",
      template:
        `Response formatting guidelines:\n` +
        `- Use Markdown for structure: headers, bullet points, bold for emphasis\n` +
        `- Format currency with the configured symbol ({{CURRENCY}})\n` +
        `- Use tables for comparative data (top products, customer rankings, etc.)\n` +
        `- Keep summaries concise — lead with the key insight, then supporting data\n` +
        `- For large datasets, show top 10 with a note about the total count`,
      changeNotes: "Standard formatting rules",
    },

    // ── Data Science Agent (orchestrator / "The Brain") ──

    {
      agentName: "data-science",
      sectionKey: "role",
      template:
        `You are the central intelligence ("The Brain") for ${descriptor}. ` +
        `You orchestrate specialist agents and directly query the business database to answer questions. ` +
        `You deeply understand ${industry.toLowerCase()} operations, KPIs, and data patterns. ` +
        `When users ask about sales, inventory, customers, or trends, you either answer directly from data ` +
        `or delegate to the right specialist agent.`,
      changeNotes: `Data science role for ${industry}${subText}`,
    },
    {
      agentName: "data-science",
      sectionKey: "business-context",
      template:
        businessContext + "\n\n" +
        `Key ${industry.toLowerCase()} metrics to prioritize:\n` +
        getIndustryKPIs(industry),
      changeNotes: `Business context + KPIs for ${industry}`,
    },

    // ── Insights Analyzer ("The Analyst") ──

    {
      agentName: "insights-analyzer",
      sectionKey: "role",
      template:
        `You are the statistical analyst for ${descriptor}. ` +
        `You perform quantitative analysis: demand forecasting, anomaly detection, restock recommendations, and sales trends. ` +
        `You write and execute JavaScript code to compute metrics. ` +
        `Tailor your analysis to ${industry.toLowerCase()} patterns — ${getIndustryAnalyticsHint(industry)}.`,
      changeNotes: `Insights role for ${industry}`,
    },
    {
      agentName: "insights-analyzer",
      sectionKey: "guardrails",
      template:
        `Analysis guardrails:\n` +
        `- Always state sample size and time period when presenting statistics\n` +
        `- Flag when data is insufficient for reliable forecasts (< 14 days for trends)\n` +
        `- Distinguish between correlation and causation in insights\n` +
        `- ${getIndustryAnalyticsGuardrail(industry)}`,
      changeNotes: `Analysis guardrails for ${industry}`,
    },

    // ── Report Generator ("The Writer") ──

    {
      agentName: "report-generator",
      sectionKey: "role",
      template:
        `You are the professional report writer for ${descriptor}. ` +
        `You generate well-structured business reports with executive summaries, data tables, and actionable recommendations. ` +
        `Your reports should use ${industry.toLowerCase()} terminology and benchmark against industry standards where possible.`,
      changeNotes: `Report generator role for ${industry}`,
    },
    {
      agentName: "report-generator",
      sectionKey: "formatting",
      template:
        `Report formatting:\n` +
        `- Start every report with a 2-3 sentence executive summary\n` +
        `- Use ## headers for major sections\n` +
        `- Include data tables with aligned columns for key metrics\n` +
        `- End with "Recommendations" section with numbered actionable items\n` +
        `- Use {{CURRENCY}} for all monetary values\n` +
        `- Reference the reporting period in the header`,
      changeNotes: "Standard report formatting",
    },

    // ── Knowledge Base ("The Librarian") ──

    {
      agentName: "knowledge-base",
      sectionKey: "role",
      template:
        `You are the document specialist ("The Librarian") for ${descriptor}. ` +
        `You search the company's uploaded knowledge base using semantic similarity and synthesize accurate, cited answers. ` +
        `Documents may include ${getIndustryDocTypes(industry)}. ` +
        `Always cite your sources with document names and relevant quotes.`,
      changeNotes: `Knowledge base role for ${industry}`,
    },
  ];
}

// ────────────────────────────────────────────────────────────
// Industry-specific content helpers
// ────────────────────────────────────────────────────────────

function getIndustryKPIs(industry: string): string {
  const kpis: Record<string, string> = {
    Hospitality:
      "- Occupancy rate / booking utilization\n- Revenue per available room (RevPAR) or per tour slot\n" +
      "- Average booking value and length of stay\n- Seasonal demand patterns (high/low season)\n" +
      "- Guest satisfaction and repeat booking rate",
    Retail:
      "- Sales per square foot / per category\n- Inventory turnover rate\n- Gross margin by product line\n" +
      "- Average transaction value\n- Stock-to-sales ratio\n- Shrinkage rate",
    "Food & Beverage":
      "- Food cost percentage (target: 28-35%)\n- Average check size\n- Table turnover rate\n" +
      "- Waste percentage\n- Menu item profitability (contribution margin)\n- Peak hour revenue",
    Agriculture:
      "- Yield per hectare / per animal\n- Input cost ratio\n- Market price vs production cost\n" +
      "- Harvest-to-sale cycle time\n- Post-harvest loss percentage\n- Revenue per acre",
    Manufacturing:
      "- Production yield / defect rate\n- Capacity utilization\n- Cost per unit produced\n" +
      "- Inventory holding cost\n- Order fulfillment cycle time\n- Raw material wastage",
    Healthcare:
      "- Stock availability rate for essential items\n- Expiry write-off value\n" +
      "- Consumption rate by department\n- Supply chain lead time compliance\n- Cost per patient served",
    Technology:
      "- Monthly/Annual recurring revenue (MRR/ARR)\n- Churn rate\n- Customer acquisition cost (CAC)\n" +
      "- Average revenue per user (ARPU)\n- License utilization rate",
    Construction:
      "- Material cost as % of project budget\n- Wastage rate by material type\n" +
      "- Supplier delivery reliability\n- Project margin analysis\n- Cash flow per project",
    Transport:
      "- Fleet utilization rate\n- Revenue per km / per trip\n- Fuel cost as % of revenue\n" +
      "- On-time delivery rate\n- Vehicle maintenance cost ratio",
  };
  return kpis[industry] ??
    "- Revenue growth rate\n- Gross margin\n- Inventory turnover\n- Customer acquisition cost\n- Order fulfillment rate";
}

function getIndustryAnalyticsHint(industry: string): string {
  const hints: Record<string, string> = {
    Hospitality: "account for seasonal patterns (high season Dec-Mar, Jul-Oct for safari), weekend vs weekday demand, and weather impact on outdoor activities",
    Retail: "consider day-of-week patterns, payday effects, seasonal promotions, and product lifecycle stages (new, growth, mature, decline)",
    "Food & Beverage": "watch for meal-time peaks, day-of-week patterns, ingredient price volatility, and seasonal menu performance",
    Agriculture: "account for growing seasons, weather patterns, market price fluctuations, and harvest cycle timing",
    Manufacturing: "monitor production batch sizes, machine downtime patterns, raw material lead times, and demand variability",
    Healthcare: "track consumption patterns by department, expiry risk by product category, and seasonal disease patterns affecting supply needs",
    Technology: "analyze subscription cohort behavior, feature adoption curves, support ticket seasonality, and renewal timing",
    Construction: "track material price trends, seasonal construction activity, project phase-based consumption, and supplier performance",
    Transport: "analyze route profitability, seasonal demand shifts, fuel price correlation with costs, and fleet maintenance cycles",
  };
  return hints[industry] ?? "look for weekly, monthly, and seasonal patterns specific to the business domain";
}

function getIndustryAnalyticsGuardrail(industry: string): string {
  const guardrails: Record<string, string> = {
    Hospitality: "Factor in that low-season numbers should not be compared 1:1 with high-season; always normalize for seasonality",
    Retail: "Be cautious with trend extrapolation during promotional periods — distinguish organic vs promo-driven growth",
    "Food & Beverage": "Perishable inventory forecasts must be conservative — over-ordering creates waste, under-ordering loses sales",
    Agriculture: "Weather-dependent yields introduce high variance — always include confidence intervals in crop forecasts",
    Healthcare: "Never recommend reducing safety stock for critical medical supplies based on statistical models alone",
    Construction: "Material price forecasts should note that construction commodities can be highly volatile",
    Transport: "Fuel cost forecasting should include caveats about geopolitical price sensitivity",
  };
  return guardrails[industry] ?? "Always present confidence levels and caveats when forecasting in this domain";
}

function getIndustryDocTypes(industry: string): string {
  const docs: Record<string, string> = {
    Hospitality: "operational SOPs, safety protocols, tour itineraries, pricing guides, lodge/hotel policies, supplier contracts, and staff training materials",
    Retail: "product catalogs, supplier agreements, return policies, staff handbooks, visual merchandising guides, and POS procedures",
    "Food & Beverage": "recipes, food safety procedures (HACCP plans), supplier contracts, menu engineering guides, health inspection checklists, and staff training manuals",
    Agriculture: "crop management guides, fertilizer schedules, market price bulletins, cooperative agreements, post-harvest handling protocols, and certification documents",
    Manufacturing: "production SOPs, quality control procedures, material safety data sheets (MSDS), equipment manuals, supplier specifications, and compliance certificates",
    Healthcare: "clinical protocols, drug formularies, infection control guidelines, procurement procedures, equipment maintenance schedules, and regulatory compliance documents",
    Technology: "product documentation, API references, onboarding guides, SLA agreements, security policies, and release notes",
    Construction: "building codes, safety regulations (OSHA), project specifications, material specs, subcontractor agreements, and quality checklists",
    Transport: "fleet maintenance schedules, route maps, safety procedures, driver handbooks, fuel management policies, and regulatory compliance documents",
  };
  return docs[industry] ?? "policies, procedures, contracts, guides, manuals, and business reference documents";
}

// ────────────────────────────────────────────────────────────
// Main seed logic
// ────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seed Prompt Templates — Industry-Aware\n");

  // 1. Read industry/subIndustry from business_settings
  const rows = await db.select().from(businessSettings);
  const settingsMap: Record<string, string> = {};
  for (const r of rows) settingsMap[r.key] = r.value;

  const industry = settingsMap.industry || "";
  const subIndustry = settingsMap.subIndustry || "";

  if (!industry) {
    console.log("⚠️  No industry set in business_settings.");
    console.log("   Go to Settings → Business Identity → Industry and select your industry first,");
    console.log("   or pass defaults via arguments:");
    console.log("   DATABASE_URL=<url> bun scripts/seed-prompts.ts --industry=Hospitality --sub=Tourism\n");

    // Check for CLI args
    const args = process.argv.slice(2);
    const industryArg = args.find(a => a.startsWith("--industry="))?.split("=")[1];
    const subArg = args.find(a => a.startsWith("--sub="))?.split("=")[1];

    if (!industryArg) {
      console.log("❌ No industry provided. Exiting.");
      await close();
      process.exit(1);
    }

    // Save to business_settings
    for (const [key, value] of Object.entries({ industry: industryArg, subIndustry: subArg || "" })) {
      const existing = await db.select().from(businessSettings).where(eq(businessSettings.key, key));
      if (existing.length) {
        await db.update(businessSettings).set({ value }).where(eq(businessSettings.key, key));
      } else {
        await db.insert(businessSettings).values({ key, value });
      }
    }

    return seedTemplates(industryArg, subArg || "");
  }

  return seedTemplates(industry, subIndustry);
}

async function seedTemplates(industry: string, subIndustry: string) {
  console.log(`📋 Industry: ${industry}`);
  console.log(`📋 Sub-Industry: ${subIndustry || "(none)"}\n`);

  const ctx = buildIndustryContext(industry, subIndustry);
  const templates = generateTemplates(ctx);

  let inserted = 0;
  let skipped = 0;

  for (const t of templates) {
    // Check if a template already exists for this agent+section
    const existing = await db
      .select()
      .from(promptTemplates)
      .where(
        and(
          eq(promptTemplates.agentName, t.agentName),
          eq(promptTemplates.sectionKey, t.sectionKey)
        )
      );

    if (existing.length > 0) {
      console.log(`  ⏭️  ${t.agentName} / ${t.sectionKey} — already exists (v${existing[0].version}), skipping`);
      skipped++;
      continue;
    }

    await db.insert(promptTemplates).values({
      agentName: t.agentName,
      sectionKey: t.sectionKey,
      template: t.template,
      version: 1,
      isActive: true,
      createdBy: "seed-script",
      changeNotes: t.changeNotes,
      metadata: {
        industry,
        subIndustry,
        seededAt: new Date().toISOString(),
      },
    });

    console.log(`  ✅ ${t.agentName} / ${t.sectionKey} — inserted (v1)`);
    inserted++;
  }

  console.log(`\n📊 Done: ${inserted} inserted, ${skipped} skipped (already existed)`);
  console.log("💡 Edit templates in Admin → Prompt Templates, or via the API at /api/admin/prompts\n");

  await close();
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
