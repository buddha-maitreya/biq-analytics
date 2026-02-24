/**
 * Analytics Engine — Typed Default Configurations
 *
 * Ships out-of-box with sensible defaults for every industry and business type.
 * Each deployment gets a fully working analytics engine without any configuration.
 * Businesses tune parameters from the Admin Console → Analytics tab.
 *
 * Design principles:
 *   - Industry-agnostic: no hardcoded verticals, units, or currencies
 *   - Conservative defaults: won't overwhelm users with false alerts
 *   - Deep-merge: DB overrides are merged on top of these defaults at runtime
 *   - Typed: full TypeScript interfaces for every parameter
 */

// ────────────────────────────────────────────────────────────
// Forecasting Defaults
// ────────────────────────────────────────────────────────────

export interface ProphetParams {
  enabled: boolean;
  /** How many days ahead to forecast */
  horizonDays: number;
  /** Prediction interval width (0.80 = 80%, 0.95 = 95%) */
  confidenceInterval: number;
  /** "additive" or "multiplicative" — multiplicative is better for data with growth */
  seasonalityMode: "additive" | "multiplicative";
  /** Changepoint sensitivity (lower = more stable, higher = more reactive) */
  changepointSensitivity: number;
  /** Include public holidays in the model */
  includeHolidays: boolean;
  /** ISO country code for holiday calendar */
  holidayCountry: string;
  /** Detect weekly patterns */
  weeklySeasonality: boolean;
  /** Detect yearly patterns */
  yearlySeasonality: boolean;
  /** Minimum data points required to run forecast (below this, skip) */
  minimumDataPoints: number;
}

export interface ArimaParams {
  enabled: boolean;
  /** Automatically determine ARIMA order (p, d, q) */
  autoOrder: boolean;
  /** Maximum AR order to search */
  maxP: number;
  /** Maximum differencing order */
  maxD: number;
  /** Maximum MA order */
  maxQ: number;
  /** Include seasonal component */
  seasonal: boolean;
  /** Seasonal period (7 = weekly, 12 = monthly, 52 = yearly) */
  seasonalPeriod: number;
}

export interface HoltWintersParams {
  enabled: boolean;
  /** Number of periods for seasonal cycle */
  seasonalPeriods: number;
  /** Trend type: "add" (additive) or "mul" (multiplicative) */
  trend: "add" | "mul";
  /** Seasonal type */
  seasonal: "add" | "mul";
  /** Damped trend — prevents runaway extrapolation */
  dampedTrend: boolean;
}

export interface ForecastingParams {
  prophet: ProphetParams;
  arima: ArimaParams;
  holtWinters: HoltWintersParams;
}

// ────────────────────────────────────────────────────────────
// Classification / Inventory Defaults
// ────────────────────────────────────────────────────────────

export interface AbcParams {
  /** Cumulative revenue % threshold for A items */
  aThresholdPct: number;
  /** Revenue % for B items (remainder is C) */
  bThresholdPct: number;
  /** Analysis period in days */
  periodDays: number;
  /** Metric to rank by: "total_revenue", "total_quantity", "transaction_count" */
  revenueMetric: string;
}

export interface XyzParams {
  /** Coefficient of variation threshold for X (low variability) items */
  xCvThreshold: number;
  /** CV threshold for Y (moderate variability) — above this is Z */
  yCvThreshold: number;
  /** Analysis period in days */
  periodDays: number;
}

export interface SafetyStockParams {
  /** Target service level (0.90 = 90%, 0.95 = 95%, 0.99 = 99%) */
  serviceLevel: number;
  /** Default supplier lead time in days */
  leadTimeDays: number;
  /** Review period in days for periodic review models */
  reviewPeriodDays: number;
  /** Try to estimate lead time from historical data */
  autoDetectLeadTime: boolean;
}

export interface EoqParams {
  /** Annual holding cost as fraction of item cost (0.25 = 25%) */
  holdingCostPct: number;
  /** Fixed cost per order (in business currency) */
  orderingCost: number;
}

export interface ClassificationParams {
  abc: AbcParams;
  xyz: XyzParams;
  safetyStock: SafetyStockParams;
  eoq: EoqParams;
}

// ────────────────────────────────────────────────────────────
// Customer Analytics Defaults
// ────────────────────────────────────────────────────────────

export interface RfmParams {
  enabled: boolean;
  /** Number of quantile bins for each R/F/M dimension */
  recencyBins: number;
  frequencyBins: number;
  monetaryBins: number;
  /** How far back to analyze (days) */
  analysisPeriodDays: number;
  /** Customizable segment labels mapped to [R, F, M] score minimums */
  segmentLabels: Record<string, number[]>;
}

export interface ClvParams {
  enabled: boolean;
  /** How many months ahead to predict lifetime value */
  predictionMonths: number;
  /** Monthly discount rate for NPV calculation */
  discountRateMonthly: number;
  /** Minimum transactions for a customer to be included */
  minimumTransactions: number;
  /** Model type */
  model: "bg_nbd_gamma_gamma";
}

export interface ChurnParams {
  enabled: boolean;
  /** Days of inactivity before a customer is considered at-risk */
  inactivityDays: number;
  /** Features to include in churn model */
  features: string[];
}

export interface BundleParams {
  enabled: boolean;
  /** Minimum support (fraction of transactions containing the itemset) */
  minSupport: number;
  /** Minimum confidence (P(B|A) — probability of consequent given antecedent) */
  minConfidence: number;
  /** Minimum lift (how much more likely items are bought together vs. independently) */
  minLift: number;
  /** Maximum items per association rule */
  maxItemsPerRule: number;
}

export interface CustomerParams {
  rfm: RfmParams;
  clv: ClvParams;
  churn: ChurnParams;
  bundles: BundleParams;
}

// ────────────────────────────────────────────────────────────
// Anomaly Detection Defaults
// ────────────────────────────────────────────────────────────

export interface TransactionAnomalyParams {
  enabled: boolean;
  /** Expected fraction of outliers (0.02 = 2%) */
  contamination: number;
  /** Sensitivity multiplier for sigma-based thresholds (higher = fewer alerts) */
  sensitivity: number;
  /** Days of data to analyze */
  lookbackDays: number;
  /** Algorithm to use */
  algorithm: "isolation_forest" | "local_outlier_factor";
  /** Features to include in anomaly model */
  features: string[];
}

export interface ShrinkageParams {
  enabled: boolean;
  /** Standard deviations beyond which to flag (2.5σ = ~1.2% false positive rate) */
  thresholdSigma: number;
  /** How often to check for shrinkage (days) */
  checkFrequencyDays: number;
  /** Minimum value (in business currency) to flag — avoids noise on cheap items */
  minValueFlag: number;
}

export interface PricingAnomalyParams {
  enabled: boolean;
  /** Flag transactions deviating more than this % from avg */
  deviationPct: number;
  /** Days of data to compute normal price range */
  lookbackDays: number;
  /** Minimum number of transactions to establish a baseline */
  minTransactions: number;
}

export interface AnomalyParams {
  transactions: TransactionAnomalyParams;
  shrinkage: ShrinkageParams;
  pricing: PricingAnomalyParams;
}

// ────────────────────────────────────────────────────────────
// Chart / Visualization Defaults
// ────────────────────────────────────────────────────────────

export interface ChartParams {
  /** Color palette mode: "brand" (uses primary/secondary), "default" (matplotlib defaults) */
  colorPalette: string;
  /** Primary brand color (hex) */
  primaryColor: string;
  /** Secondary brand color (hex) */
  secondaryColor: string;
  /** Accent color for highlights (hex) */
  accentColor: string;
  /** Chart background color */
  background: string;
  /** Enable dark mode variant */
  darkModeEnabled: boolean;
  /** DPI for web display */
  dpiWeb: number;
  /** DPI for print/PDF export */
  dpiPrint: number;
  /** Locale for number/date formatting (BCP 47) */
  locale: string;
  /** Currency symbol */
  currencySymbol: string;
  /** Currency position: "prefix" (KES 1,000) or "suffix" (1.000 €) */
  currencyPosition: "prefix" | "suffix";
  /** Font family for chart text */
  fontFamily: string;
  /** Enable watermark on charts */
  watermarkEnabled: boolean;
  /** Watermark text (if enabled) */
  watermarkText: string;
  /** Visual style: "modern", "classic", "minimal" */
  chartStyle: string;
}

// ────────────────────────────────────────────────────────────
// Pricing Intelligence Defaults
// ────────────────────────────────────────────────────────────

export interface ElasticityParams {
  enabled: boolean;
  /** Minimum number of price change events to estimate elasticity */
  minPriceChanges: number;
  /** Minimum data points per price level */
  minDataPoints: number;
  /** Days of data to analyze */
  lookbackDays: number;
  /** Estimation method */
  method: "log_linear" | "linear";
}

export interface MarkdownParams {
  enabled: boolean;
  /** Target days to sell through remaining stock */
  targetSellthroughDays: number;
  /** Minimum discount to recommend (%) */
  minDiscountPct: number;
  /** Maximum discount to recommend (%) */
  maxDiscountPct: number;
  /** Days without movement before flagging as slow-mover */
  slowMoverDays: number;
}

export interface DynamicPricingParams {
  enabled: boolean;
  /** How often to recalculate optimal prices */
  updateFrequency: "daily" | "weekly" | "monthly";
  /** Absolute minimum margin % (floor) */
  marginFloorPct: number;
  /** Weight of demand signal in price calculation */
  demandWeight: number;
  /** Weight of competition signal */
  competitionWeight: number;
  /** Weight of seasonality signal */
  seasonalityWeight: number;
}

export interface PricingParams {
  elasticity: ElasticityParams;
  markdown: MarkdownParams;
  dynamicPricing: DynamicPricingParams;
}

// ────────────────────────────────────────────────────────────
// Category Config (the row shape stored in DB)
// ────────────────────────────────────────────────────────────

export interface AnalyticsCategoryConfig {
  displayName: string;
  description: string;
  isEnabled: boolean;
  params: Record<string, unknown>;
  schedule?: Record<string, unknown>;
}

/** All analytics category names */
export const ANALYTICS_CATEGORIES = [
  "forecasting",
  "classification",
  "customer",
  "anomaly",
  "charts",
  "pricing",
] as const;

export type AnalyticsCategory = (typeof ANALYTICS_CATEGORIES)[number];

// ────────────────────────────────────────────────────────────
// Defaults (shipped out-of-box with every deployment)
// ────────────────────────────────────────────────────────────

export const ANALYTICS_DEFAULTS: Record<AnalyticsCategory, AnalyticsCategoryConfig> = {
  forecasting: {
    displayName: "Demand Forecasting",
    description:
      "Predict future product demand using Prophet, ARIMA, and Holt-Winters models. " +
      "Automatically detects seasonality, holiday effects, and trend changes.",
    isEnabled: true,
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
    } satisfies ForecastingParams as unknown as Record<string, unknown>,
    schedule: {
      enabled: false,
      cron: "0 3 * * 1",     // Weekly Monday at 3am
      description: "Weekly demand forecast refresh",
    },
  },

  classification: {
    displayName: "Inventory Classification",
    description:
      "ABC-XYZ analysis, safety stock calculation, and economic order quantity. " +
      "Categorize products by revenue impact and demand predictability.",
    isEnabled: true,
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
    } satisfies ClassificationParams as unknown as Record<string, unknown>,
    schedule: {
      enabled: false,
      cron: "0 4 1 * *",     // Monthly 1st at 4am
      description: "Monthly ABC-XYZ reclassification",
    },
  },

  customer: {
    displayName: "Customer Analytics",
    description:
      "RFM segmentation, customer lifetime value prediction, churn risk scoring, " +
      "and product bundle detection via association rule mining.",
    isEnabled: true,
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
    } satisfies CustomerParams as unknown as Record<string, unknown>,
    schedule: {
      enabled: false,
      cron: "0 5 * * 0",     // Weekly Sunday at 5am
      description: "Weekly customer segmentation refresh",
    },
  },

  anomaly: {
    displayName: "Anomaly Detection",
    description:
      "Detect unusual transactions, inventory shrinkage, and pricing anomalies " +
      "using Isolation Forest and statistical methods.",
    isEnabled: true,
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
    } satisfies AnomalyParams as unknown as Record<string, unknown>,
    schedule: {
      enabled: false,
      cron: "0 6 * * *",     // Daily at 6am
      description: "Daily anomaly detection scan",
    },
  },

  charts: {
    displayName: "Charts & Visualization",
    description:
      "Brand-aware, publication-quality charts for reports and dashboards. " +
      "Supports sales trends, heatmaps, treemaps, Pareto, and forecast plots.",
    isEnabled: true,
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
    } satisfies ChartParams as unknown as Record<string, unknown>,
  },

  pricing: {
    displayName: "Pricing Intelligence",
    description:
      "Price elasticity estimation, markdown optimization, and dynamic pricing " +
      "recommendations. Advanced feature — disabled by default.",
    isEnabled: false,
    params: {
      elasticity: {
        enabled: false,
        minPriceChanges: 3,
        minDataPoints: 30,
        lookbackDays: 180,
        method: "log_linear",
      },
      markdown: {
        enabled: false,
        targetSellthroughDays: 30,
        minDiscountPct: 5,
        maxDiscountPct: 50,
        slowMoverDays: 60,
      },
      dynamicPricing: {
        enabled: false,
        updateFrequency: "weekly",
        marginFloorPct: 10,
        demandWeight: 0.6,
        competitionWeight: 0.2,
        seasonalityWeight: 0.2,
      },
    } satisfies PricingParams as unknown as Record<string, unknown>,
  },
};

// ────────────────────────────────────────────────────────────
// Deep merge utility
// ────────────────────────────────────────────────────────────

/**
 * Deep-merge DB overrides on top of defaults.
 * - Objects are recursively merged
 * - Arrays and primitives from override replace defaults
 * - Keys not in override keep their default values
 */
export function deepMerge<T extends Record<string, unknown>>(
  defaults: T,
  overrides: Record<string, unknown> | null | undefined
): T {
  if (!overrides) return { ...defaults };

  const result: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
