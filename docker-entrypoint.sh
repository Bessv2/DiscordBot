#!/bin/sh
# Applies any pending database migrations before the bot starts, so
# upgrading is always "pull image, restart container" — never a manual
# migration step. Safe to run on every boot: a no-op when nothing changed.
set -e

echo "[entrypoint] applying database migrations..."
npx prisma migrate deploy

echo "[entrypoint] starting bot..."
exec "$@"
