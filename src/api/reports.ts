import { createRouter } from "@agentuity/runtime";
import reportGenerator from "@agent/report-generator";

const reports = createRouter();

// POST /reports/generate — Generate an AI-powered report
reports.post("/generate", async (c) => {
  try {
    const { type, periodDays } = await c.req.json();

    if (!type) {
      return c.json({ error: "Report type is required" }, 400);
    }

    const validTypes = [
      "sales-summary",
      "inventory-health",
      "customer-activity",
      "financial-overview",
    ];

    if (!validTypes.includes(type)) {
      return c.json(
        { error: `Invalid report type. Must be one of: ${validTypes.join(", ")}` },
        400
      );
    }

    const result = await reportGenerator.run({
      data: {
        type,
        periodDays: periodDays ?? 30,
      },
    });

    const output = result?.data as { report?: string } | undefined;

    return c.json({
      data: {
        report: output?.report ?? "Unable to generate report.",
        type,
        periodDays: periodDays ?? 30,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Report generation error" }, 500);
  }
});

export default reports;
