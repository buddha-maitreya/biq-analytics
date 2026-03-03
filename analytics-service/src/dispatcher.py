"""
Action Dispatcher -- Maps action strings to module run() functions.

Includes all 20 existing actions + 1 previously unregistered (insights.dead_stock)
+ 6 new Tier 2 modules.
"""

from src.charts import sales_trends, heatmap, scatter, treemap, pareto, waterfall, forecast_plot, geo_map, render_chart
from src.forecasting import prophet_forecast, arima, holt_winters, safety_stock, seasonal_detect
from src.anomaly import isolation_forest, shrinkage
from src.classification import abc_xyz, rfm, clv, bundles
from src.insights import value_gap, dead_stock, cash_simulation, procurement_plan, supplier_analysis, stockout_cost, sales_velocity

ACTION_MAP = {
    # Charts (9)
    "chart.sales_trends": sales_trends.run,
    "chart.heatmap": heatmap.run,
    "chart.scatter": scatter.run,
    "chart.treemap": treemap.run,
    "chart.pareto": pareto.run,
    "chart.waterfall": waterfall.run,
    "chart.forecast": forecast_plot.run,
    "chart.geo_map": geo_map.run,
    "chart.render": render_chart.run,
    # Forecasting (5 -- 1 NEW)
    "forecast.prophet": prophet_forecast.run,
    "forecast.arima": arima.run,
    "forecast.holt_winters": holt_winters.run,
    "forecast.safety_stock": safety_stock.run,
    "forecast.seasonal_detect": seasonal_detect.run,      # NEW Tier 2
    # Classification (4)
    "classify.abc_xyz": abc_xyz.run,
    "classify.rfm": rfm.run,
    "classify.clv": clv.run,
    "classify.bundles": bundles.run,
    # Anomaly (2)
    "anomaly.transactions": isolation_forest.run,
    "anomaly.shrinkage": shrinkage.run,
    # Insights (7 -- 5 NEW, 1 previously unregistered)
    "insights.value_gap": value_gap.run,
    "insights.dead_stock": dead_stock.run,                # WAS MISSING from dispatcher
    "insights.cash_simulation": cash_simulation.run,      # NEW Tier 2
    "insights.procurement_plan": procurement_plan.run,    # NEW Tier 2
    "insights.supplier_analysis": supplier_analysis.run,  # NEW Tier 2
    "insights.stockout_cost": stockout_cost.run,          # NEW Tier 2
    "insights.sales_velocity": sales_velocity.run,        # NEW Tier 2
}
