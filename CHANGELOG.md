# Changelog

Ready-made images are tagged with each version (`BOT_IMAGE_TAG=1.0.0`, or `1.0.0-music`) as well as `latest` / `music`. How to update, or stay on a version: README → [Updating to a new version](./README.md#updating-to-a-new-version). Database changes run by themselves and only add things; see [`docs/UPGRADING.md`](./docs/UPGRADING.md) for anything a host needs to do.

## 1.0.0 (2026-11-02)

The first numbered release: everything below, on top of the moderation, community and game features already in `main`.

**New**
- **Add-ons** (`/addons`, dashboard → Add-ons): post from RSS/Atom feeds, Steam game news, Epic free games, game-server up/down alerts, and incoming webhooks from other apps. The dashboard also shows which optional API keys are set.
- **Discord's own AutoMod**, per server: the invite, word and mention filters as Discord AutoMod rules the bot keeps in sync; they work without Message Content. Needs Manage Server.
- **Ban sharing** (`/bannetwork`) between servers you trust on the same bot: alerts with a "Ban here too" button, or automatic bans.
- **AI triage** (optional): flags likely-harmful messages for a moderator to review, using the host's own Anthropic API key. Never acts on its own.
- **Case export**: `/exportcases` and dashboard downloads, as CSV or JSON.
- **Dashboard Lists page** for auto-responses, tags, level rewards and scheduled announcements; every dashboard change is posted to the mod-log.
- **Backups** that work on every platform: one a day automatically (`BACKUP_KEEP`), and `npm run backup` any time.
- **Plugins** (optional): the host's own commands as `.js` files (`docs/PLUGINS.md`).

**Fixed**
- `latest` and `music` images are published from `main` even when the repository's default branch is something else.

**Security**
- Updated `undici` (via discord.js) and `zod` 4: `npm audit` reports no known vulnerabilities in the bot's runtime dependencies.

## Before 1.0.0

Built in pull requests #1, #3, #5 and #6; see [`PROJECT.md` §18](./PROJECT.md#18-history).
