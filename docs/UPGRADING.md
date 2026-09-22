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

## If a slash command's options changed

Command *definitions* (name, description, options) aren't part of the database — after pulling a version that added/changed a slash command, re-run:

```bash
npm run deploy-commands
```

(Docker: `docker compose exec bot npm run deploy-commands`.) This isn't needed for most upgrades — only when a command's options changed, which the release notes will call out.
