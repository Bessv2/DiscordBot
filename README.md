# Discord Moderation Bot

A self-hostable Discord moderation and utility bot. No third-party dashboard, no subscription, no cloud account holding your server's data — you run it, you own the database. See [`CLAUDE.md`](./CLAUDE.md) for the full project guidelines this bot is built against.

## Quickstart

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications) → **Bot** tab → copy the token, and note the **Application ID** from the **General Information** tab.
2. (Optional) If you want the invite-link filter, word filter, or mention-spam detection, enable **Message Content Intent** on the same Bot tab under *Privileged Gateway Intents*.
3. Invite the bot to your server using the OAuth2 URL Generator: scopes `bot` + `applications.commands`; permissions at minimum `Kick Members`, `Ban Members`, `Moderate Members`, `Manage Messages`, `View Channels`, `Send Messages`, `Embed Links`.
4. Clone this repo and `cd` into it.
5. `cp .env.example .env` and fill in `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`.
6. `docker compose up -d`
7. `docker compose exec bot npm run deploy-commands` (registers the slash commands with Discord — only needed once, and again after an upgrade that changes a command's options).
8. In your server, run `/setup` and follow the prompts.

That's it — every other setting (mod-log channel, auto-mod thresholds, permission roles) is configured inside Discord via `/setup` and `/config`, not by editing files.

### Running without Docker

```bash
npm ci
npm run build
npm run db:migrate
npm run deploy-commands
npm run start
```

Use [pm2](https://pm2.keymetrics.io/) (`pm2 start dist/index.js --name discord-mod-bot`) to keep it running and restart on crash.

## Resource baseline

Idle footprint on a single small guild is roughly **60-100MB RAM** and negligible CPU — comfortable on a $5/month VPS or a Raspberry Pi. No Redis, no message queue, and no separate database server required at this scale (SQLite is the default).

## Features (v1)

- Warn / kick / ban / timeout, each logged to a per-guild, sequentially numbered case history (`/cases`)
- Auto-mod: message-flood detection, invite-link filtering, word/phrase filter, mention-spam limits
- Rich embed mod-log, posted to a channel you choose
- Role-based permission gates per command scope — on top of, or instead of, Discord's own permission model
- Slash commands first; legacy `!prefix` commands available as an opt-in
- Utility: `/userinfo`, `/serverinfo`, `/remind`, `/poll`
- Guided `/setup` wizard + `/config` for everything else

See [`CLAUDE.md`](./CLAUDE.md) for the full roadmap (anti-raid, leveling, starboard, game integrations, AI-assisted triage, and more — all designed as opt-in modules a pure-moderation host never pays the cost of).

## Privileged intents — what's required vs. optional

| Intent | Required for | Notes |
| --- | --- | --- |
| Guilds | Everything | Always on, not privileged |
| Guild Messages | Flood-based spam detection, prefix commands | Always on, not privileged |
| **Message Content** (privileged) | Invite-link filter, word filter, mention-spam detection, legacy prefix commands | **Opt-in** via `ENABLE_MESSAGE_CONTENT=true` in `.env`. Everything else — every slash command, warn/kick/ban/timeout, flood detection — works with this off. |

The bot checks this at startup and logs a clear warning if a guild has turned on a feature that needs an intent you haven't enabled, instead of silently doing nothing.

## Configuration

All secrets live in `.env` (see [`.env.example`](./.env.example) — every variable is documented there, and nothing required is left out of that file). Everything else — mod-log channel, auto-mod thresholds, permission roles, word filter list — is configured in Discord via `/setup` and `/config`, and lives in the SQLite database, not in a file you edit by hand.

### Swapping to Postgres

SQLite is the zero-setup default. To scale up:

1. Set `DATABASE_URL` in `.env` to a `postgresql://...` connection string.
2. Change the `provider` in `prisma/schema.prisma`'s `datasource` block from `sqlite` to `postgresql`.
3. Run `npm run db:migrate` against the new database.

## Backups & upgrades

- [`docs/BACKUP.md`](./docs/BACKUP.md) — one command to back up the database.
- [`docs/UPGRADING.md`](./docs/UPGRADING.md) — pulling a new version and running migrations without losing data.

## Health checks & troubleshooting

On boot the bot validates the database is reachable/writable and that the token is valid before it tries to connect to Discord's gateway, and fails with a specific fix instead of a raw stack trace. Check `docker compose logs -f` first if something isn't working.

## Security & privacy

- No telemetry, analytics, or phone-home update checks — none exist in this codebase.
- Message content is only stored (truncated, attached to auto-mod hits in the mod-log) if you explicitly enable `/config wordfilter` logging behavior — see [`CLAUDE.md` §7](./CLAUDE.md#7-security--privacy-guidelines).
- Every moderation action is logged with actor, target, reason, and timestamp for your own accountability record — that data never leaves your database.

## Development

```bash
npm ci
npm run dev            # tsx watch — restarts on file change
npm run lint
npm run typecheck
npm test
```

Set `DISCORD_GUILD_ID` in `.env` while developing so `npm run deploy-commands` registers commands instantly in one server instead of waiting up to an hour for a global rollout.
