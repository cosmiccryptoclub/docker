#!/bin/bash
set -e

# Optionally seed the DB with realistic dummy trades if it is empty.
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "🌱 SEED_ON_START=true -> seeding dummy data if DB is empty..."
  python -m src.seed --if-empty || echo "⚠️  Seed step failed (continuing)."
fi

echo "✅ Starting Trade Journal web server..."
if [ "${UVICORN_RELOAD:-false}" = "true" ]; then
  exec uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
else
  exec uvicorn src.main:app --host 0.0.0.0 --port 8000
fi
