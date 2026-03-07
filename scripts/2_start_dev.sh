#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Starting transact-qda development..."

# Start PostgreSQL
echo "  Starting PostgreSQL..."
docker compose up -d

# Wait for PostgreSQL to be ready
echo "  Waiting for database..."
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U tqda -d transact_qda > /dev/null 2>&1; then
    echo "  Database ready."
    break
  fi
  sleep 1
done

# Run migrations
echo "  Running migrations..."
DATABASE_URL=postgresql://tqda:tqda_dev@localhost:5432/transact_qda node scripts/migrate.js

# Kill any process on port 5174
if lsof -ti:5174 -sTCP:LISTEN > /dev/null 2>&1; then
  echo "  Port 5174 in use, killing..."
  lsof -ti:5174 -sTCP:LISTEN | xargs -r kill -9
  sleep 1
fi

# Start dev server (foreground so user sees output)
echo "  Starting SvelteKit dev server..."
npm run dev
