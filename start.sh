#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

if [ ! -d "$ROOT/backend/node_modules" ]; then
  (cd "$ROOT/backend" && npm install)
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  (cd "$ROOT/frontend" && npm install)
fi

node "$ROOT/backend/src/index.js" &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

API_PORT="${PORT:-3001}"
READY=0
for _ in $(seq 1 30); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "The server stopped. Check that PostgreSQL is running and DATABASE_URL is correct." >&2
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:${API_PORT}/api/v1/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "The server did not become healthy in time. Check that PostgreSQL is running." >&2
  exit 1
fi

cd "$ROOT/frontend"
npm run dev
