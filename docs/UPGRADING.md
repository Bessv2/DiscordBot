# Upgrading

Migrations run automatically and are forward-only. Back up first anyway (see [BACKUP.md](./BACKUP.md)) — it takes ten seconds and means an upgrade never has to be a leap of faith.

## Docker (recommended path)

```bash
./scripts/backup-db.sh
git pull
docker compose up -d --build
```

On boot, `docker-entrypoint.sh` runs `prisma migrate deploy` before starting the bot — pending schema changes are applied automatically, and it's a no-op if there's nothing new. Watch the logs on first boot after an upgrade:

```bash
docker compose logs -f
```

## Bare Node

```bash
./scripts/backup-db.sh
git pull
npm ci
npm run db:migrate
npm run build
npm run start   # or: pm2 restart discord-mod-bot
```

## Slash commands

Nothing to do. On startup the bot compares its command definitions against what it last registered (a hash stored in `data/.commands-hash`) and re-registers with Discord only when something changed. To force a re-register anyway, delete that file and restart, or run `npm run deploy-commands` (from a source checkout: `npm run deploy-commands:dev`).
