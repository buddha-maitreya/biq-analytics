FROM python:3.12-slim AS builder

# Build tools needed for Prophet/CmdStan (C++ compilation) and other native deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-install CmdStan during build (so it doesn't try to download at runtime)
# This bakes the compiled binary into the image — no internet needed at runtime
RUN python -c "import cmdstanpy; cmdstanpy.install_cmdstan()"

# ── Runtime stage ──
FROM python:3.12-slim

# Runtime libs needed by matplotlib, scipy, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed packages + CmdStan from builder
COPY --from=builder /usr/local /usr/local
COPY --from=builder /root/.cmdstan /home/appuser/.cmdstan

COPY src/ ./src/

# Non-root user for security
RUN useradd -m -s /bin/bash appuser \
    && chown -R appuser:appuser /app /home/appuser/.cmdstan
USER appuser

# Tell cmdstanpy where CmdStan lives for the non-root user
ENV CMDSTAN=/home/appuser/.cmdstan

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

# Use Railway's dynamic $PORT (falls back to 8000 for local dev)
CMD ["sh", "-c", "python -m uvicorn src.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
