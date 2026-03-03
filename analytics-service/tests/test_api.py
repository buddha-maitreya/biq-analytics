"""Tests for the FastAPI application endpoints."""

from fastapi.testclient import TestClient
from src.app import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "healthy"
    assert body["modules"] > 0


def test_actions():
    r = client.get("/actions")
    assert r.status_code == 200
    actions = r.json()["actions"]
    assert "forecast.prophet" in actions
    assert "insights.sales_velocity" in actions
    assert "insights.dead_stock" in actions
    assert "chart.render" in actions
    assert "anomaly.transactions" in actions


def test_unknown_action():
    r = client.post("/analyze", json={"action": "unknown", "data": []})
    assert r.status_code == 400


def test_analyze_empty_data():
    r = client.post("/analyze", json={
        "action": "chart.sales_trends",
        "data": [],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is False
    assert body["error"] is not None
