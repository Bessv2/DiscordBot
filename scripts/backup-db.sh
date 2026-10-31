#!/bin/sh
# Backs up the SQLite database to ./backups/bot-<timestamp>.db using
# SQLite's own online backup (`.backup`), which is safe to run while the
# bot is up — it won't corrupt or lock out an in-progress write the way a
# plain `cp` of the file can.
#
# Usage: ./scripts/backup-db.sh [path-to-db] [backup-dir]
set -e

DB_PATH="${1:-./data/bot.db}"
BACKUP_DIR="${2:-./backups}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

if [ ! -f "$DB_PATH" ]; then
  echo "No database found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
DEST="$BACKUP_DIR/bot-$TIMESTAMP.db"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DEST'"
else
  echo "sqlite3 CLI not found, falling back to a plain file copy (bot should be stopped first)." >&2
  cp "$DB_PATH" "$DEST"
fi

echo "Backed up $DB_PATH -> $DEST"
