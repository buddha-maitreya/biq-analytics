import { createRouter } from "@agentuity/runtime";
import reportGenerator from "@agent/report-generator";
import { errorMiddleware, ValidationError } from "@lib/errors";
import { authMiddleware } from "@services/auth";

const reports = createRouter();
reports.use(errorMiddleware());
reports.use(authMiddleware());

/**
 * POST /reports/generate — Generate an AI-powered business report.
 *
 * The report-generator agent input schema:
 *   { reportType, startDate?, endDate?, format? }
 * Output schema:
 *   { title, reportType, period: { start, end }, content, generatedAt }
 */
reports.post("/generate", async (c) => {
  const { type, periodDays } = await c.req.json();

  if (!type) {
    throw new ValidationError("Report type is required");
  }

  const validTypes = [
    "sales-summary",
    "inventory-health",
    "customer-activity",
    "financial-overview",
  ];

  if (!validTypes.includes(type)) {
    throw new ValidationError(
      `Invalid report type. Must be one of: ${validTypes.join(", ")}`,
    );
  }

  // Calculate date range from periodDays (default 30)
  const days = periodDays ?? 30;
  const endDate = new Date().toISOString();
  const startDate = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Agent input uses `reportType` (not `type`) and date strings
  const result = await reportGenerator.run({
    reportType: type,
    startDate,
    endDate,
    format: "markdown" as const,
  });

  return c.json({
    data: {
      title: result.title,
      reportType: result.reportType,
      period: result.period,
      content: result.content,
      generatedAt: result.generatedAt,
    },
  });
});

export default reports;
