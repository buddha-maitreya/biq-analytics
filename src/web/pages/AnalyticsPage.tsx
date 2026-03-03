import React from "react";
import PredictiveAnalytics from "../components/PredictiveAnalytics";
import type { AppConfig } from "../types";

interface AnalyticsPageProps {
  config: AppConfig;
}

export default function AnalyticsPage({ config }: AnalyticsPageProps) {
  return (
    <div className="page analytics-page">
      <div className="page-header-row">
        <div>
          <h2>Analytics Explorer</h2>
          <p className="text-muted" style={{ marginTop: 4, fontSize: 14 }}>
            Run AI analytics modules on your {config.labels.productPlural.toLowerCase()} and {config.labels.orderPlural.toLowerCase()} data
          </p>
        </div>
      </div>
      <PredictiveAnalytics />
    </div>
  );
}
