# --- Stage 1: Build the frontend (Vite + React + Tailwind) ---
FROM node:20-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# --- Stage 2: Backend image (FastAPI + SQLite) ---
FROM python:3.12-slim

WORKDIR /app

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Backend code
COPY src/ ./src/

# Built frontend -> served as static by FastAPI
COPY --from=build-frontend /app/frontend/dist /app/static

# Persisted data (SQLite DB + uploaded screenshots) lives here
RUN mkdir -p /app/data /app/data/uploads

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
ENV PYTHONIOENCODING=utf-8
# The whole app stores naive-UTC datetimes and calls .timestamp() on them —
# correct only when the process TZ is UTC. Pin it so that can never drift.
ENV TZ=UTC

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 8000
CMD ["./entrypoint.sh"]
