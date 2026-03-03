"""Tests for chart modules."""

from src.charts import sales_trends, pareto, scatter, treemap


def test_sales_trends(daily_sales_90):
    result = sales_trends.run(daily_sales_90, {}, {})
    assert result["success"] is True or "charts" in result
    assert "charts" in result
    assert len(result["charts"]) > 0
    chart = result["charts"][0]
    assert "format" in chart
    assert "data" in chart
    assert "title" in chart


def test_sales_trends_empty():
    result = sales_trends.run([], {}, {})
    assert result.get("success") is False or "error" in result


def test_pareto(daily_sales_90):
    pareto_data = [{"name": f"Product {i}", "revenue": 1000 - i * 30} for i in range(20)]
    result = pareto.run(pareto_data, {}, {})
    assert "charts" in result
    assert len(result["charts"]) > 0
    assert result["charts"][0]["format"] == "png"
    assert result["charts"][0]["title"]


def test_scatter():
    scatter_data = [
        {"product_name": f"P{i}", "quantity": 50 + i * 10, "revenue": 500 + i * 50,
         "cost": 300 + i * 20, "margin": 20 + i}
        for i in range(10)
    ]
    result = scatter.run(scatter_data, {}, {})
    assert "charts" in result
    assert len(result["charts"]) > 0


def test_treemap():
    treemap_data = [
        {"product_name": f"P{i}", "category": ["Electronics", "Food", "Tools"][i % 3],
         "revenue": 1000 - i * 50}
        for i in range(15)
    ]
    result = treemap.run(treemap_data, {}, {})
    assert "charts" in result
    assert len(result["charts"]) > 0
    assert result["charts"][0]["title"]
