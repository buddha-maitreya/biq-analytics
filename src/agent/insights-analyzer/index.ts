import { createAgent } from "@agentuity/runtime";
import { generateObject } from "ai";
import { z } from "zod";
import { db, products, orders, orderItems, inventory, inventoryTransactions } from "@db/index";
import { sql, eq, desc, gte } from "drizzle-orm";
import { config } from "@lib/config";
import { getModel } from "@lib/ai";
import { getAISettings } from "@services/settings";

/**
 * Insights Analyzer Agent — uses AI to detect patterns humans would miss.
 *
 * Capabilities:
 *   - Demand forecasting: predict which products need restocking
 *   - Anomaly detection: flag unusual order volumes or pricing
 *   - Restock recommendations: smart reorder suggestions based on velocity
 *   - Customer churn risk: identify customers whose ordering slowed
 *
 * This genuinely needs an LLM because it reasons over multi-dimensional
 * data patterns — something pure SQL/math can't flexibly do.
 */

const inputSchema = z.object({
  analysis: z.enum([
    "demand-forecast",
    "anomaly-detection",
    "restock-recommendations",
    "sales-trends",
  ]),
  timeframeDays: z.number().int().min(1).max(365).default(30),
  productId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const insightSchema = z.object({
  title: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  description: z.string(),
  recommendation: z.string(),
  affectedItems: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});

const outputSchema = z.object({
  analysisType: z.string(),
  generatedAt: z.string(),
  insights: z.array(insightSchema),
  summary: z.string(),
});

/** Gather sales velocity data for the timeframe */
async function getSalesVelocity(days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return db
    .select({
      productId: orderItems.productId,
      productName: products.name,
      sku: products.sku,
      totalSold: sql<number>`sum(${orderItems.quantity})`,
      totalRevenue: sql<number>`sum(${orderItems.totalAmount})`,
      orderCount: sql<number>`count(distinct ${orderItems.orderId})`,
      avgQuantityPerOrder: sql<number>`avg(${orderItems.quantity})`,
    })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(gte(orders.createdAt, since))
    .groupBy(orderItems.productId, products.name, products.sku)
    .orderBy(sql`sum(${orderItems.quantity}) desc`)
    .limit(50);
}

/** Get current stock levels with reorder context */
async function getStockContext() {
  return db
    .select({
      productId: inventory.productId,
      productName: products.name,
      sku: products.sku,
      quantity: inventory.quantity,
      reorderPoint: products.reorderPoint,
      minStockLevel: products.minStockLevel,
      maxStockLevel: products.maxStockLevel,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(eq(products.isActive, true));
}

/** Get recent inventory movements */
async function getRecentMovements(days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return db
    .select({
      productId: inventoryTransactions.productId,
      productName: products.name,
      type: inventoryTransactions.type,
      totalMoved: sql<number>`sum(abs(${inventoryTransactions.quantity}))`,
      txCount: sql<number>`count(*)`,
    })
    .from(inventoryTransactions)
    .innerJoin(products, eq(inventoryTransactions.productId, products.id))
    .where(gte(inventoryTransactions.createdAt, since))
    .groupBy(
      inventoryTransactions.productId,
      products.name,
      inventoryTransactions.type
    )
    .orderBy(sql`sum(abs(${inventoryTransactions.quantity})) desc`)
    .limit(50);
}

export default createAgent("insights-analyzer", {
  schema: { input: inputSchema, output: outputSchema },
  handler: async (ctx, input) => {
    // Load client-customizable AI settings
    const aiSettings = await getAISettings();

    // Gather data
    const [salesVelocity, stockLevels, movements] = await Promise.all([
      getSalesVelocity(input.timeframeDays),
      getStockContext(),
      getRecentMovements(input.timeframeDays),
    ]);

    const dataContext = JSON.stringify(
      {
        analysisType: input.analysis,
        timeframeDays: input.timeframeDays,
        salesVelocity,
        stockLevels,
        movements,
        currency: config.currency,
        productLabel: config.labels.product,
      },
      null,
      2
    );

    const defaultPrompts: Record<string, string> = {
      "demand-forecast": `Analyze the sales velocity data and predict which products will need restocking in the next 7-14 days. Consider sales trends, current stock levels, and movement patterns. Flag products at risk of stockout.`,
      "anomaly-detection": `Look for anomalies in the data: unusual spikes or drops in sales volume, products with erratic ordering patterns, pricing inconsistencies, or inventory discrepancies. Flag anything that seems suspicious or unusual.`,
      "restock-recommendations": `Based on sales velocity, current stock levels, and reorder points, recommend specific restock quantities for products that need attention. Prioritize by urgency (days until stockout). Consider lead times and safety stock.`,
      "sales-trends": `Analyze overall sales patterns: which products are trending up or down, seasonal patterns, customer ordering behavior changes, and revenue trajectory. Highlight opportunities and risks.`,
    };

    // Use custom insights instructions if provided, otherwise use defaults
    const analysisPrompt = aiSettings.aiInsightsInstructions?.trim()
      ? `${aiSettings.aiInsightsInstructions.trim()}\n\nAnalysis type requested: ${input.analysis}\nTimeframe: last ${input.timeframeDays} days`
      : defaultPrompts[input.analysis];

    // Build system prompt with optional business context
    let systemPrompt = `You are an expert business intelligence analyst for ${config.companyName}.
Analyze the provided data and generate actionable insights.
Be specific — reference product names, SKUs, and numbers.
Each insight must have a clear, actionable recommendation.
Rate your confidence honestly (0.0 to 1.0).
Use the deployment's terminology: products are called "${config.labels.product}", orders are "${config.labels.order}".`;

    if (aiSettings.aiBusinessContext?.trim()) {
      systemPrompt += `\n\nBusiness context:\n${aiSettings.aiBusinessContext.trim()}`;
    }

    const { object } = await generateObject({
      model: getModel(),
      schema: z.object({
        insights: z.array(insightSchema),
        summary: z.string(),
      }),
      system: systemPrompt,
      prompt: `${analysisPrompt}

Data:
${dataContext}`,
    });

    ctx.logger.info(
      `Insights analysis complete: ${input.analysis}, ${object.insights.length} insights generated`
    );

    return {
      analysisType: input.analysis,
      generatedAt: new Date().toISOString(),
      insights: object.insights,
      summary: object.summary,
    };
  },
});
