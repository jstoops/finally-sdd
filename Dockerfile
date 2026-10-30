# syntax=docker/dockerfile:1
# FinAlly: one image, one container, one port (PLAN section 11).
# Stage 1 builds the Next.js static export; stage 2 runs FastAPI and serves it.

# --- Stage 1: frontend static export -------------------------------------------
FROM node:22-slim AS frontend
WORKDIR /frontend
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies first so source edits reuse the cached npm layer.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# output: 'export' writes the site to /frontend/out (index.html, 404.html, _next/)
RUN npm run build

# --- Stage 2: Python runtime ----------------------------------------------------
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /bin/

# LITELLM_LOCAL_MODEL_COST_MAP stops litellm fetching its model cost map from GitHub at import.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    DB_PATH=/app/db/finally.db \
    LITELLM_LOCAL_MODEL_COST_MAP=True \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Third-party dependencies only, from the lockfile, before the source copy so code
# edits reuse this layer. No --extra dev: test and lint tools stay out of the image.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project

COPY backend/ ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked

# app/config.py resolves DEFAULT_STATIC_DIR to /app/static when STATIC_DIR is unset.
COPY --from=frontend /frontend/out ./static

# Mount point for the finally-data volume (docker-compose.yml).
RUN mkdir -p /app/db

EXPOSE 8000

# Exactly one worker: PriceCache is process-local, so SSE and REST must share a process.
# Never --reload here; DEV_CORS_ORIGIN and STATIC_DIR are never set in the image.
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-graceful-shutdown", "5"]
