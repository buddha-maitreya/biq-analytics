from pydantic import BaseModel
from typing import Any


class ChartOutput(BaseModel):
    title: str
    format: str = "png"
    data: str  # base64
    width: int
    height: int


class TableOutput(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]


class AnalyzeRequest(BaseModel):
    action: str
    data: list[dict[str, Any]]
    params: dict[str, Any] = {}
    chart_config: dict[str, Any] | None = None


class AnalyzeResponse(BaseModel):
    success: bool
    summary: dict[str, Any] | None = None
    charts: list[ChartOutput] | None = None
    table: TableOutput | None = None
    error: str | None = None
    traceback: str | None = None
