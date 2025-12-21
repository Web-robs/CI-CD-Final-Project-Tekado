#!/bin/sh
set -e

cd /app

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "Running Prisma migrations (prisma migrate deploy)..."
  /app/node_modules/.bin/prisma migrate deploy
fi

exec "$@"
