/**
 * Sandbox Execution Helper — shared utility for running LLM-generated
 * code in isolated Agentuity sandboxes.
 *
 * Architecture:
 *   1. LLM generates code + optional SQL query
 *   2. If SQL is provided, we execute it against the DB first
 *   3. Data is serialized as JSON and written as a file in the sandbox
 *   4. The sandbox runs the code in the chosen runtime (default: bun:1)
 *   5. The sandbox must write its JSON result to stdout
 *   6. We parse stdout and return structured results
 *
 * Uses the Agentuity sandbox SDK (`ctx.sandbox`):
 *   - `sandbox.run()` for one-shot execution (auto-creates and destroys sandbox)
 *   - `sandbox.create()` for interactive sessions (persistent sandbox)
 *   - `sandbox.snapshot.create()` for pre-configured environment snapshots
 *
 * Enhancements:
 *   4.1 — Error classification (syntax/runtime/timeout/resource/import)
 *          Output size limits (configurable, default 512KB)
 *          Retry with LLM correction (up to N retries, structured error feedback)
 *          Explicit sandbox.destroy() in finally blocks
 *   4.2 — Snapshot support (snapshotId config, create/restore)
 *   4.3 — Interactive session management (multi-step execution in one sandbox)
 *   4.4 — Multi-runtime support (bun:1, python, node)
 *
 * Security:
 *   - Network disabled by default (enabled only when Python has no snapshot, for uv pip install)
 *   - Only SELECT queries are allowed (safety-checked)
 *   - Execution timeout: configurable (default 30s)
 *   - Memory limit: configurable (default 256MB)
 *   - Code runs in full isolation — no host access
 */

import { db } from "@db/index";
import { sql } from "drizzle-orm";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/** Maximum stdout size before truncation (bytes) */
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024; // 512KB

/** Maximum data rows to pass to sandbox (keep low to reduce token bloat in LLM tool results) */
const MAX_DATA_ROWS = 200;

/**
 * Default snapshot ID for Python runtimes.
 * Read from ANALYTICS_SNAPSHOT_ID env var — set once per deployment,
 * used automatically by all agents that run Python sandboxes.
 * Eliminates per-request `uv pip install` (~6-10s) by booting from
 * a pre-configured snapshot with numpy, pandas, scipy, sklearn, etc.
 */
const DEFAULT_PYTHON_SNAPSHOT_ID = process.env.ANALYTICS_SNAPSHOT_ID || undefined;

/** Supported sandbox runtimes (shorthand aliases + versioned names) */
export type SandboxRuntime =
  | "bun:1"
  | "python:3.13"
  | "python:3.14"
  | "node:latest"
  | "node:lts"
  | "python"   // alias → python:3.13
  | "node";    // alias → node:latest

// ────────────────────────────────────────────────────────────
// SDK format helpers
// ────────────────────────────────────────────────────────────

/** Resolve runtime aliases to fully-qualified runtime names per SDK convention. */
function normalizeRuntime(runtime: SandboxRuntime): string {
  switch (runtime) {
    case "python": return "python:3.13";
    case "node": return "node:latest";
    default: return runtime;
  }
}

/** Check if a runtime is Python-based. */
function isPythonRuntime(runtime: SandboxRuntime): boolean {
  return runtime === "python" || runtime.startsWith("python:");
}

/** Convert human-readable memory strings to Kubernetes-style (256MB → 256Mi). */
function normalizeMemory(mem: string): string {
  const m = mem.match(/^(\d+)\s*(MB|GB)$/i);
  if (!m) return mem; // already Kubernetes-style (Mi/Gi) or unknown format
  return m[2].toUpperCase() === "GB" ? `${m[1]}Gi` : `${m[1]}Mi`;
}

/** Convert milliseconds to a duration string for the sandbox API (30000 → "30s"). */
function msToDuration(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600}h`;
  if (s >= 60 && s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

// ────────────────────────────────────────────────────────────
// Error Classification
// ────────────────────────────────────────────────────────────

/**
 * Classified error types for structured LLM feedback.
 * The LLM can use these to decide how to self-correct:
 * - syntax: Fix the code syntax (typos, missing brackets, etc.)
 * - runtime: Fix logic errors (null access, type errors, etc.)
 * - timeout: Simplify the code or reduce data scope
 * - resource: Reduce memory usage or data size
 * - import: Remove the unavailable import/require
 * - sql: Fix the SQL query
 * - output: Reduce output size or aggregate results
 * - unknown: Unclassifiable error
 */
export type SandboxErrorType =
  | "syntax"
  | "runtime"
  | "timeout"
  | "resource"
  | "import"
  | "sql"
  | "output"
  | "unknown";

/**
 * Classify an error based on stderr/stdout/error message.
 * Returns both the type and a human-readable hint for the LLM.
 */
export function classifyError(
  stderr: string,
  stdout: string,
  error?: string
): { type: SandboxErrorType; hint: string } {
  const combined = `${stderr}\n${stdout}\n${error ?? ""}`.toLowerCase();

  // Syntax errors
  if (
    combined.includes("syntaxerror") ||
    combined.includes("unexpected token") ||
    combined.includes("unexpected end of input") ||
    combined.includes("unterminated string") ||
    combined.includes("missing )") ||
    combined.includes("parse error") ||
    combined.includes("indentationerror") ||
    combined.includes("unexpected indent") ||
    combined.includes("expected an indented block")
  ) {
    return {
      type: "syntax",
      hint: "The code has a syntax error. For Python: check indentation (use 4 spaces), colons after if/for/def, and matching brackets.",
    };
  }

  // Import/require failures
  if (
    combined.includes("cannot find module") ||
    combined.includes("module not found") ||
    combined.includes("cannot find package") ||
    combined.includes("no module named") ||
    combined.includes("modulenotfounderror") ||
    (combined.includes("is not defined") &&
      (combined.includes("require") || combined.includes("import")))
  ) {
    return {
      type: "import",
      hint: "The code tries to import a module that is not available. Use only pre-installed packages: numpy, pandas, scipy, scikit-learn, statsmodels, and Python built-ins.",
    };
  }

  // Timeout
  if (
    combined.includes("timeout") ||
    combined.includes("timed out") ||
    combined.includes("execution time")
  ) {
    return {
      type: "timeout",
      hint: "Execution timed out. Simplify the algorithm, reduce data scope, or use more efficient methods.",
    };
  }

  // Resource limits (OOM, disk, cpu)
  if (
    combined.includes("out of memory") ||
    combined.includes("heap out of memory") ||
    combined.includes("allocation failed") ||
    combined.includes("memory limit") ||
    combined.includes("killed") ||
    combined.includes("oom")
  ) {
    return {
      type: "resource",
      hint: "Exceeded memory limit. Reduce data size, avoid large arrays/objects, or aggregate in SQL instead.",
    };
  }

  // Output too large
  if (
    combined.includes("output truncated") ||
    combined.includes("output size exceeded")
  ) {
    return {
      type: "output",
      hint: "Output is too large. Aggregate or summarize results instead of returning raw data.",
    };
  }

  // Runtime errors (TypeError, ReferenceError, RangeError, etc.)
  if (
    combined.includes("typeerror") ||
    combined.includes("referenceerror") ||
    combined.includes("rangeerror") ||
    combined.includes("cannot read properties") ||
    combined.includes("is not a function") ||
    combined.includes("is not defined") ||
    combined.includes("undefined is not") ||
    combined.includes("nameerror") ||
    combined.includes("attributeerror") ||
    combined.includes("keyerror") ||
    combined.includes("indexerror") ||
    combined.includes("valueerror") ||
    combined.includes("zerodivisionerror")
  ) {
    return {
      type: "runtime",
      hint: "Runtime error in the code. For Python: check for None/NaN values, wrong column names, empty DataFrames, zero division, or incorrect types. Use .fillna(), try/except, and len() checks.",
    };
  }

  // SQL errors
  if (
    combined.includes("sql") &&
    (combined.includes("error") || combined.includes("failed"))
  ) {
    return {
      type: "sql",
      hint: "The SQL query failed. Check table/column names, syntax, and data types.",
    };
  }

  return {
    type: "unknown",
    hint: "An unexpected error occurred. Review the error message and try a different approach.",
  };
}

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface SandboxInput {
  /** Code to execute in the sandbox (Python for python runtimes, JavaScript for bun:1/node) */
  code: string;
  /** Optional SQL SELECT query to run first — results are passed as DATA to the sandbox */
  sqlQuery?: string;
  /** Plain text explanation of what this analysis does */
  explanation: string;
  /** Optional pre-built data to pass directly (bypasses SQL) */
  data?: unknown;
  /** Execution timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Maximum output size in bytes (default: 512KB) */
  maxOutputBytes?: number;
  /** Runtime to use (default: "bun:1"). Accepts aliases: "python" → "python:3.14", "node" → "node:latest" */
  runtime?: SandboxRuntime;
  /** Snapshot tag or ID to restore from (faster cold start with pre-installed deps) */
  snapshotId?: string;
  /** @deprecated npm packages are no longer installed per-run. Use snapshots via createAnalysisSnapshot(). Ignored by executeSandbox(). */
  dependencies?: string[];
  /** Memory limit in Kubernetes format (e.g. "256Mi", "512Mi", "1Gi"). Legacy "256MB" format is auto-converted. */
  memory?: string;
  /**
   * Enable direct database access from within the sandbox.
   * When true:
   *   - DATABASE_URL is injected as an env var into the sandbox
   *   - Python scripts get a `query_db(sql)` helper function
   *   - The script queries Postgres directly (via psycopg2)
   *   - Server-side SQL fetching is skipped (no data.json for SQL)
   *   - Network is enabled (required for DB connection)
   * Requires `psycopg2-binary` in the snapshot.
   */
  directDbAccess?: boolean;
  /**
   * Brand-aware chart configuration injected into the Python sandbox.
   * When provided, injects `create_chart()` and `save_chart()` helpers
   * that produce publication-quality matplotlib/seaborn charts with
   * brand colors, currency formatting, and professional styling.
   * Charts are returned as base64 PNG in the `_charts` array of the result.
   */
  chartConfig?: {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    currencySymbol?: string;
    currencyPosition?: "prefix" | "suffix";
    companyName?: string;
    chartStyle?: "modern" | "classic" | "minimal";
    fontFamily?: string;
    dpi?: number;
  };
}

export interface SandboxResult {
  /** Whether execution succeeded */
  success: boolean;
  /** The parsed JSON result from the sandbox (stdout) */
  result?: unknown;
  /** Raw stdout from the sandbox (may be truncated) */
  stdout?: string;
  /** Stderr output (errors, warnings) */
  stderr?: string;
  /** Exit code from the sandbox process */
  exitCode?: number;
  /** Number of data rows passed to the sandbox */
  dataRowCount?: number;
  /** Error message if something failed */
  error?: string;
  /** What this analysis does */
  explanation: string;
  /** Classified error type for LLM self-correction */
  errorType?: SandboxErrorType;
  /** Human-readable hint for fixing the error */
  errorHint?: string;
  /** Whether stdout was truncated due to size limits */
  outputTruncated?: boolean;
  /** Runtime that was used */
  runtime?: SandboxRuntime;
  /** Charts generated via save_chart() in the Python sandbox (base64 PNGs) */
  charts?: Array<{
    /** Base64-encoded PNG image data */
    data: string;
    /** Chart title */
    title: string;
    /** Display width in pixels */
    width: number;
    /** Display height in pixels */
    height: number;
  }>;
}

/**
 * Options for retry-with-correction behavior.
 */
export interface RetryOptions {
  /** Maximum number of retries (default: 2) */
  maxRetries?: number;
  /** Function that receives the failed result and returns corrected code,
   *  or null to stop retrying. */
  correctCode?: (
    failedResult: SandboxResult,
    attempt: number
  ) => Promise<string | null>;
}

/**
 * Interactive sandbox session for multi-step execution.
 * Wraps a persistent sandbox instance with lifecycle management.
 */
export interface SandboxSession {
  /** Execute code in the session's sandbox */
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Write a file to the session's sandbox filesystem */
  writeFile(path: string, content: string): Promise<void>;
  /** Take a snapshot of the current session state */
  snapshot(): Promise<{ id: string }>;
  /** Destroy the session (cleanup) */
  destroy(): Promise<void>;
  /** The runtime this session uses */
  readonly runtime: SandboxRuntime;
  /** Whether the session has been destroyed */
  readonly destroyed: boolean;
}

// ────────────────────────────────────────────────────────────
// SQL safety check
// ────────────────────────────────────────────────────────────

function isSafeSelect(query: string): boolean {
  const trimmed = query.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) return false;
  const dangerous = [
    "DROP", "DELETE", "INSERT", "UPDATE", "ALTER",
    "TRUNCATE", "GRANT", "REVOKE", "CREATE",
  ];
  for (const keyword of dangerous) {
    const pattern = new RegExp(`\\b${keyword}\\b`, "i");
    const withoutStrings = query.replace(/'[^']*'/g, "");
    if (pattern.test(withoutStrings)) return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────
// Script builders (per-runtime)
// ────────────────────────────────────────────────────────────

/**
 * Builds the wrapper script for Bun runtime (.ts file).
 * Reads DATA from data.json file, runs analysis code, outputs JSON to stdout.
 */
function buildBunScript(analysisCode: string): string {
  return `
// ── Sandbox wrapper ──────────────────────────────
import { readFileSync } from 'fs';
const DATA = JSON.parse(readFileSync('data.json', 'utf-8'));

// ── Analysis code (LLM-generated) ────────────────
try {
  const __analysisResult = await (async () => {
    ${analysisCode}
  })();
  if (__analysisResult !== undefined) {
    console.log(JSON.stringify(__analysisResult));
  }
} catch (err) {
  console.error("Analysis error: " + (err?.message || String(err)));
  process.exit(1);
}
`;
}

/**
 * Builds the wrapper script for Node.js runtime (.js file).
 * Uses async IIFE for top-level await compatibility.
 */
function buildNodeScript(analysisCode: string): string {
  return `
// ── Sandbox wrapper ──────────────────────────────
const fs = require('fs');
const DATA = JSON.parse(fs.readFileSync('data.json', 'utf-8'));

(async () => {
  try {
    const __analysisResult = await (async () => {
      ${analysisCode}
    })();
    if (__analysisResult !== undefined) {
      console.log(JSON.stringify(__analysisResult));
    }
  } catch (err) {
    console.error("Analysis error: " + (err?.message || String(err)));
    process.exit(1);
  }
})();
`;
}

/**
 * Builds the wrapper script for Python runtime (.py file).
 * Reads DATA from data.json file, imports data science libraries,
 * runs analysis code, and outputs JSON to stdout.
 *
 * Key features:
 * - Automatically imports numpy, pandas, scipy, sklearn, statsmodels, datetime
 * - Provides DATA as both a raw list and a pandas DataFrame (DF)
 * - Custom JSON encoder handles numpy/pandas types (ndarray, int64, Timestamp, etc.)
 * - LLM code runs inside a function with access to all imports and data
 * - When directDbAccess is true, provides query_db(sql) for live Postgres queries
 */
function buildPythonScript(
  analysisCode: string,
  directDbAccess = false,
  chartConfig?: SandboxInput["chartConfig"]
): string {
  // query_db() helper — injected when directDbAccess is enabled
  const queryDbHelper = directDbAccess ? `
# ── Direct database access ──────────────────────────────────
# query_db(sql) connects to Postgres via DATABASE_URL env var.
# Returns a list of dicts (one per row). Only SELECT queries allowed.
import os as _os

_DB_CONN = None

def query_db(sql, limit=None):
    """Execute a SELECT query against the business database.
    
    Args:
        sql: PostgreSQL SELECT query string
        limit: Optional row limit (appended as LIMIT clause if not already present)
    
    Returns:
        list[dict] — one dict per row, keyed by column name
    """
    import re
    # Safety: only SELECT/WITH queries
    stripped = sql.strip().rstrip(';')
    first_word = re.split(r'\\s+', stripped, maxsplit=1)[0].upper()
    if first_word not in ('SELECT', 'WITH'):
        raise ValueError(f"Only SELECT/WITH queries allowed, got: {first_word}")
    for forbidden in ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'ALTER ', 'TRUNCATE ', 'CREATE ', 'GRANT ', 'REVOKE ']:
        if forbidden in stripped.upper():
            raise ValueError(f"Dangerous SQL keyword detected: {forbidden.strip()}")
    
    # Add LIMIT if requested and not already present
    if limit and 'LIMIT' not in stripped.upper():
        stripped = f"{stripped} LIMIT {int(limit)}"
    
    global _DB_CONN
    import psycopg2
    import psycopg2.extras
    if _DB_CONN is None or _DB_CONN.closed:
        _DB_CONN = psycopg2.connect(_os.environ['DATABASE_URL'])
        _DB_CONN.set_session(readonly=True, autocommit=True)
    
    with _DB_CONN.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(stripped)
        rows = cur.fetchall()
    return [dict(r) for r in rows]

def query_df(sql, limit=None):
    """Like query_db() but returns a pandas DataFrame with date columns auto-parsed."""
    rows = query_db(sql, limit=limit)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    for col in df.columns:
        if any(kw in col.lower() for kw in ['date', 'time', 'created', 'updated', 'at']):
            try:
                df[col] = pd.to_datetime(df[col], errors='coerce')
            except Exception:
                pass
    return df

import atexit
def _close_db():
    global _DB_CONN
    if _DB_CONN and not _DB_CONN.closed:
        _DB_CONN.close()
atexit.register(_close_db)
` : '';

  return `
import sys
import json
import math
import subprocess
import os
from datetime import datetime, timedelta, date
from decimal import Decimal
from collections import Counter, defaultdict

# ── Auto-bootstrap: install packages if not available ───────
# When no snapshot is configured, use uv to install packages at runtime.
# This adds ~6-10s to the first execution but ensures packages are available.
def _ensure_packages():
    """Install data science packages via uv if not already available."""
    try:
        import numpy
        return  # Packages already available (snapshot or previous install)
    except ImportError:
        pass
    
    venv_dir = "/var/agentuity/venv"
    venv_python = os.path.join(venv_dir, "bin", "python")
    
    # Create venv if it doesn't exist
    if not os.path.exists(venv_python):
        subprocess.run(["uv", "venv", venv_dir], check=True,
                       capture_output=True, timeout=30)
    
    # Install packages into the venv
    subprocess.run(
        ["uv", "pip", "install", "--python", venv_python,
         "numpy", "pandas", "scipy", "scikit-learn", "statsmodels"],
        check=True, capture_output=True, timeout=120
    )
    
    # Add venv site-packages to sys.path so imports work
    import glob
    site_pkgs = glob.glob(os.path.join(venv_dir, "lib", "python*", "site-packages"))
    if site_pkgs:
        sys.path.insert(0, site_pkgs[0])

try:
    _ensure_packages()
except Exception:
    pass  # Fall back to stdlib if install fails

# ── Data science imports ────────────────────────────────────
try:
    import numpy as np
except ImportError:
    np = None

try:
    import pandas as pd
except ImportError:
    pd = None

try:
    from scipy import stats as scipy_stats
    from scipy.optimize import curve_fit
except ImportError:
    scipy_stats = None
    curve_fit = None

try:
    from sklearn.linear_model import LinearRegression
    from sklearn.ensemble import RandomForestRegressor, IsolationForest
    from sklearn.preprocessing import StandardScaler
    from sklearn.cluster import KMeans
    from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error
except ImportError:
    LinearRegression = None
    RandomForestRegressor = None
    IsolationForest = None
    StandardScaler = None
    KMeans = None
    mean_squared_error = None
    r2_score = None
    mean_absolute_error = None

try:
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    from statsmodels.tsa.seasonal import seasonal_decompose
    from statsmodels.tsa.stattools import adfuller
except ImportError:
    ExponentialSmoothing = None
    seasonal_decompose = None
    adfuller = None

# ── Custom JSON encoder for numpy/pandas types ─────────────
class AnalysisEncoder(json.JSONEncoder):
    def default(self, obj):
        if np is not None:
            if isinstance(obj, (np.integer,)):
                return int(obj)
            if isinstance(obj, (np.floating,)):
                if np.isnan(obj) or np.isinf(obj):
                    return None
                return float(obj)
            if isinstance(obj, np.ndarray):
                return obj.tolist()
            if isinstance(obj, np.bool_):
                return bool(obj)
        if pd is not None:
            if isinstance(obj, pd.Timestamp):
                return obj.isoformat()
            if isinstance(obj, pd.Series):
                return obj.tolist()
            if isinstance(obj, pd.DataFrame):
                return obj.to_dict(orient='records')
            if pd.isna(obj):
                return None
        if isinstance(obj, (date, datetime)):
            return obj.isoformat()
        if isinstance(obj, set):
            return list(obj)
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)
${queryDbHelper}
${chartConfig ? `
# ── Chart utilities (brand-aware matplotlib/seaborn) ────────
# Injected when chartConfig is provided. Produces publication-quality
# charts with brand colors, currency formatting, and professional styling.
# Charts are collected in _CHARTS list and merged into the result.

_CHARTS = []  # Collector: list of { data: base64, title: str, width: int, height: int }

_CHART_CONFIG = ${JSON.stringify({
    primaryColor: chartConfig.primaryColor ?? "#3b82f6",
    secondaryColor: chartConfig.secondaryColor ?? "#10b981",
    accentColor: chartConfig.accentColor ?? "#f59e0b",
    currencySymbol: chartConfig.currencySymbol ?? "KES",
    currencyPosition: chartConfig.currencyPosition ?? "prefix",
    companyName: chartConfig.companyName ?? "Business IQ",
    chartStyle: chartConfig.chartStyle ?? "modern",
    fontFamily: chartConfig.fontFamily ?? "Inter",
    dpi: chartConfig.dpi ?? 150,
})}

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mticker
    try:
        import seaborn as sns
        sns.set_theme(style="whitegrid")
    except ImportError:
        sns = None

    def apply_brand_style():
        """Apply brand-aware styling to matplotlib. Call once before creating charts."""
        style_map = {
            'minimal': 'seaborn-v0_8-whitegrid',
            'classic': 'classic',
            'modern': 'seaborn-v0_8-darkgrid',
        }
        try:
            plt.style.use(style_map.get(_CHART_CONFIG['chartStyle'], 'seaborn-v0_8-darkgrid'))
        except Exception:
            plt.style.use('seaborn-v0_8-whitegrid')
        
        plt.rcParams.update({
            'figure.facecolor': '#ffffff',
            'axes.facecolor': '#ffffff',
            'text.color': '#1f2937',
            'axes.labelcolor': '#1f2937',
            'xtick.color': '#374151',
            'ytick.color': '#374151',
            'axes.titlesize': 14,
            'axes.titleweight': 'bold',
            'axes.labelsize': 11,
            'figure.titlesize': 16,
            'figure.titleweight': 'bold',
            'axes.spines.top': False,
            'axes.spines.right': False,
        })
        try:
            plt.rcParams['font.family'] = _CHART_CONFIG.get('fontFamily', 'sans-serif')
        except Exception:
            plt.rcParams['font.family'] = 'sans-serif'
        
        if sns:
            palette = get_brand_palette(6)
            sns.set_palette(palette)
    
    def get_brand_palette(n=6):
        """Return n brand colors starting from primary/secondary/accent."""
        base = [
            _CHART_CONFIG['primaryColor'],
            _CHART_CONFIG['secondaryColor'],
            _CHART_CONFIG['accentColor'],
        ]
        extras = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4',
                  '#84cc16', '#f43f5e', '#0ea5e9', '#a855f7']
        palette = base + [c for c in extras if c not in base]
        return palette[:max(n, 3)]

    def format_currency(value):
        """Format a number as currency (e.g. KES 1.2M, KES 45.3K)."""
        sym = _CHART_CONFIG['currencySymbol']
        pos = _CHART_CONFIG['currencyPosition']
        if abs(value) >= 1_000_000:
            formatted = f"{value/1_000_000:,.1f}M"
        elif abs(value) >= 1_000:
            formatted = f"{value/1_000:,.1f}K"
        else:
            formatted = f"{value:,.0f}"
        return f"{formatted} {sym}" if pos == 'suffix' else f"{sym} {formatted}"

    def currency_formatter():
        """Return a matplotlib FuncFormatter for currency axis labels."""
        return mticker.FuncFormatter(lambda x, pos: format_currency(x))

    def save_chart(fig, title="Chart", width=800, height=400):
        """Convert a matplotlib figure to base64 PNG and append to _CHARTS.
        
        Args:
            fig: matplotlib Figure object
            title: Chart title (displayed in UI)
            width: Display width in pixels
            height: Display height in pixels
        
        Always call this instead of plt.show() or plt.savefig().
        """
        import io as _io
        import base64 as _b64
        
        dpi = _CHART_CONFIG.get('dpi', 150)
        buf = _io.BytesIO()
        fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight',
                    facecolor=fig.get_facecolor(), edgecolor='none')
        buf.seek(0)
        b64 = _b64.b64encode(buf.read()).decode('utf-8')
        buf.close()
        plt.close(fig)
        
        _CHARTS.append({
            'data': b64,
            'title': title,
            'width': width,
            'height': height,
        })

    # Apply brand style immediately so all charts inherit it
    apply_brand_style()

except ImportError:
    # matplotlib not available — chart helpers become no-ops
    def apply_brand_style(): pass
    def get_brand_palette(n=6): return ['#3b82f6'] * n
    def format_currency(value): return f"{_CHART_CONFIG['currencySymbol']} {value:,.0f}"
    def currency_formatter(): return None
    def save_chart(fig, title="Chart", width=800, height=400): pass
` : ''}
# ── Read DATA from data.json file ──────────────────────────
with open('data.json', 'r') as __f:
    DATA = json.load(__f)

# Create a pandas DataFrame from DATA for convenient analysis
if pd is not None and isinstance(DATA, list) and len(DATA) > 0:
    DF = pd.DataFrame(DATA)
    # Auto-convert date-like columns
    for col in DF.columns:
        if any(kw in col.lower() for kw in ['date', 'time', 'created', 'updated', 'at']):
            try:
                DF[col] = pd.to_datetime(DF[col], errors='coerce')
            except Exception:
                pass
else:
    DF = None

# ── Analysis code (LLM-generated) ──────────────────────────
try:
    def __run_analysis():
${analysisCode.split("\n").map((line) => `        ${line}`).join("\n")}

    __result = __run_analysis()
    if __result is not None:
        # Merge any charts generated via save_chart() into the result
        if isinstance(__result, dict) and '_CHARTS' in dir() and _CHARTS:
            __result['_charts'] = _CHARTS
        print(json.dumps(__result, cls=AnalysisEncoder))
except Exception as e:
    import traceback
    print(f"Analysis error: {e}", file=sys.stderr)
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
`;
}

/** Build the appropriate wrapper script for the given runtime. */
function buildScript(
  runtime: SandboxRuntime,
  code: string,
  directDbAccess = false,
  chartConfig?: SandboxInput["chartConfig"]
): string {
  if (runtime === "python" || runtime === "python:3.13" || runtime === "python:3.14") {
    return buildPythonScript(code, directDbAccess, chartConfig);
  }
  if (runtime === "node" || runtime === "node:latest" || runtime === "node:lts") {
    return buildNodeScript(code);
  }
  return buildBunScript(code);
}

/** Get the execution command array for the sandbox SDK exec format. */
function getExecArray(runtime: SandboxRuntime, scriptFile: string): string[] {
  if (runtime === "python" || runtime === "python:3.13" || runtime === "python:3.14") {
    return ["python3", scriptFile];
  }
  if (runtime === "node" || runtime === "node:latest" || runtime === "node:lts") {
    return ["node", scriptFile];
  }
  return ["bun", "run", scriptFile];
}

/** Get the script file extension for the given runtime. */
function getScriptExt(runtime: SandboxRuntime): string {
  if (runtime === "python" || runtime === "python:3.13" || runtime === "python:3.14") {
    return "py";
  }
  if (runtime === "node" || runtime === "node:latest" || runtime === "node:lts") {
    return "js";
  }
  return "ts";
}

// ────────────────────────────────────────────────────────────
// Output processing
// ────────────────────────────────────────────────────────────

/** Truncate stdout if it exceeds the size limit. */
function truncateOutput(
  stdout: string,
  maxBytes: number
): { output: string; truncated: boolean } {
  const byteLength = new TextEncoder().encode(stdout).length;
  if (byteLength <= maxBytes) {
    return { output: stdout, truncated: false };
  }
  const ratio = maxBytes / byteLength;
  const approxChars = Math.floor(stdout.length * ratio * 0.95);
  return {
    output: stdout.slice(0, approxChars) + "\n\n[OUTPUT TRUNCATED — output size exceeded limit]",
    truncated: true,
  };
}

// ────────────────────────────────────────────────────────────
// Data fetching (shared between execution modes)
// ────────────────────────────────────────────────────────────

interface FetchedData {
  data: unknown;
  dataRowCount: number;
  error?: SandboxResult;
}

async function fetchData(
  sqlQuery: string | undefined,
  directData: unknown | undefined,
  explanation: string
): Promise<FetchedData> {
  let data: unknown = directData ?? [];
  let dataRowCount = 0;

  if (sqlQuery?.trim()) {
    if (!isSafeSelect(sqlQuery)) {
      return {
        data: [],
        dataRowCount: 0,
        error: {
          success: false,
          error: "Only SELECT/WITH queries are allowed. Dangerous SQL keywords detected.",
          errorType: "sql",
          errorHint: "Rewrite the query as a SELECT or WITH statement. DML/DDL is not allowed.",
          explanation,
        },
      };
    }

    try {
      const result = await db.execute(sql.raw(sqlQuery));
      const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
      data = rows.slice(0, MAX_DATA_ROWS);
      dataRowCount = rows.length;
    } catch (err: any) {
      const { type, hint } = classifyError("", "", err.message);
      return {
        data: [],
        dataRowCount: 0,
        error: {
          success: false,
          error: `SQL query failed: ${err.message}`,
          errorType: type === "unknown" ? "sql" : type,
          errorHint: hint,
          explanation,
        },
      };
    }
  } else if (Array.isArray(directData)) {
    dataRowCount = directData.length;
  }

  return { data, dataRowCount };
}

// ────────────────────────────────────────────────────────────
// Main execution function
// ────────────────────────────────────────────────────────────

/**
 * Execute LLM-generated code in an isolated sandbox.
 *
 * Uses sandboxApi.run() (one-shot execution) which automatically
 * creates and destroys the sandbox. Supports bun:1, python, and node
 * runtimes. Includes error classification, output size limits, and
 * optional snapshot restore for faster cold starts.
 *
 * @param sandboxApi - The sandbox API from the agent context (`ctx.sandbox`)
 * @param input - The code, optional SQL, and configuration
 * @returns Structured result with parsed output, error classification, or retry hints
 */
export async function executeSandbox(
  sandboxApi: any,
  input: SandboxInput
): Promise<SandboxResult> {
  const {
    code,
    sqlQuery,
    explanation,
    data: directData,
    timeoutMs = 30_000,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    runtime = "bun:1",
    snapshotId: explicitSnapshotId,
    memory = "256Mi",
    directDbAccess = false,
    chartConfig,
  } = input;

  // Resolve snapshot: explicit caller value > env var default (Python only)
  const snapshotId = explicitSnapshotId
    ?? (isPythonRuntime(runtime) ? DEFAULT_PYTHON_SNAPSHOT_ID : undefined);

  // ── Step 1: Get data ────────────────────────────────────
  // When directDbAccess is true, the Python script calls query_db() itself.
  // We skip server-side SQL fetching entirely — no data.json for SQL queries.
  // Direct data (passed via `data` property) is still written to data.json.
  let data: unknown = directData ?? [];
  let dataRowCount = 0;

  if (!directDbAccess) {
    // Legacy path: fetch data server-side and pass via data.json
    const fetched = await fetchData(sqlQuery, directData, explanation);
    if (fetched.error) return fetched.error;
    data = fetched.data;
    dataRowCount = fetched.dataRowCount;
  } else if (Array.isArray(directData)) {
    dataRowCount = directData.length;
  }

  // ── Step 2: Build script and run in sandbox ─────────────
  const scriptExt = getScriptExt(runtime);
  const scriptFile = `analysis.${scriptExt}`;
  const script = buildScript(runtime, code, directDbAccess, chartConfig);
  const dataJson = JSON.stringify(data);

  try {
    // Add extra time for package installation when no snapshot
    const effectiveTimeout = (!snapshotId && isPythonRuntime(runtime))
      ? Math.max(timeoutMs, 60_000)  // At least 60s for uv install
      : timeoutMs;

    // Network is needed when:
    // - No snapshot and Python (uv pip install)
    // - Direct DB access (psycopg2 connects to Postgres)
    const needsNetwork = directDbAccess || (!snapshotId && isPythonRuntime(runtime));

    // Build run options for one-shot sandbox execution (SDK pattern)
    const runOpts: Record<string, any> = {
      command: {
        exec: getExecArray(runtime, scriptFile),
        files: [
          { path: scriptFile, content: Buffer.from(script) },
          { path: "data.json", content: Buffer.from(dataJson) },
        ],
      },
      resources: {
        memory: normalizeMemory(memory),
        cpu: "500m",
      },
      timeout: { execution: msToDuration(effectiveTimeout) },
      network: { enabled: needsNetwork },
    };

    // Inject DATABASE_URL for direct DB access from within the sandbox
    if (directDbAccess && process.env.DATABASE_URL) {
      runOpts.env = {
        DATABASE_URL: process.env.DATABASE_URL,
      };
    }

    // SDK contract: runtime and snapshot are MUTUALLY EXCLUSIVE.
    // When using a snapshot, the snapshot's runtime is used automatically.
    // Sending both causes "error validating the API input data".
    if (snapshotId) {
      runOpts.snapshot = snapshotId;
      // Do NOT set runtime — snapshot determines it automatically
    } else {
      runOpts.runtime = normalizeRuntime(runtime);
    }

    // One-shot execution: creates sandbox, runs command, destroys sandbox
    const result = await sandboxApi.run(runOpts);

    let stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    const exitCode = result.exitCode ?? 0;

    // ── Step 3: Process output ──────────────────────────────
    const { output: processedStdout, truncated } = truncateOutput(stdout, maxOutputBytes);
    stdout = processedStdout;

    if (truncated) {
      return {
        success: false,
        stdout,
        stderr,
        exitCode,
        dataRowCount,
        error: "Output size exceeded limit. Aggregate or summarize results instead of returning raw data.",
        errorType: "output",
        errorHint: "The output is too large. Return aggregated summaries instead of full datasets.",
        outputTruncated: true,
        explanation,
        runtime,
      };
    }

    if (exitCode !== 0) {
      const { type, hint } = classifyError(stderr, stdout);
      return {
        success: false,
        stdout,
        stderr,
        exitCode,
        dataRowCount,
        error: `Sandbox exited with code ${exitCode}: ${stderr || stdout}`,
        errorType: type,
        errorHint: hint,
        explanation,
        runtime,
      };
    }

    // Parse the last line of stdout as JSON
    let parsed: unknown;
    try {
      const lines = stdout.split("\n");
      const lastLine = lines[lines.length - 1];
      parsed = JSON.parse(lastLine);
    } catch {
      parsed = stdout;
    }

    // Extract _charts from parsed result (injected by save_chart() in Python)
    let charts: SandboxResult["charts"];
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj._charts) && obj._charts.length > 0) {
        charts = obj._charts as SandboxResult["charts"];
        // Remove _charts from the result so callers get clean data
        delete obj._charts;
      }
    }

    return {
      success: true,
      result: parsed,
      stdout,
      stderr: stderr || undefined,
      exitCode,
      dataRowCount,
      explanation,
      runtime,
      charts,
    };
  } catch (err: any) {
    const errMsg = err.message || String(err);
    const { type, hint } = classifyError("", "", errMsg);
    return {
      success: false,
      error: `Sandbox execution failed: ${errMsg}`,
      errorType: type,
      errorHint: hint,
      explanation,
      runtime,
    };
  }
  // No finally/destroy needed — sandbox.run() auto-cleans up
}

// ────────────────────────────────────────────────────────────
// Retry-with-correction wrapper
// ────────────────────────────────────────────────────────────

/**
 * Execute sandbox code with automatic retry on failure.
 * When execution fails, calls the `correctCode` function with the
 * error details so the LLM can fix the code and retry.
 *
 * @param sandboxApi - The sandbox API from the agent context
 * @param input - The initial code and configuration
 * @param retryOptions - Retry configuration with correction function
 * @returns The final result (success or last failure after retries exhausted)
 */
export async function executeSandboxWithRetry(
  sandboxApi: any,
  input: SandboxInput,
  retryOptions: RetryOptions
): Promise<SandboxResult & { attempts: number }> {
  const { maxRetries = 2, correctCode } = retryOptions;

  let currentInput = { ...input };
  let lastResult: SandboxResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await executeSandbox(sandboxApi, currentInput);

    if (result.success) {
      return { ...result, attempts: attempt + 1 };
    }

    lastResult = result;

    // Don't retry on errors that can't be fixed by code correction
    if (
      result.errorType === "sql" ||
      result.errorType === "output" ||
      result.errorType === "resource"
    ) {
      return { ...result, attempts: attempt + 1 };
    }

    // If we have retries left and a correction function, try to fix
    if (attempt < maxRetries && correctCode) {
      const correctedCode = await correctCode(result, attempt + 1);
      if (!correctedCode) {
        return { ...result, attempts: attempt + 1 };
      }
      currentInput = { ...currentInput, code: correctedCode };
    }
  }

  return { ...lastResult!, attempts: maxRetries + 1 };
}

// ────────────────────────────────────────────────────────────
// Interactive Sandbox Sessions
// ────────────────────────────────────────────────────────────

/**
 * Create a persistent interactive sandbox session.
 *
 * Sessions allow multiple commands to be executed in the same sandbox,
 * which is more efficient for multi-step analyses (load data once,
 * run multiple computations).
 *
 * The caller is responsible for calling `session.destroy()` when done.
 */
export async function createSandboxSession(
  sandboxApi: any,
  options: {
    runtime?: SandboxRuntime;
    snapshotId?: string;
    memory?: string;
    idleTimeoutMs?: number;
    executionTimeoutMs?: number;
  } = {}
): Promise<SandboxSession> {
  const {
    runtime = "bun:1",
    snapshotId,
    memory = "256Mi",
    idleTimeoutMs = 300_000,
    executionTimeoutMs = 60_000,
  } = options;

  const createOpts: Record<string, any> = {
    runtime: normalizeRuntime(runtime),
    resources: { memory: normalizeMemory(memory), cpu: "500m", disk: "1Gi" },
    network: { enabled: false },
    timeout: { idle: msToDuration(idleTimeoutMs), execution: msToDuration(executionTimeoutMs) },
  };

  if (snapshotId) createOpts.snapshot = snapshotId;

  const sandbox = await sandboxApi.create(createOpts);
  let isDestroyed = false;

  return {
    get runtime() { return runtime; },
    get destroyed() { return isDestroyed; },

    async exec(command: string) {
      if (isDestroyed) throw new Error("Sandbox session has been destroyed");
      const execution = await sandbox.execute({ command: ["bash", "-c", command] });

      // execute() returns stream URLs — fetch content as text
      let stdout = "";
      let stderr = "";
      if (execution.stdoutStreamUrl) {
        try {
          const res = await fetch(execution.stdoutStreamUrl);
          stdout = await res.text();
        } catch { /* ignore stream fetch errors */ }
      }
      if (execution.stderrStreamUrl) {
        try {
          const res = await fetch(execution.stderrStreamUrl);
          stderr = await res.text();
        } catch { /* ignore stream fetch errors */ }
      }

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: execution.exitCode ?? 0,
      };
    },

    async writeFile(path: string, content: string) {
      if (isDestroyed) throw new Error("Sandbox session has been destroyed");
      await sandbox.writeFiles([{ path, content: Buffer.from(content) }]);
    },

    async snapshot() {
      if (isDestroyed) throw new Error("Sandbox session has been destroyed");
      const sandboxId = sandbox.sandboxId ?? sandbox.id;
      const snap = await sandboxApi.snapshot.create(sandboxId, {
        name: `session-${Date.now()}`,
        tag: "latest",
      });
      return { id: snap.snapshotId };
    },

    async destroy() {
      if (isDestroyed) return;
      isDestroyed = true;
      try { await sandbox.destroy(); } catch { /* ignore */ }
    },
  };
}

// ────────────────────────────────────────────────────────────
// Snapshot helpers
// ────────────────────────────────────────────────────────────

/** Default dependencies for the JavaScript analysis snapshot. */
export const JS_ANALYSIS_DEPENDENCIES = [
  "simple-statistics",
  "date-fns",
  "lodash",
];

/** Default dependencies for the Python analysis snapshot. */
export const PYTHON_ANALYSIS_DEPENDENCIES = [
  "numpy",
  "pandas",
  "scipy",
  "scikit-learn",
  "statsmodels",
];

/**
 * Create a base analysis snapshot with pre-installed dependencies.
 * Run once (e.g., during setup or via admin action) and store the
 * returned snapshot ID in agent_configs for reuse.
 *
 * For Python (default): installs numpy, pandas, scipy, scikit-learn, statsmodels.
 * For Bun/Node: installs simple-statistics, date-fns, lodash.
 */
export async function createAnalysisSnapshot(
  sandboxApi: any,
  runtime: SandboxRuntime = "python:3.13",
  extraDeps: string[] = []
): Promise<{ snapshotId: string }> {
  const isPython = runtime === "python" || runtime === "python:3.13" || runtime === "python:3.14";
  const baseDeps = isPython ? PYTHON_ANALYSIS_DEPENDENCIES : JS_ANALYSIS_DEPENDENCIES;
  const deps = [...baseDeps, ...extraDeps];
  const resolved = normalizeRuntime(runtime);

  const sandbox = await sandboxApi.create({
    runtime: resolved,
    resources: { memory: "512Mi", cpu: "1000m", disk: "1Gi" },
    network: { enabled: true }, // Need network to install packages
    timeout: { idle: "5m", execution: "5m" },
  });

  try {
    // Install packages using the appropriate package manager
    if (resolved.startsWith("python")) {
      // Try pip3 first (universally available), fall back to pip
      try {
        await sandbox.execute({ command: ["pip3", "install", ...deps] });
      } catch {
        await sandbox.execute({ command: ["pip", "install", ...deps] });
      }
    } else if (resolved.startsWith("node")) {
      await sandbox.execute({ command: ["npm", "install", ...deps] });
    } else {
      await sandbox.execute({ command: ["bun", "add", ...deps] });
    }

    // Save snapshot via the sandbox snapshot management API
    const sandboxId = sandbox.sandboxId ?? sandbox.id;
    const snapshot = await sandboxApi.snapshot.create(sandboxId, {
      name: `analysis-${resolved.replace(":", "-")}`,
      description: `Pre-installed analysis dependencies: ${deps.join(", ")}`,
      tag: "latest",
    });

    return { snapshotId: snapshot.snapshotId };
  } finally {
    try { await sandbox.destroy(); } catch { /* ignore */ }
  }
}
