/**
 * Prompt Template API Routes — Phase 7.1
 *
 * CRUD endpoints for versioned prompt templates.
 * Admin-only — requires auth middleware.
 *
 * Routes:
 *   GET    /api/admin/prompts              — List all templates
 *   GET    /api/admin/prompts/:agent        — Templates for a specific agent
 *   GET    /api/admin/prompts/:agent/:key   — Version history for agent+section
 *   POST   /api/admin/prompts              — Create new template version
 *   PUT    /api/admin/prompts/:id/activate  — Activate a specific version
 *   DELETE /api/admin/prompts/:id           — Delete a template version
 *   POST   /api/admin/prompts/test          — Test a prompt against sample input
 *   POST   /api/admin/prompts/seed          — AI-generate industry-aware templates
 */

import { createRouter, validator } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import {
  createPromptTemplateSchema,
  testPromptSchema,
} from "@lib/validation";
import * as promptSvc from "@services/prompt-templates";
import { generateText } from "ai";
import { getModel } from "@lib/ai";
import { injectLabels } from "@lib/prompts";
import { getAllSettings } from "@services/settings";

const router = createRouter();
router.use(errorMiddleware());
router.use(sessionMiddleware());

/** GET /api/admin/prompts — list all prompt templates */
router.get("/admin/prompts", async (c) => {
  const agentName = c.req.query("agent");
  const data = await promptSvc.listPromptTemplates(agentName);
  return c.json({ data });
});

/** GET /api/admin/prompts/:agent/:key — version history */
router.get("/admin/prompts/:agent/:key", async (c) => {
  const { agent, key } = c.req.param();
  const data = await promptSvc.getTemplateVersions(agent, key);
  return c.json({ data });
});

/** GET /api/admin/prompts/:agent — templates for a specific agent */
router.get("/admin/prompts/:agent", async (c) => {
  const agent = c.req.param("agent");
  const data = await promptSvc.getAgentTemplates(agent);
  return c.json({ data });
});

/** POST /api/admin/prompts — create a new template version */
router.post(
  "/admin/prompts",
  validator({ input: createPromptTemplateSchema }),
  async (c) => {
    const body = c.req.valid("json");
    const userId = (c as any).get?.("userId") ?? null;
    const data = await promptSvc.createPromptTemplate({
      ...body,
      createdBy: userId,
    });
    return c.json({ data }, 201);
  }
);

/** PUT /api/admin/prompts/:id/activate — activate a specific version */
router.put("/admin/prompts/:id/activate", async (c) => {
  const id = c.req.param("id");
  const data = await promptSvc.activateTemplateVersion(id);
  if (!data) return c.json({ error: "Template not found" }, 404);
  return c.json({ data });
});

/** DELETE /api/admin/prompts/:id — delete a template version */
router.delete("/admin/prompts/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await promptSvc.deletePromptTemplate(id);
  if (!deleted) return c.json({ error: "Template not found" }, 404);
  return c.json({ success: true });
});

/** POST /api/admin/prompts/test — test a prompt against sample input */
router.post(
  "/admin/prompts/test",
  validator({ input: testPromptSchema }),
  async (c) => {
    const { agentName, message, promptOverrides } = c.req.valid("json");

    try {
      // Build system prompt from active templates + any overrides
      const templates = await promptSvc.getAgentTemplates(agentName);
      const merged = { ...templates, ...promptOverrides };

      // Assemble the system prompt from sections
      const systemPrompt = Object.entries(merged)
        .map(([key, val]) => injectLabels(String(val)))
        .join("\n\n");

      const result = await generateText({
        model: await getModel(),
        system: systemPrompt,
        prompt: message,
        maxTokens: 500,
      });

      return c.json({
        success: true,
        response: result.text,
        usage: result.usage,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, error: msg }, 500);
    }
  }
);

// ────────────────────────────────────────────────────────────
// AI-Powered Prompt Template Seeding
// ────────────────────────────────────────────────────────────

/**
 * The agent names and section keys the AI should generate templates for.
 * Each entry describes what the section should contain so the LLM
 * can produce high-quality, industry-specific content.
 */
const SEED_SPEC = [
  // Global templates (fallback for all agents)
  { agentName: "*", sectionKey: "role", desc: "Global AI assistant role definition tailored to the business industry" },
  { agentName: "*", sectionKey: "terminology", desc: "Industry-specific terminology mapping — explain what products, customers, orders mean in this industry. Use {{PRODUCT_LABEL}}, {{PRODUCT_LABEL_PLURAL}}, {{CUSTOMER_LABEL}}, {{CUSTOMER_LABEL_PLURAL}}, {{ORDER_LABEL}}, {{ORDER_LABEL_PLURAL}} placeholders" },
  { agentName: "*", sectionKey: "guardrails", desc: "Safety rules and boundaries specific to this industry — what the AI must never do, data privacy rules, compliance requirements" },
  { agentName: "*", sectionKey: "business-context", desc: "Business context paragraph — what the company does, its industry, key operations, and what matters most" },
  { agentName: "*", sectionKey: "formatting", desc: "Response formatting guidelines — markdown structure, currency formatting with {{CURRENCY}}, table usage, conciseness rules" },
  // Data Science agent (orchestrator)
  { agentName: "data-science", sectionKey: "role", desc: "Central intelligence / orchestrator role — queries the database, delegates to specialist agents (analyst, writer, librarian). Expert in this industry's data patterns" },
  { agentName: "data-science", sectionKey: "business-context", desc: "Industry-specific business context + key KPIs and metrics this agent should prioritize" },
  // Insights Analyzer
  { agentName: "insights-analyzer", sectionKey: "role", desc: "Statistical analyst role — performs demand forecasting, anomaly detection, restock recommendations, sales trend analysis. Writes JavaScript code to compute metrics. Tailored to this industry's patterns" },
  { agentName: "insights-analyzer", sectionKey: "guardrails", desc: "Analysis-specific guardrails — sample size requirements, confidence level disclaimers, industry-specific analytical caveats" },
  // Report Generator
  { agentName: "report-generator", sectionKey: "role", desc: "Professional report writer — generates executive summaries, data tables, recommendations. Uses industry terminology and benchmarks" },
  { agentName: "report-generator", sectionKey: "formatting", desc: "Report formatting rules — executive summary first, ## headers for sections, data tables, currency as {{CURRENCY}}, end with numbered recommendations" },
  // Knowledge Base
  { agentName: "knowledge-base", sectionKey: "role", desc: "Document specialist / librarian — searches uploaded documents via semantic similarity. List the types of documents common in this industry (SOPs, policies, contracts, etc.)" },
];

/** POST /api/admin/prompts/seed — AI-generate industry-aware prompt templates */
router.post("/admin/prompts/seed", async (c) => {
  try {
    // 1. Read industry/subIndustry from business settings
    const settings = await getAllSettings();
    const industry = settings.industry || "";
    const subIndustry = settings.subIndustry || "";
    const businessName = settings.businessName || "the company";

    if (!industry) {
      return c.json(
        {
          error:
            "No industry configured. Go to Settings → Business Identity and select your industry before seeding templates.",
        },
        400
      );
    }

    // 2. Check which templates already exist — skip those
    const existing = await promptSvc.listPromptTemplates();
    const existingKeys = new Set(
      existing.map((t) => `${t.agentName}::${t.sectionKey}`)
    );

    const toGenerate = SEED_SPEC.filter(
      (s) => !existingKeys.has(`${s.agentName}::${s.sectionKey}`)
    );

    if (toGenerate.length === 0) {
      return c.json({
        data: existing,
        seeded: 0,
        message: "All templates already exist — nothing to seed.",
      });
    }

    // 3. Build a single LLM prompt asking for all templates at once
    const subText = subIndustry ? ` (${subIndustry})` : "";
    const systemPrompt = `You are an expert AI prompt engineer specializing in business AI assistants.

The user operates "${businessName}" — a business in the ${industry}${subText} industry.

Your task: Generate prompt template sections for the AI agents of this business platform. 
The platform has these AI agents:
- data-science: The "Brain" / orchestrator — queries databases, delegates to specialists
- insights-analyzer: The "Analyst" — runs statistical computations in a sandbox (Python with numpy/pandas/scipy/sklearn/statsmodels)
- report-generator: The "Writer" — produces professional business reports
- knowledge-base: The "Librarian" — searches uploaded documents via vector similarity
- * (global): Fallback templates that apply to all agents

IMPORTANT RULES:
- Use these placeholder tokens where appropriate: {{PRODUCT_LABEL}}, {{PRODUCT_LABEL_PLURAL}}, {{CUSTOMER_LABEL}}, {{CUSTOMER_LABEL_PLURAL}}, {{ORDER_LABEL}}, {{ORDER_LABEL_PLURAL}}, {{INVOICE_LABEL}}, {{INVOICE_LABEL_PLURAL}}, {{WAREHOUSE_LABEL}}, {{CURRENCY}}, {{TIMEZONE}}
- Be specific to the ${industry}${subText} industry — use real terminology, KPIs, and best practices
- Keep each template between 3-8 lines (concise but comprehensive)
- Write in second person ("You are...", "Your role is...")
- Never reference specific product names or brand names

Respond with a JSON array where each element has:
{ "agentName": string, "sectionKey": string, "template": string }

Generate templates ONLY for these sections:`;

    const specList = toGenerate
      .map(
        (s, i) =>
          `${i + 1}. Agent: "${s.agentName}", Section: "${s.sectionKey}" — ${s.desc}`
      )
      .join("\n");

    const model = await getModel();
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: specList,
      maxTokens: 4000,
      temperature: 0.7,
    });

    // 4. Parse the LLM response — extract JSON array
    const text = result.text.trim();
    // Try to find JSON array in the response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return c.json(
        { error: "AI did not return valid JSON. Raw response saved for debugging.", raw: text },
        500
      );
    }

    let generated: Array<{
      agentName: string;
      sectionKey: string;
      template: string;
    }>;
    try {
      generated = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return c.json(
        { error: "Failed to parse AI JSON response.", raw: text },
        500
      );
    }

    // 5. Insert each generated template
    let seeded = 0;
    for (const g of generated) {
      if (!g.agentName || !g.sectionKey || !g.template) continue;

      // Double-check not already existing
      const key = `${g.agentName}::${g.sectionKey}`;
      if (existingKeys.has(key)) continue;

      await promptSvc.createPromptTemplate({
        agentName: g.agentName,
        sectionKey: g.sectionKey,
        template: g.template,
        createdBy: "ai-seed",
        changeNotes: `AI-generated for ${industry}${subText}`,
        metadata: {
          industry,
          subIndustry,
          generatedBy: "ai-seed",
          model: result.usage ? `tokens: ${result.usage.totalTokens}` : undefined,
          seededAt: new Date().toISOString(),
        },
      });
      existingKeys.add(key);
      seeded++;
    }

    const allTemplates = await promptSvc.listPromptTemplates();
    return c.json({
      data: allTemplates,
      seeded,
      message: `AI generated ${seeded} prompt template(s) for ${industry}${subText}.`,
      usage: result.usage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: `Seed failed: ${msg}` }, 500);
  }
});

export default router;
