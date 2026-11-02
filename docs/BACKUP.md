# Backing up your data

Everything the bot knows — settings, case history, reminders, polls — lives in one SQLite file at `./data/bot.db` (or wherever `DATABASE_URL` in your `.env` points).

## Automatic daily backups

The bot makes one backup a day by itself, while it runs, into `data/backups/` (next to `bot.db`), and keeps the newest 7. Change how many with `BACKUP_KEEP` in `.env`, or set it to `0` to turn this off. Copies are made with SQLite's `VACUUM INTO`, which gives a consistent snapshot even while the bot is writing.

## Backup on demand (any computer, including Windows)

```bash
docker compose exec bot npm run backup     # with Docker
npm run backup                              # without Docker
```

It prints where it saved the copy (`data/backups/bot-YYYYMMDD-HHMMSS.db`).

Keep a copy somewhere other than the bot's computer too (another disk, cloud storage): a backup on the same disk doesn't help if that disk dies.

## One-command backup (Mac/Linux script)

```bash
./scripts/backup-db.sh
```

This writes a timestamped copy to `./backups/`. It uses SQLite's own `.backup` command when the `sqlite3` CLI is available, which is safe to run while the bot is running. Add it to `cron` for automatic backups, e.g. nightly at 3am:

```cron
0 3 * * * cd /path/to/discord-mod-bot && ./scripts/backup-db.sh
```

## Restoring

Stop the bot, replace `./data/bot.db` with the backup file, then start the bot again:

```bash
docker compose down
cp ./backups/bot-20260101-030000.db ./data/bot.db
docker compose up -d
```

## If you're running Postgres instead

Use your normal Postgres backup tooling (`pg_dump` / `pg_restore`, or your host's managed-backup feature) — the SQLite-specific script above doesn't apply.
