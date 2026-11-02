# Upgrading

Migrations run automatically and are forward-only. Back up first anyway (see [BACKUP.md](./BACKUP.md)) — it takes ten seconds and means an upgrade never has to be a leap of faith.

## Docker (recommended path)

The bot ships as a ready-made image (`ghcr.io/bessv2/discordbot`), so an upgrade is a download, not a rebuild:

```bash
docker compose exec bot npm run backup
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

When a release adds a feature that needs a new Discord permission, servers that invited the bot earlier don't get it automatically. Open the invite link from the bot's startup log again and authorize it: Discord adds the missing permissions to the bot's role, and nothing else changes. Recent examples: **Create Invite** (`/jam`), **Create Polls** (`/map vote`), **Connect** and **Speak** (`/music`), and in the latest release **Create Private Threads**, **Send Messages in Threads**, **Manage Threads** and **Attach Files** (tickets) and **Move Members** (join-to-create voice).

## 1.0.0: add-ons, Discord AutoMod, ban sharing, AI triage, plugins

- **Database:** three new migrations (`add_addons`, `add_native_automod`, `add_ban_networks_ai_triage`) that only add tables and columns. They run by themselves on start; upgrading a database with data in it was tested.
- **Permissions:** nothing new is required. A server that turns on "Use Discord's AutoMod" must give the bot's role **Manage Server** (Discord's rule for managing AutoMod); `/setup` says so if it's missing.
- **New, all optional `.env` lines** (copy the ones you want from `.env.example`): `BACKUP_KEEP` (daily backups, on by default with 7 kept), `ADDONS_ALLOW_PRIVATE_NETWORK`, `AI_TRIAGE_API_KEY` / `AI_TRIAGE_MODEL` / `AI_TRIAGE_MAX_PER_MINUTE`, `ENABLE_PLUGINS` / `PLUGINS_DIR`.
- **`docker-compose.yml`** gained a read-only `./plugins` mount. Only needed if you'll use plugins; download the new file (or `git pull`) to get it.
- **Daily backups** start automatically and use a little disk in `data/backups/` (7 copies of the database). Set `BACKUP_KEEP=0` to turn them off.

## Optional web dashboard

Nothing changes unless you want it. To use the new web dashboard, add the `ENABLE_DASHBOARD` and `DASHBOARD_PORT` lines from `.env.example` to your `.env`, download the current `docker-compose.yml` (it publishes the dashboard's port on 127.0.0.1 only), and run `docker compose up -d`. Admins sign in with `/dashboard`. See README → "Web dashboard". No database change is involved.

## Node version (bare Node)

Running without Docker now needs Node.js 22.12 or newer (Node 20 reached end-of-life, and the optional music module needs 22.12+).

## Slash commands

Nothing to do. On startup the bot compares its command definitions against what it last registered (a hash stored in `data/.commands-hash`) and re-registers with Discord only when something changed. To force a re-register anyway, delete that file and restart, or run `npm run deploy-commands` (from a source checkout: `npm run deploy-commands:dev`).
