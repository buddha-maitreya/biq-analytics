# BIQ Analytics Service

FastAPI microservice — 27 analytics modules served via HTTP. Stateless, shared across all clients.

## Local Development

```bash
# Build and start (first build takes ~5 min — compiles CmdStan for Prophet)
docker-compose up analytics

# Run tests
docker-compose run --rm test

# Smoke test
curl http://localhost:8000/health
# → {"status":"healthy","modules":27,"version":"1.0.0"}

curl http://localhost:8000/actions
# → {"actions":["chart.sales_trends","forecast.prophet",...]}

curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"action":"forecast.prophet","data":[{"date":"2026-01-01","amount":1000},...]}'
```

## Deploy to Railway

1. Push `analytics-service/` to its own GitHub repo (or a subdirectory deploy)
2. In Railway: **New Project → Deploy from GitHub repo**
3. Railway auto-detects `Dockerfile` and `railway.toml`
4. First build takes ~8-10 min (CmdStan compilation) — subsequent deploys are faster
5. Copy the Railway service URL (e.g. `https://biq-analytics.up.railway.app`)
6. Set `ANALYTICS_SERVICE_URL=https://biq-analytics.up.railway.app` in your Agentuity environment

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | Set automatically by Railway |
| `LOG_LEVEL` | `info` | Uvicorn log level |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins (lock down in production) |

## Analytics Modules (27)

| Category | Actions |
|----------|---------|
| Charts (9) | `chart.sales_trends`, `chart.heatmap`, `chart.scatter`, `chart.treemap`, `chart.pareto`, `chart.waterfall`, `chart.forecast`, `chart.geo_map`, `chart.render` |
| Forecasting (5) | `forecast.prophet`, `forecast.arima`, `forecast.holt_winters`, `forecast.safety_stock`, `forecast.seasonal_detect` |
| Classification (4) | `classify.abc_xyz`, `classify.rfm`, `classify.clv`, `classify.bundles` |
| Anomaly (2) | `anomaly.transactions`, `anomaly.shrinkage` |
| Insights (7) | `insights.value_gap`, `insights.dead_stock`, `insights.cash_simulation`, `insights.procurement_plan`, `insights.supplier_analysis`, `insights.stockout_cost`, `insights.sales_velocity` |
