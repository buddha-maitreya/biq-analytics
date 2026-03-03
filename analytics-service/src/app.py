"""
BIQ Analytics Service -- FastAPI application.
"""

import traceback
import logging
import math

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.models import AnalyzeRequest, AnalyzeResponse
from src.config import settings
from src.dispatcher import ACTION_MAP
from src.validation import validate_input

app = FastAPI(title="BIQ Analytics Service", version=settings.version)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)


def _sanitize(obj):
    """Replace NaN/Infinity with None for JSON serialization."""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    return obj


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    action = request.action
    if action not in ACTION_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")
    try:
        validate_input(action, request.data)
        result = ACTION_MAP[action](request.data, request.params, request.chart_config)
        result = _sanitize(result)
        # Ensure success key is present
        if isinstance(result, dict) and "success" not in result:
            result["success"] = "error" not in result
        return AnalyzeResponse(**result) if isinstance(result, dict) else result
    except ValueError as e:
        return AnalyzeResponse(success=False, error=str(e))
    except Exception as e:
        logger.error(f"Action {action} failed: {e}", exc_info=True)
        return AnalyzeResponse(success=False, error=str(e), traceback=traceback.format_exc())


@app.get("/health")
async def health():
    return {"status": "healthy", "modules": len(ACTION_MAP), "version": settings.version}


@app.get("/actions")
async def actions():
    return {"actions": list(ACTION_MAP.keys())}
