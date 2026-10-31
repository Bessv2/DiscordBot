# Upgrading

Migrations run automatically and are forward-only. Back up first anyway (see [BACKUP.md](./BACKUP.md)) — it takes ten seconds and means an upgrade never has to be a leap of faith.

## Docker (recommended path)

The bot ships as a ready-made image (`ghcr.io/bessv2/discordbot`), so an upgrade is a download, not a rebuild:

```bash
./scripts/backup-db.sh
docker compose pull
docker compose up -d
```

Or let it happen by itself: set `COMPOSE_PROFILES=autoupdate` in `.env` and run `docker compose up -d` once. A small updater container ([Watchtower](https://github.com/nicholas-fedor/watchtower), pinned to one release) then checks daily at 04:00 and restarts the bot on a new image. It only touches the bot's container (it's label-scoped), and it's off unless you set that line.

If you build from source instead, the upgrade is `git pull` and then `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

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

## Upgrading from a version that built the image locally

Older versions of `docker-compose.yml` had `build: .`. Download the current `docker-compose.yml` (or `git pull`), add any new lines from `.env.example` that you want to your `.env`, and run `docker compose up -d`. Your `data/` folder carries over untouched.

## New bot permissions

When a release adds a feature that needs a new Discord permission, servers that invited the bot earlier don't get it automatically. Open the invite link from the bot's startup log again and authorize it: Discord adds the missing permissions to the bot's role, and nothing else changes. The latest example is **Create Invite** (`/jam`), **Create Polls** (`/map vote`), and **Connect** and **Speak** (`/music`).

## Node version (bare Node)

Running without Docker now needs Node.js 22.12 or newer (Node 20 reached end-of-life, and the optional music module needs 22.12+).

## Slash commands

Nothing to do. On startup the bot compares its command definitions against what it last registered (a hash stored in `data/.commands-hash`) and re-registers with Discord only when something changed. To force a re-register anyway, delete that file and restart, or run `npm run deploy-commands` (from a source checkout: `npm run deploy-commands:dev`).
