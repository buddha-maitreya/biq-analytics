/**
 * Seed Script — Agent Configuration, Prompt Templates, Few-Shot Examples & Schedules
 *
 * Populates the agent infrastructure tables with baseline configuration
 * for all four platform agents, starter prompt templates, example interactions,
 * and demo scheduled tasks.
 *
 * Usage:
 *   DATABASE_URL=<your-url> bun demo/seed-agents.ts
 *
 * Idempotent — uses ON CONFLICT DO NOTHING for all inserts.
 */

import { createPostgresDrizzle } from "@agentuity/drizzle";
import * as schema from "../src/db/schema";
import {
  agentConfigs,
  promptTemplates,
  fewShotExamples,
  schedules,
} from "../src/db/schema";
import { sql } from "drizzle-orm";

// ────────────────────────────────────────────────────────────
// Database connection
// ────────────────────────────────────────────────────────────
const { db, close } = createPostgresDrizzle({ schema });

// ────────────────────────────────────────────────────────────
// Seed Data
// ────────────────────────────────────────────────────────────
async function seed() {
  console.log("🤖 Seeding Agent Infrastructure...\n");

  // ── 1. Agent Configs ──────────────────────────────────────
  console.log("  → agent_configs");
  await db
    .insert(agentConfigs)
    .values([
      {
        agentName: "data-science",
        displayName: "The Analyst",
        description:
          "Executes SQL queries, performs calculations, generates charts, and answers data questions with structured analysis.",
        isActive: true,
        temperature: "0.20",
        maxSteps: 12,
        timeoutMs: 60_000,
        executionPriority: 0,
        config: {
          structuringModel: "gpt-4o-mini",
          sandboxMemoryMb: 256,
          sandboxTimeoutMs: 30_000,
          maxSqlSteps: 6,
        },
        metadata: { seedVersion: 1 },
      },
      {
        agentName: "insights-analyzer",
        displayName: "The Brain",
        description:
          "Orchestrates multi-step analysis workflows — trend detection, anomaly alerts, forecasting, and strategic recommendations.",
        isActive: true,
        temperature: "0.40",
        maxSteps: 8,
        timeoutMs: 90_000,
        executionPriority: 1,
        config: {
          enableSandbox: true,
          compressionThreshold: 20,
          maxParallelTools: 3,
        },
        metadata: { seedVersion: 1 },
      },
      {
        agentName: "report-generator",
        displayName: "The Writer",
        description:
          "Generates formatted business reports (sales summaries, inventory audits, financial snapshots) in Markdown or PDF.",
        isActive: true,
        temperature: "0.30",
        maxSteps: 10,
        timeoutMs: 120_000,
        executionPriority: 2,
        config: {
          defaultFormat: "markdown",
          maxSqlSteps: 6,
          supportedFormats: ["markdown", "html", "csv"],
        },
        metadata: { seedVersion: 1 },
      },
      {
        agentName: "knowledge-base",
        displayName: "The Librarian",
        description:
          "Manages the document knowledge base — ingests, indexes, and retrieves documents via semantic search for RAG.",
        isActive: true,
        temperature: "0.10",
        maxSteps: 5,
        timeoutMs: 30_000,
        executionPriority: 3,
        config: {
          topK: 5,
          similarityThreshold: 0.7,
          maxDocumentSizeMb: 10,
          supportedFormats: ["pdf", "txt", "md", "csv", "json"],
        },
        metadata: { seedVersion: 1 },
      },
    ])
    .onConflictDoNothing({ target: agentConfigs.agentName });
  console.log("    ✓ 4 agent configs");

  // ── 2. Prompt Templates ───────────────────────────────────
  console.log("  → prompt_templates");
  const promptRows = [
    // Global templates (apply to all agents)
    {
      agentName: "*",
      sectionKey: "guardrails",
      template:
        "You MUST NOT fabricate data. If a query returns no rows, say so. Never guess numbers.\nYou MUST NOT execute destructive SQL (DROP, TRUNCATE, DELETE without WHERE).\nAlways cite the source table/query when presenting data.",
      version: 1,
      isActive: true,
      changeNotes: "Initial guardrails — baseline safety rules",
    },
    {
      agentName: "*",
      sectionKey: "formatting",
      template:
        "Use Markdown tables for tabular data (max 15 rows, summarize if more).\nUse bullet lists for under 5 items.\nCurrency values: format with 2 decimal places and the configured currency symbol.\nDates: use the configured timezone and locale format.",
      version: 1,
      isActive: true,
      changeNotes: "Initial formatting — consistent output styling",
    },
    {
      agentName: "*",
      sectionKey: "terminology",
      template:
        "Use the configured business terminology labels:\n- Products → {{PRODUCT_LABEL_PLURAL}}\n- Orders → {{ORDER_LABEL_PLURAL}}\n- Customers → {{CUSTOMER_LABEL_PLURAL}}\n- Warehouse → {{WAREHOUSE_LABEL}}\nNever use hardcoded industry terms.",
      version: 1,
      isActive: true,
      changeNotes: "Initial terminology — industry-agnostic labels",
    },
    // Data Science specific
    {
      agentName: "data-science",
      sectionKey: "role",
      template:
        "You are The Analyst — a senior data analyst specializing in business intelligence.\nYou write precise SQL queries, perform statistical analysis, and present findings with clear visualizations.\nAlways explain your methodology before presenting results.",
      version: 1,
      isActive: true,
      changeNotes: "Initial role definition for data-science agent",
    },
    {
      agentName: "data-science",
      sectionKey: "sql-rules",
      template:
        "SQL RULES:\n- Always use parameterized queries with $1, $2, etc.\n- Use CTEs for complex queries instead of nested subqueries.\n- Always add LIMIT unless the user explicitly asks for all rows.\n- Use date_trunc() for time-series grouping.\n- Use COALESCE for nullable aggregations.\n- Include ORDER BY for deterministic results.",
      version: 1,
      isActive: true,
      changeNotes: "SQL best practices for data-science queries",
    },
    // Insights Analyzer specific
    {
      agentName: "insights-analyzer",
      sectionKey: "role",
      template:
        "You are The Brain — a strategic business analyst that identifies patterns, anomalies, and opportunities.\nYou orchestrate multiple analysis tools, correlate findings across domains, and provide actionable recommendations.\nPrioritize insights by business impact.",
      version: 1,
      isActive: true,
      changeNotes: "Initial role definition for insights-analyzer agent",
    },
    // Report Generator specific
    {
      agentName: "report-generator",
      sectionKey: "role",
      template:
        "You are The Writer — a business report specialist.\nYou create well-structured, professional reports with executive summaries, detailed analysis, and clear recommendations.\nReports should be self-contained — a reader should understand the context without prior knowledge.",
      version: 1,
      isActive: true,
      changeNotes: "Initial role definition for report-generator agent",
    },
    // Knowledge Base specific
    {
      agentName: "knowledge-base",
      sectionKey: "role",
      template:
        "You are The Librarian — a document management and retrieval specialist.\nYou help users find information in the knowledge base using semantic search.\nAlways cite the source document and page/section when answering from documents.\nIf the knowledge base doesn't contain relevant information, say so clearly.",
      version: 1,
      isActive: true,
      changeNotes: "Initial role definition for knowledge-base agent",
    },
  ];

  // Use raw SQL for ON CONFLICT since prompt_templates has a compound uniqueness
  for (const row of promptRows) {
    await db
      .insert(promptTemplates)
      .values(row)
      .onConflictDoNothing();
  }
  console.log(`    ✓ ${promptRows.length} prompt templates`);

  // ── 3. Few-Shot Examples ──────────────────────────────────
  console.log("  → few_shot_examples");
  const exampleRows = [
    // Data Science examples
    {
      category: "data-science",
      userInput: "What were our top 10 selling products last month?",
      expectedBehavior:
        "Query products joined with order_items, filter by last month using date_trunc, aggregate by SUM(quantity) and SUM(total_amount), ORDER BY total_amount DESC LIMIT 10. Present as a markdown table with rank, product name, units sold, and revenue.",
      isActive: true,
      sortOrder: 1,
    },
    {
      category: "data-science",
      userInput: "Show me inventory levels below reorder point",
      expectedBehavior:
        "Query inventory joined with products, filter WHERE quantity < reorder_point AND products.is_active = true. Include warehouse name, product name, current quantity, reorder point, and deficit. Sort by deficit descending.",
      isActive: true,
      sortOrder: 2,
    },
    {
      category: "data-science",
      userInput: "What's our revenue trend for the past 6 months?",
      expectedBehavior:
        "Query orders with date_trunc('month', created_at), aggregate SUM(total_amount) as revenue and COUNT(*) as order_count. Include month-over-month growth percentage. Present as a table and suggest a line chart.",
      isActive: true,
      sortOrder: 3,
    },
    // Insights examples
    {
      category: "insights-analyzer",
      userInput: "Are there any unusual patterns in our sales data?",
      expectedBehavior:
        "Run anomaly detection across multiple dimensions: daily revenue vs 30-day moving average, product category mix changes, customer concentration shifts, and payment method distribution. Flag any metric that deviates by more than 2 standard deviations. Present findings ranked by significance.",
      isActive: true,
      sortOrder: 1,
    },
    {
      category: "insights-analyzer",
      userInput: "Which customers are we at risk of losing?",
      expectedBehavior:
        "Analyze customer purchase frequency trends — compare each customer's recent 90-day activity to their historical average. Flag customers whose order frequency dropped by >50% or who haven't ordered in 2x their usual interval. Include estimated revenue at risk.",
      isActive: true,
      sortOrder: 2,
    },
    // Report examples
    {
      category: "report-generator",
      userInput: "Generate a weekly sales report",
      expectedBehavior:
        "Create a structured report with: executive summary, total revenue + comparison to previous week, top products by revenue, top customers, payment method breakdown, order status distribution, and recommendations. Use markdown formatting with tables and bullet points.",
      isActive: true,
      sortOrder: 1,
    },
    {
      category: "report-generator",
      userInput: "Create an inventory audit report",
      expectedBehavior:
        "Generate report covering: stock summary by warehouse, products below reorder point, slow-moving inventory (no sales in 30+ days), stock valuation (quantity × cost_price per category), recent stock movements, and reorder recommendations.",
      isActive: true,
      sortOrder: 2,
    },
    // Knowledge Base examples
    {
      category: "knowledge-base",
      userInput: "What does our return policy say about damaged goods?",
      expectedBehavior:
        "Perform semantic search across the knowledge base for 'return policy damaged goods'. Present relevant excerpts with document name and section references. If no matching documents found, clearly state that the knowledge base doesn't contain return policy information.",
      isActive: true,
      sortOrder: 1,
    },
  ];

  for (const row of exampleRows) {
    await db.insert(fewShotExamples).values(row).onConflictDoNothing();
  }
  console.log(`    ✓ ${exampleRows.length} few-shot examples`);

  // ── 4. Schedules ──────────────────────────────────────────
  console.log("  → schedules");
  await db
    .insert(schedules)
    .values([
      {
        name: "Daily Sales Summary",
        taskType: "report",
        cronExpression: "0 8 * * *",
        taskConfig: {
          reportType: "sales-summary",
          periodDays: 1,
          format: "markdown",
          deliveryChannel: "dashboard",
        },
        isActive: true,
        timezone: process.env.TIMEZONE || "UTC",
        failureCount: 0,
        maxFailures: 5,
        metadata: { seedVersion: 1, description: "Generates a daily sales summary report every morning at 8 AM" },
      },
      {
        name: "Weekly Inventory Audit",
        taskType: "report",
        cronExpression: "0 6 * * 1",
        taskConfig: {
          reportType: "inventory-audit",
          includeReorderAlerts: true,
          format: "markdown",
        },
        isActive: true,
        timezone: process.env.TIMEZONE || "UTC",
        failureCount: 0,
        maxFailures: 5,
        metadata: { seedVersion: 1, description: "Weekly inventory health check every Monday at 6 AM" },
      },
      {
        name: "Low Stock Alert",
        taskType: "alert",
        cronExpression: "0 */4 * * *",
        taskConfig: {
          metric: "low-stock",
          threshold: 10,
          notifyRoles: ["admin", "manager"],
        },
        isActive: true,
        timezone: process.env.TIMEZONE || "UTC",
        failureCount: 0,
        maxFailures: 3,
        metadata: { seedVersion: 1, description: "Checks for low stock every 4 hours and alerts managers" },
      },
      {
        name: "Monthly Business Insights",
        taskType: "insight",
        cronExpression: "0 9 1 * *",
        taskConfig: {
          analysisType: "comprehensive",
          timeframeDays: 30,
          includeForecasting: true,
          includeAnomalies: true,
        },
        isActive: true,
        timezone: process.env.TIMEZONE || "UTC",
        failureCount: 0,
        maxFailures: 5,
        metadata: { seedVersion: 1, description: "Comprehensive business analysis on the 1st of each month" },
      },
      {
        name: "Session Cleanup",
        taskType: "cleanup",
        cronExpression: "0 2 * * 0",
        taskConfig: {
          target: "old-sessions",
          olderThanDays: 90,
          dryRun: false,
        },
        isActive: true,
        timezone: process.env.TIMEZONE || "UTC",
        failureCount: 0,
        maxFailures: 3,
        metadata: { seedVersion: 1, description: "Cleans up chat sessions older than 90 days every Sunday at 2 AM" },
      },
    ])
    .onConflictDoNothing();
  console.log("    ✓ 5 scheduled tasks");

  console.log("\n✅ Agent infrastructure seeded successfully!\n");
}

// ────────────────────────────────────────────────────────────
// Run
// ────────────────────────────────────────────────────────────
seed()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => close());
