#!/bin/sh
# Applies any pending database migrations before the bot starts, so
# upgrading is always "pull image, restart container" — never a manual
# migration step. Safe to run on every boot: a no-op when nothing changed.
set -e

echo "[entrypoint] applying database migrations..."
npx prisma migrate deploy

# Music only: YouTube changes often and old yt-dlp versions stop working,
# so refresh it on each start. This is the only update check the bot ever
# makes, it only runs for hosts who turned music on, and MUSIC_AUTO_UPDATE=false
# switches it off. A failure (offline, GitHub down) never stops the bot.
if [ "$ENABLE_MUSIC" = "true" ] && [ "${MUSIC_AUTO_UPDATE:-true}" != "false" ] && command -v yt-dlp >/dev/null 2>&1; then
  echo "[entrypoint] updating yt-dlp (music)..."
  timeout 60 yt-dlp -U || echo "[entrypoint] yt-dlp update skipped; using the version already installed"
fi

echo "[entrypoint] starting bot..."
exec "$@"
