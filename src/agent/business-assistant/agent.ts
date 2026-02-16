import { createAgent } from "@agentuity/runtime";
import { generateText } from "ai";
import { z } from "zod";
import { db, products, orders, orderItems, customers, inventory, invoices } from "@db/index";
import { sql, eq, desc, and, gte, lte } from "drizzle-orm";
import { config } from "@lib/config";

/**
 * Business Assistant Agent — the ONLY place an LLM is needed.
 *
 * Understands natural language business questions and translates them
 * into data queries, then explains the results in plain English.
 *
 * Examples:
 *   "What are my top 10 selling products this month?"
 *   "Which customers haven't ordered in 30 days?"
 *   "How's inventory looking? Anything running low?"
 *   "What's my revenue this week?"
 */

const inputSchema = z.object({
  message: z.string().min(1),
  context: z.record(z.unknown()).optional(),
});

const outputSchema = z.object({
  reply: z.string(),
  data: z.unknown().optional(),
  suggestedActions: z.array(z.string()).optional(),
});

/** Gather a concise business snapshot for LLM context */
async function getBusinessSnapshot() {
  const [productCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(eq(products.isActive, true));

  const [orderCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders);

  const [customerCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(customers)
    .where(eq(customers.isActive, true));

  const [revenue] = await db
    .select({ total: sql<number>`COALESCE(sum(${orders.totalAmount}), 0)` })
    .from(orders);

  const lowStock = await db
    .select({
      productName: products.name,
      sku: products.sku,
      quantity: inventory.quantity,
      reorderPoint: products.reorderPoint,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(
      sql`${inventory.quantity} <= COALESCE(${products.reorderPoint}, ${products.minStockLevel}, 0)`
    )
    .limit(10);

  const recentOrders = await db.query.orders.findMany({
    with: { customer: true, status: true },
    orderBy: (o, { desc }) => [desc(o.createdAt)],
    limit: 5,
  });

  const topProducts = await db
    .select({
      productName: products.name,
      totalSold: sql<number>`sum(${orderItems.quantity})`,
      totalRevenue: sql<number>`sum(${orderItems.totalAmount})`,
    })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .groupBy(products.name)
    .orderBy(sql`sum(${orderItems.totalAmount}) desc`)
    .limit(10);

  return {
    overview: {
      totalProducts: productCount.count,
      totalOrders: orderCount.count,
      totalCustomers: customerCount.count,
      totalRevenue: revenue.total,
      currency: config.currency,
    },
    lowStockItems: lowStock,
    recentOrders: recentOrders.map((o) => ({
      orderNumber: o.orderNumber,
      customer: o.customer?.name ?? "Walk-in",
      total: o.totalAmount,
      status: o.status?.label ?? "Unknown",
      date: o.createdAt,
    })),
    topProducts,
  };
}

export default createAgent({
  schema: { input: inputSchema, output: outputSchema },
  handler: async (ctx, input) => {
    const snapshot = await getBusinessSnapshot();

    const systemPrompt = `You are ${config.companyName}'s business assistant AI.
You help staff answer questions about ${config.labels.productPlural.toLowerCase()}, ${config.labels.orderPlural.toLowerCase()}, ${config.labels.customerPlural.toLowerCase()}, inventory, and business performance.

Terminology for this deployment:
- Products are called "${config.labels.product}" / "${config.labels.productPlural}"
- Orders are called "${config.labels.order}" / "${config.labels.orderPlural}"
- Customers are called "${config.labels.customer}" / "${config.labels.customerPlural}"
- Currency: ${config.currency}

Current business snapshot:
${JSON.stringify(snapshot, null, 2)}

Rules:
- Answer concisely and factually based on the data provided.
- If you don't have enough data to answer, say so and suggest what action the user could take.
- Format numbers with proper currency when relevant.
- When suggesting actions, be specific (e.g., "Reorder SKU-123").
- Never invent data that isn't in the snapshot.`;

    // Use conversation history if available
    const history = ctx.thread?.state?.messages ?? [];

    const { text } = await generateText({
      model: ctx.model ?? "openai:gpt-4o-mini",
      system: systemPrompt,
      messages: [
        ...history.map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: input.message },
      ],
    });

    // Persist to thread for conversation continuity
    if (ctx.thread) {
      const updated = [
        ...history,
        { role: "user", content: input.message },
        { role: "assistant", content: text },
      ];
      await ctx.thread.setState({ messages: updated });
    }

    // Extract suggested actions from the response
    const suggestedActions: string[] = [];
    const actionMatch = text.match(/(?:suggest|recommend|should|action).*?[:\-]\s*(.+)/gi);
    if (actionMatch) {
      suggestedActions.push(
        ...actionMatch.map((a) => a.replace(/^.*?[:\-]\s*/, "").trim()).slice(0, 5)
      );
    }

    ctx.logger.info(`Business assistant processed: "${input.message.slice(0, 80)}..."`);

    return {
      reply: text,
      data: snapshot.overview,
      suggestedActions: suggestedActions.length ? suggestedActions : undefined,
    };
  },
});
