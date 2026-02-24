/**
 * Seed Analytics Configs — Demo / First-Run Seeder
 *
 * Seeds all analytics config categories with sensible defaults.
 * Idempotent — safe to re-run.
 *
 * Customizes the demo deployment (Ruskin's Safaris Curio Shop):
 *   - Holiday calendar: KE (Kenya)
 *   - Currency: KES
 *   - Brand colors from the demo's primary theme
 *   - Seasonality: yearly (tourist seasons)
 *
 * Usage:
 *   bun demo/seed-analytics-configs.ts
 */

import { seedAnalyticsDefaults, upsertAnalyticsConfig } from "@services/analytics-configs";

async function main() {
  console.log("Seeding analytics configs...\n");

  // Step 1: Seed all default categories (idempotent)
  await seedAnalyticsDefaults();
  console.log("✓ Default categories seeded");

  // Step 2: Customize for demo deployment (Ruskin's Safaris)
  await upsertAnalyticsConfig({
    category: "forecasting",
    params: {
      prophet: {
        enabled: true,
        horizonDays: 30,
        confidenceInterval: 0.95,
        seasonalityMode: "multiplicative",
        changepointSensitivity: 0.05,
        includeHolidays: true,
        holidayCountry: "KE",
        weeklySeasonality: true,
        yearlySeasonality: true,
        minimumDataPoints: 30,
      },
      arima: {
        enabled: true,
        autoOrder: true,
        maxP: 5,
        maxD: 2,
        maxQ: 5,
        seasonal: true,
        seasonalPeriod: 7,
      },
      holtWinters: {
        enabled: true,
        seasonalPeriods: 7,
        trend: "add",
        seasonal: "mul",
        dampedTrend: true,
      },
    },
    schedule: {
      enabled: true,
      cron: "0 3 * * 1",
      description: "Weekly demand forecast refresh",
    },
  });
  console.log("✓ Forecasting configured (KE holidays, weekly refresh)");

  await upsertAnalyticsConfig({
    category: "classification",
    params: {
      abc: {
        aThresholdPct: 80,
        bThresholdPct: 15,
        periodDays: 90,
        revenueMetric: "total_revenue",
      },
      xyz: {
        xCvThreshold: 0.5,
        yCvThreshold: 1.0,
        periodDays: 90,
      },
      safetyStock: {
        serviceLevel: 0.95,
        leadTimeDays: 7,
        reviewPeriodDays: 7,
        autoDetectLeadTime: true,
      },
      eoq: {
        holdingCostPct: 0.25,
        orderingCost: 500,
      },
    },
    schedule: {
      enabled: true,
      cron: "0 4 1 * *",
      description: "Monthly ABC-XYZ reclassification",
    },
  });
  console.log("✓ Inventory classification configured (95% service level)");

  await upsertAnalyticsConfig({
    category: "customer",
    params: {
      rfm: {
        enabled: true,
        recencyBins: 5,
        frequencyBins: 5,
        monetaryBins: 5,
        analysisPeriodDays: 365,
        segmentLabels: {
          champions: [5, 4, 4],
          loyal: [3, 3, 3],
          potential_loyalists: [4, 2, 2],
          at_risk: [2, 3, 3],
          hibernating: [1, 1, 1],
          lost: [1, 1, 2],
        },
      },
      clv: {
        enabled: true,
        predictionMonths: 12,
        discountRateMonthly: 0.01,
        minimumTransactions: 2,
        model: "bg_nbd_gamma_gamma",
      },
      churn: {
        enabled: false,
        inactivityDays: 90,
        features: ["recency", "frequency", "monetary", "avg_order_value", "order_trend"],
      },
      bundles: {
        enabled: true,
        minSupport: 0.01,
        minConfidence: 0.3,
        minLift: 1.5,
        maxItemsPerRule: 3,
      },
    },
  });
  console.log("✓ Customer analytics configured (RFM + CLV + bundles)");

  await upsertAnalyticsConfig({
    category: "anomaly",
    params: {
      transactions: {
        enabled: true,
        contamination: 0.02,
        sensitivity: 3,
        lookbackDays: 90,
        algorithm: "isolation_forest",
        features: ["amount", "quantity", "hour_of_day", "day_of_week"],
      },
      shrinkage: {
        enabled: true,
        thresholdSigma: 2.5,
        checkFrequencyDays: 7,
        minValueFlag: 1000,
      },
      pricing: {
        enabled: true,
        deviationPct: 20,
        lookbackDays: 30,
        minTransactions: 5,
      },
    },
    schedule: {
      enabled: true,
      cron: "0 6 * * *",
      description: "Daily anomaly detection scan",
    },
  });
  console.log("✓ Anomaly detection configured (daily scan)");

  await upsertAnalyticsConfig({
    category: "charts",
    params: {
      colorPalette: "brand",
      primaryColor: "#3b82f6",
      secondaryColor: "#10b981",
      accentColor: "#f59e0b",
      background: "#ffffff",
      darkModeEnabled: false,
      dpiWeb: 150,
      dpiPrint: 300,
      locale: "en-KE",
      currencySymbol: "KES",
      currencyPosition: "prefix",
      fontFamily: "Inter",
      watermarkEnabled: false,
      watermarkText: "",
      chartStyle: "modern",
    },
  });
  console.log("✓ Chart styling configured (KES, brand colors, modern)");

  // Pricing intelligence — disabled for demo (advanced feature)
  await upsertAnalyticsConfig({
    category: "pricing",
    isEnabled: false,
  });
  console.log("✓ Pricing intelligence configured (disabled — advanced)");

  console.log("\n✅ All analytics configs seeded successfully!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to seed analytics configs:", err);
  process.exit(1);
});
