# Discord Moderation Bot — Project Notes

Started 2026-09-22 · @Someone · Last updated 2026-11-02

The single source of truth for this project: why it exists, the rules it's built by, what's been built, how it fits together, and every decision made along the way. The README is for people **running** the bot; this file is for people **building or maintaining** it, including AI assistants (see §4).

**Contents:** 1 Mission · 2 Principles · 3 Tech stack · 4 AI assistant prompt · 5 Roadmap · 6 Self-hosting requirements · 7 Security & privacy · 8 Coding standards · 9 Current status · 10 Architecture · 11 Commands · 12 Configuration · 13 Deployment & updates · 14 Data model · 15 Testing · 16 Decision log · 17 Known gaps · 18 History

---

## 1. Mission & Vision

This bot exists to give any Discord community — not just ones with a DevOps-savvy admin — a moderation and utility bot they fully own. No third-party dashboard holding their data, no surprise pricing tier, no bot going offline because a hosting company shut down. **Self-hosting isn't a deployment option bolted on at the end — it's the design center.** Every architectural decision gets weighed against: does this stay easy for one person to run on a Pi, a VPS, or a homelab box?

Forward-thinking here means building for where Discord bots are headed — modular permission systems, audit-log-grade logging, slash-command-first UX, and hooks for AI-assisted moderation (auto-triage, sentiment flags, smart escalation) — without ever making self-hosting harder to get to. The bot should feel like a small, well-run SaaS product, except the "cloud" is the host's own machine.

## 2. Core Design Principles

1. **Zero-friction first run.** Download, fill in one `.env`, run one command. No manual database setup, no multi-step wizard buried in a wiki.
2. **Config over code.** Server admins should tune behavior (prefixes, log channels, auto-mod thresholds, role gates) through slash commands or a config file — never by editing source.
3. **Own your data.** All moderation logs, warn history, and settings live in a local or self-hosted database (SQLite by default, swappable to Postgres). No bot author's cloud, no telemetry phoning home by default.
4. **Resource-conscious.** Runs comfortably on a $5/month VPS or a Raspberry Pi — sub-200MB idle memory footprint, no mandatory Redis/queue infra for small servers, though it should scale up cleanly if a host adds one.
5. **Graceful degradation.** Optional integrations (AI moderation, external APIs) fail closed and log clearly rather than crashing the bot when a key is missing or a service is down.
6. **Update without dread.** Migrations run automatically and are forward-only, with a one-command backup so any upgrade can be undone by restoring it; config schema changes are backward-compatible or come with a clear migration note.
7. **Documented for the host, not just the developer.** Every feature ships with the "why would I turn this on" explanation a volunteer mod-team lead needs, not just API docs.
8. **In-Discord onboarding, not local config.** All setup beyond getting the bot running happens inside Discord — the `/setup` feature map walks the admin through mod-log channel, auto-mod thresholds, permission roles, and turning optional modules on or off. The only technical step for a no-skills user is getting the bot running (download + `docker compose up -d`); everything after that is point-and-click in Discord itself.

## 3. Tech Stack (locked in)

These were the defaults recommended at the start; all of them were taken, so treat them as decided, not open (see §16).

| Layer                           | Choice                                                                                                                                      | Why                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Language/runtime                | Node.js 22 LTS + TypeScript (strict, CommonJS)                                                                                              | Best-maintained Discord library ecosystem; Node 22 because Node 20 is end-of-life and `@discordjs/voice` needs 22.12+ |
| Discord library                 | discord.js v14                                                                                                                              | Most active library, native slash commands, polls, select menus, modals                                               |
| Database                        | SQLite via Prisma 5; Postgres possible by switching the Prisma provider                                                                     | Zero-setup default, no separate DB server                                                                             |
| Config                          | `.env` for secrets and host-level switches; everything per-server lives in the database and is set in Discord (`/setup`, `/config`)         | No `config.yml` — nothing to hand-edit after first run                                                                |
| Deployment                      | Ready-made Docker images on GitHub's registry + docker-compose; build-from-source and bare Node documented as fallbacks; Railway documented | `docker compose up -d` is the whole story                                                                             |
| Process management (non-Docker) | pm2                                                                                                                                         | Auto-restart on crash, log rotation, near-zero config                                                                 |
| Tests / lint                    | vitest, ESLint (flat config), Prettier                                                                                                      | Fast, boring, well documented                                                                                         |

## 4. System Prompt (for an AI assistant helping build this bot)

Drop this in as the working system prompt whenever an assistant is asked to write, review, or extend code for this project:

```
You are helping build a self-hostable Discord moderation and utility bot. This is not a SaaS product with a backend team behind it — it will be run by one person, on modest hardware, with no dedicated ops support. Every suggestion you make is judged against that reality.

Non-negotiables:
1. No feature may require a paid third-party API to function at a baseline level. Paid integrations (OpenAI, etc.) are always optional enhancements with a working fallback.
2. No hardcoded secrets, tokens, or webhook URLs — everything sensitive comes from environment variables or a config file the host controls.
3. Every new config option gets a sane default so the bot works out of the box without the host having to discover and set it.
4. Database schema changes ship with a migration, forward-only unless explicitly asked for a rollback path.
5. Log actionable errors (bad permissions, missing intents, rate limits) with a plain-English fix suggestion — the person reading the log is the host, not you.
6. Respect Discord API rate limits and intents explicitly; don't request privileged intents (message content, presence, members) unless the feature genuinely needs them, and note in code comments why when you do.
7. Prefer boring, well-documented libraries over clever one-off code. A self-hoster debugging this at 11pm should be able to follow it.
8. When proposing a new feature, note: (a) does it need a new privileged intent, (b) does it need a new env var, (c) what's the resource cost at idle and under load, (d) what happens if a dependency it needs isn't configured.
9. Forward-thinking is welcome — modular command architecture, plugin/extension points, AI-assisted moderation hooks — but never at the cost of #1-3. A self-hoster should be able to ignore every advanced feature and still have a solid moderation bot.
10. Write for a competent-but-busy sysadmin: comment the "why," not the "what"; keep the README's quickstart to under 10 steps.
```

Before changing anything, also read §10 (architecture), §16 (decisions already made — don't relitigate them) and §17 (known gaps).

## 5. Feature Roadmap

### Core (v1 — moderation/utility baseline)

- [x] Warn/kick/ban/timeout with reason logging and a searchable case history
- [x] Auto-mod: spam/flood detection, invite-link filtering, word/phrase filter, mention-spam limits
- [x] Configurable mod-log channel with rich embeds per action
- [x] Role-based permission gates for every command (not just Discord's built-in permissions)
- [x] Slash-command-first UX with legacy prefix support as opt-in (switch and prefix in `/setup`)
- [x] Basic utility: userinfo, serverinfo, remind-me, simple polls

### Near-term (v1.x)

- [x] Anti-raid mode: join-rate throttling, auto-lockdown trigger
- [x] Mute/timeout scheduling with auto-expiry
- [x] Appeal/DM-based mod-log acknowledgment flow
- [x] Per-channel auto-mod rule overrides

### Fun, Creative & Game Integration (opt-in modules)

- [x] Custom tag/command system — hosts define their own text/embed responses without touching code
- [x] Leveling/XP system with configurable role rewards for activity
- [x] Starboard — pin popular messages to a channel via emoji reactions
- [x] Welcome/goodbye messages with custom embeds and images
- [x] Birthday tracker + announcement
- [x] Quote book / "said it here first" archive
- [x] Dice roller, RPG stat tools, D&D-style utility commands
- [x] Game server status pinger — live player count/uptime for self-hosted game servers (Minecraft, Valheim, ARK, etc.) via query protocols
- [x] LFG (looking-for-group) matchmaking — post/join queues for a game session, auto-ping a role when a group forms
- [x] Voice-channel "now playing" activity roles — auto-tag members by detected game activity (Discord Rich Presence)
- [x] Optional game stats lookups (Steam, Riot, etc.) — API-key-gated, fails gracefully with a clear "not configured" message when no key is set
- [x] Simple tournament/bracket tracker for community game nights
- [x] Twitch/YouTube live-stream notifications, filterable by game
- [x] Economy/bank system — user credits, slot machine, leaderboard
- [x] Trivia module with custom/importable question lists
- [x] Reaction-role self-assignment (emoji opt-in — distinct from the XP-based role rewards above)
- [x] Game-night map pools — per-game map lists, random pick, or a native Discord poll vote (`/map`)
- [x] Group listening — `/jam` launches Discord's own YouTube Watch Together (zero cost, default); `/music` is the opt-in heavy player (see §16)
- [x] `/setup` feature map — every module listed with status, per-feature channel/role mapping, on/off switch per module, Skip on every screen

### All-in-one assistant (2026-11-01)

Chosen from what the most-used all-in-one bots (Dyno, Carl-bot, MEE6) are relied on for, with logging and tickets first, since those are the features most often paid for elsewhere.

- [x] Moderation essentials: `/purge` (filters: member, bots, text), `/slowmode`, `/lock` / `/unlock`, `/unban` (with a case), `/role add|remove`
- [x] Server logs: message edits/deletes, joins/leaves, nickname/role changes, voice, channel and role changes, bans (including outside the bot), each switchable
- [x] Message text in logs: opt-in, with a retention period after which the bot edits the text out
- [x] Support tickets: panel button → private thread with the staff role; close saves a transcript
- [x] Suggestions with vote buttons and staff approve/deny (author DM'd)
- [x] Giveaways: button entry, automatic draw, reroll
- [x] Join roles and a Verify button
- [x] Auto-responders (trigger phrases, 30 s cooldown per channel)
- [x] Announcements: now, later, daily or weekly
- [x] Join-to-create voice rooms with `/voice` controls
- [x] `/help`, generated from the module registry

All of these can be switched off per server from `/setup`; a host running a pure moderation setup pays no resource cost for the ones nobody uses (their background jobs skip switched-off servers, and `/music`'s code isn't even loaded unless the host enables it).

### Integrations & host tools (2026-11-02)

- [x] Add-ons: RSS/Atom feeds, Steam game news, Epic free games, game-server up/down alerts, incoming webhooks (`/addons`, dashboard → Add-ons), plus a "Connected APIs" status list
- [x] Discord's native AutoMod for the invite, word and mention filters (per-server opt-in; works without Message Content)
- [x] Dashboard Lists page (auto-responses, tags, level rewards, scheduled announcements) and mod-log notes for every dashboard change
- [x] Cross-platform backups: daily automatic (`BACKUP_KEEP`) and `npm run backup`
- [x] Versioned releases (`v1.0.0`, `CHANGELOG.md`): images tagged `1.0.0` / `1.0.0-music` for pinning and rollback

### Forward-thinking (v2+)

- [x] Optional AI-assisted triage — flag likely-toxic messages for human review (never auto-action without a human-in-the-loop toggle). Built 2026-11-02: review channel with Delete / Looks fine buttons; never acts on its own
- [x] Plugin architecture so a host can drop in a custom command/module without forking core. Built 2026-11-02: `ENABLE_PLUGINS`, `.js` files in `./plugins` (docs/PLUGINS.md)
- [x] Web dashboard (self-hosted, same box) as an alternative to slash-command config — explicitly optional, bot must be fully usable without it. Built 2026-11-01: `ENABLE_DASHBOARD`, sign-in by one-time link from `/dashboard` (see §10, §16)
- [x] Cross-server ban-list sharing for trusted server networks (opt-in, host-controlled trust list — never a shared cloud service by default). Built 2026-11-02: `/bannetwork`, servers on the same bot instance
- [ ] Cross-server announcement broadcasting for server networks (opt-in, distinct from the ban-list sharing above)
- [x] Audit-log export (CSV/JSON) for servers that need compliance records. Built 2026-11-02: `/exportcases` and dashboard downloads

Every item above should be gated so a host running only the core feels no weight from the features they haven't turned on. The module registry (`src/lib/modules.ts`, §10) is the natural starting point for the plugin architecture.

**Explicitly out of scope for now:**

- Music from sources other than YouTube (SoundCloud, Spotify, etc.). YouTube music itself shipped as an opt-in heavy module — see the 2026-10-31 decision in §16.
- Community plugin index / full 3rd-party cog marketplace — meaningful trust/security surface (running community-submitted code); revisit only once core is stable

The plugin architecture and "no coding required" onboarding goals above are a proven pattern, not a novel risk — validated by [Red-DiscordBot](https://github.com/Cog-Creators/Red-DiscordBot), a long-running, widely used self-hosted Python/discord.py bot with a mature cog ecosystem running exactly this model at scale.

## 6. Self-Hosting Requirements

What has to exist before this counts as "actually self-hostable," not just runnable by the original author — with where each one lives:

- [x] **README quickstart under 10 steps** — README "Setup, step by step" (8 steps, written for no tech background) plus a short version for Docker users.
- [x] **In-Discord `/setup`** covers everything past the quickstart — the feature map (§10).
- [x] **`.env.example`** with every variable named and commented; only `DISCORD_TOKEN` is required (§12).
- [x] **Docker Compose as the primary path**, `./data` mounted so data survives updates and rebuilds.
- [x] **Startup validation**: config check (zod), writable data dir, database reachable, token and intent errors explained with a `-> Fix:` line; music tools checked when music is on.
- [x] **Backup guidance**: daily automatic backups (`BACKUP_KEEP`, default 7), `npm run backup` (works on Windows too), `docs/BACKUP.md`.
- [x] **Upgrade guide**: `docs/UPGRADING.md`; upgrading a populated database was tested for the latest migration.
- [x] **No mandatory external accounts**: every integration key is optional and marked so.
- [x] **Resource baseline documented**: README "Resource baseline" (60–100 MB idle) and the music costs in "Music and watch parties".

## 7. Security & Privacy Guidelines

- Bot token, database credentials, and any AI/API keys stay in `.env` — never committed, `.gitignore` covers it from day one.
- Store only what moderation actually needs: message content is logged for auto-mod matches only when the host opts in, and even then should be truncatable/expirable via a retention setting. (Built: "Keep message text" in `/setup` → Auto-mod or Server logs, off by default, with a 1–365 day period. Every log message that includes text is recorded in `content_log_messages`, and the slow scheduler tick edits the text out when it expires.)
- Every mod action logged with actor, target, reason, and timestamp — this is for the host's own accountability and dispute resolution, not for us.
- Default to the least-privileged Discord intents and permissions; document exactly which ones are required vs. optional and why.
- If AI-assisted moderation ships, message content sent to an external API must be opt-in, clearly disclosed in docs, and the host must supply their own API key — never proxied through a service the project runs.
- No phone-home telemetry, analytics, or update-check pinging without an explicit, off-by-default opt-in the host can see in the config. The only network calls besides Discord and the integrations a host configures are both opt-in: the auto-updater (`COMPOSE_PROFILES=autoupdate`) and yt-dlp updating itself (only with music on, `MUSIC_AUTO_UPDATE`). Prisma's CLI update check is switched off (`CHECKPOINT_DISABLE=1`).

Web dashboard (opt-in): listens on 127.0.0.1 unless the host changes it; no passwords (one-time `/dashboard` links, 10 minutes, single use); sessions are in memory and bound to one person and one server; admin rights are re-checked against Discord on every request; CSRF token on every form; `HttpOnly`, `SameSite=Lax` cookie (`Secure` with an https `DASHBOARD_URL`); no scripts and a `default-src 'none'` Content-Security-Policy; every Discord- or member-supplied string is escaped; submitted channel and role IDs must exist on that server, and roles the bot hands out pass the same hierarchy check as in Discord.

AI triage (opt-in twice: the host sets their own `AI_TRIAGE_API_KEY`, then each server switches it on): message text from those servers goes to Anthropic's API with the host's key, never through anything the project runs; it is disclosed in `/setup`, the dashboard and `.env.example`; moderators' messages and short ones are skipped; per-server rate cap; it only posts suggestions, never acts.

Add-ons fetch URLs typed by server admins, who are not necessarily the host, so fetches refuse private, loopback, link-local and metadata addresses at connect time (including after redirects and DNS tricks), only use http(s), and stop at 2 MB / 20 s. `ADDONS_ALLOW_PRIVATE_NETWORK=true` lifts that for hosts who trust every admin. Incoming webhooks are authenticated by a secret stored only as a hash, rate-limited, and never ping anyone. Game-server watches may target private addresses on purpose (self-hosted game servers), same as `/gameserver`.

Plugins run with the bot's full access: off by default, only loaded from a folder the host controls (mounted read-only in Docker), no store or download.

Also in place: the bot never pings `@everyone`, `@here` or roles on anyone's behalf (`allowedMentions: users` client-wide); members can't moderate or hand out roles at or above their own highest role, or above the bot's; `/music` only fetches YouTube URLs (no arbitrary URLs, so it can't be pointed at the host's network) and passes queries after `--` so they can't become yt-dlp flags.

## 8. Contribution & Coding Standards

- One command = one file/module where practical; commands are self-contained enough that a host can delete a file to disable a feature they don't want. New commands are registered in `src/commands/index.ts`, and if they belong to a switchable module, added to that module's `commands` list in `src/lib/modules.ts` (a unit test fails if a module names a command that doesn't exist).
- Type-check or lint on every commit (TypeScript strict mode). CI runs typecheck, lint, tests and build on every PR (§13).
- Every PR touching a config option updates `.env.example` and the README in the same PR — docs drift is treated as a bug.
- Tests for auto-mod logic and permission gating are required; UI/embed formatting can stay manual-tested. Keep Discord-free logic in pure functions so it can be unit tested (see `src/setup/status.ts`, `src/lib/maps.ts`, `src/music/resolve.ts`).
- Commit messages and PR descriptions should note any new intent, permission, or external dependency introduced — this is what a self-hoster reads before upgrading.
- Schema changes: prefer migrations that only add (`ADD COLUMN` with a default, `CREATE TABLE`). Prisma's SQLite generator often rebuilds the whole table instead; hand-trim it, then check with `prisma migrate diff` that there's no drift (§16).

---

## 9. Current Status (2026-11-01)

- **Everything in Core, v1.x, Fun/Game, the all-in-one assistant set, and all of v2 except cross-server announcements is built.** 55 slash commands, 127 including subcommands; 34 modules (33 switchable per server; AI triage is off by default). First numbered release: v1.0.0.
- **Web dashboard** (optional, off by default): the same settings as `/setup`, add-ons, lists and the case history (with export), in a browser.
- **Checks:** 180 unit tests; the end-to-end check (§15) passes 298/298 (302/302 with music on) and runs in CI on every PR. `npm audit --omit=dev`: 0 vulnerabilities.
- **Images published:** `ghcr.io/bessv2/discordbot:latest` and `:music` (amd64 + arm64), public, built from `main`; versioned tags from `v*` tags.
- **Not yet verified against live Discord:** voice playback for `/music`, launching Watch Together from `/jam`, the dashboard behind a real reverse proxy, real AutoMod rules, real AI triage calls (CI uses a stand-in), and add-ons against live feeds. The owner confirmed a host can pull and run the published images. Everything else was exercised end to end against a simulated Discord, not a real one.
- **Owner to-dos (GitHub settings, can't be done from code):**
  - [x] Set the repo's default branch to `main`.
  - [x] Make the repo public.
  - [x] Make the `discordbot` package public.
  - [ ] Optionally delete the old `claude/claude-md-implementation-f7vd11` and `test` branches.

## 10. Architecture

```
src/
  index.ts            entry: health check → load commands/events → login; shutdown stops music children
  config.ts           every env var, validated with zod (the only place process.env is read)
  discord/            client (intents, partials, allowedMentions), command/event wiring,
                      commandSync (auto-registers slash commands), deployCommands (manual fallback),
                      prefixHandler (legacy !commands)
  events/             one file per Discord event (ready, interactionCreate, messageCreate, reactions,
                      guildMemberAdd/Remove, presenceUpdate, channelCreate, voiceStateUpdate)
  commands/           one file per slash command, grouped moderation/ utility/ setup/ community/ fun/
  features/           tickets, giveaways, suggestions, joinRoles (+ Verify), autoResponders,
                      announcements, tempVoice, banNetwork, aiTriage: the logic and buttons behind those commands
  serverlog/          events.ts (event kinds, switches, posting) and handlers.ts (one per Discord event)
  setup/              /setup feature map: status.ts (pure status logic), hostFacts.ts, and panels.ts (one screen per feature)
  addons/             parse.ts (feeds, Epic, webhook bodies; pure), safeFetch.ts (no private addresses), runner.ts
  plugins/            loader.ts: loads ./plugins/*.js when ENABLE_PLUGINS=true
  scripts/            backup.ts (npm run backup)
  dashboard/          optional web dashboard: fields.ts (what each page edits + pure validation), auth.ts (sign-in
                      links, sessions), render.ts (HTML), server.ts (express routes), url.ts
  lib/                shared logic: db, logger, permissions, modules (registry + on/off), caseManager,
                      modlog, moderationActions/Guard, muteActions, raidActions/Guard, appealActions,
                      xp, economy/walletActions, starboard, reactionRoles, activityRoles, lfgActions,
                      bracket, dice, duration, maps, template, steam/riot/twitch/youtube clients, healthcheck
  automod/            spam, invite, wordFilter, mentionSpam, the runner, and native.ts (Discord AutoMod rule sync)
  scheduler/          one scheduler: fast tick 15s (reminders, mute expiry, giveaway draws,
                      announcements, spam-log sweep), slow tick 5min (birthdays, stream polling,
                      expiring message text in logs)
  reminders/ birthdays/ streaming/ xp/   jobs and engines used by the scheduler and events
  music/              resolve.ts (yt-dlp lookups, pure parsing), player.ts (voice; lazy-loaded), check.ts
  data/               built-in trivia questions
prisma/               schema.prisma + migrations (applied automatically by docker-entrypoint.sh)
tests/                vitest unit tests; tests/e2e: end-to-end check against a simulated Discord
docs/                 BACKUP, UPGRADING, TESTING, RAILWAY
.github/workflows/    docker-image.yml: checks + image builds
```

**Buttons.** Feature buttons (`ticket_open`, `ticket_close:<id>`, `giveaway_enter:<id>`, `suggestion_vote:<id>:up|down`, `verify`) are routed by a small table in `interactionCreate`; each handler checks its own module switch, since buttons outlive the command that posted them. `/setup` and appeals use their own collectors/prefixes.

**How a slash command runs.** `interactionCreate` looks up the command, checks the permission gate (`lib/permissions.ts`: Administrator always passes; if a server picked roles for the command's scope — moderation/admin/utility — those roles decide; otherwise the command's native Discord permission does), then checks the module switch (`lib/modules.ts`: a switched-off module's commands reply that it's off), then runs it. Errors are caught and logged; the member sees a short apology.

**Modules.** `src/lib/modules.ts` lists every switchable feature with its commands and how it's toggled: older features keep their own boolean column (`xpEnabled`, `economyEnabled`, `welcomeEnabled`, `automodEnabled`, `antiRaidEnabled`), everything else is on unless listed in `GuildConfig.disabledModules`. Background work checks the same switch (stream polling, birthday posts, starboard, reaction roles, activity roles).

**`/setup`.** Opens on a feature map (`setup/status.ts` decides ✅/⬜/⚠️ from the server's settings plus host facts such as which intents are on). Each feature has a panel in `setup/panels.ts` with pickers, toggles and small forms; quick start walks modlog → automod → permissions. State lives only in the message collector (15-minute life), so there's nothing to clean up after a restart.

**Command registration.** On every start, `commandSync.ts` hashes the command definitions plus the application ID and target (global, or one guild if `DISCORD_GUILD_ID` is set) and only calls Discord when the hash differs from `data/.commands-hash`.

**Web dashboard.** Off unless `ENABLE_DASHBOARD=true`; `index.ts` then imports `dashboard/server.ts` (and with it express) and listens on `DASHBOARD_HOST:DASHBOARD_PORT`. `/dashboard` makes a one-time token (in memory) and replies ephemerally with `DASHBOARD_URL/login?t=…`; opening it starts a 12-hour session for that user and server and redirects to `/`. Every other route goes through one middleware that loads the session, fetches the member from Discord and runs the same admin gate as `/setup`, and checks the CSRF token on POSTs. Pages: the feature map with on/off buttons (`setModuleOn`, the same code as `/setup`), one settings form per feature built from `PAGES` in `fields.ts`, and `/cases`. Saving validates every field first (`parseField`, pure) and writes nothing if any is wrong. No database changes: it reads and writes the same `GuildConfig` and `permission_roles` rows.

**Add-ons.** The slow tick runs `checkAddons`: each enabled add-on is checked when due (feeds 15 min, Steam 30 min, Epic 6 h, server watch 5 min), new items are posted (never the history on the first check, max 3 per check), and the outcome is stored on the row (`lastError` is what `/addons list` and the dashboard show). Webhooks arrive at `POST /hooks/:id/:secret` on the dashboard server, before the sign-in middleware.

**Discord AutoMod.** `automod/native.ts` turns a server's auto-mod settings into up to three AutoMod rules and keeps them in sync (hash-gated, so unchanged settings cost no API calls): after `/setup` and dashboard changes, and every slow tick as a backstop. The bot's own filters skip whatever Discord's rules cover, but only while those rules exist.

**Ban sharing.** `guildBanAdd` → `features/banNetwork.ts`: for each other server in the network, an alert with a "Ban here too" button (`bannet_ban:<userId>`) or an automatic `banMember` with the bot as invoker. Shared bans carry a "Shared ban from" reason and are never re-shared; each ban is shared once per network per 10 minutes.

**AI triage.** `messageCreate` → `features/aiTriage.ts`, fire-and-forget: skipped unless the host key is set, the server switched it on and has a review channel; moderators and short messages skipped; per-server rate cap. One `beta.messages.create` call with a fixed JSON schema, low effort, cached system prompt and server-side refusal fallbacks. Findings above "low" are posted with `triage_del:<channel>:<message>` / `triage_ok` buttons.

**Plugins.** `index.ts` calls `loadPlugins` before commands are loaded, so plugin commands join `commands` (and the hash in `commandSync`) and the `plugins` module's command list; `onReady` and `onMessage` hooks are called with errors caught.

**Backups.** The slow tick calls `dailyBackup` (once a day, `VACUUM INTO data/backups/bot-<time>.db`, keeping `BACKUP_KEEP`).

**Music.** `/jam` only creates a Watch Together invite. `/music` dynamically imports `music/player.ts` (and with it `@discordjs/voice`) only when `ENABLE_MUSIC=true`. Per server: one voice connection, a queue (max 200), and a `yt-dlp → ffmpeg → Ogg/Opus` pipeline per track; it leaves after 5 minutes idle or when the channel has had no humans for two 30-second checks.

## 11. Commands

Scope is the permission gate's scope; the bracket is the Discord permission used when the server hasn't picked roles for that scope. "core" means it can't be switched off (or is controlled by its own setting, e.g. XP, economy, welcome).

| Command                                                      | Subcommands                                                                                          | Scope (default permission)                 | Module                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------- |
| `/warn` `/kick` `/ban` `/timeout` `/mute` `/unmute` `/cases` | —                                                                                                    | moderation (Moderate/Kick/Ban Members)     | core                  |
| `/userinfo` `/serverinfo`                                    | —                                                                                                    | utility                                    | core                  |
| `/remind`                                                    | —                                                                                                    | utility                                    | reminders             |
| `/poll`                                                      | —                                                                                                    | utility                                    | polls                 |
| `/setup`                                                     | —                                                                                                    | admin (Manage Server)                      | core                  |
| `/config`                                                    | view, modlog, automod, wordfilter, permissions, antiraid, channel-override, appeal-channel, birthday | admin (Manage Server)                      | core                  |
| `/lockdown`                                                  | — (state on/off)                                                                                     | admin (Manage Server)                      | core                  |
| `/xp`                                                        | set, role-reward                                                                                     | admin (Manage Server)                      | core (xpEnabled)      |
| `/rank` `/leaderboard`                                       | —                                                                                                    | utility                                    | core                  |
| `/economy`                                                   | balance, daily, slots, give, take                                                                    | utility (give/take need mod rights)        | core (economyEnabled) |
| `/welcome`                                                   | set, goodbye-set, test                                                                               | admin (Manage Server)                      | core (welcomeEnabled) |
| `/tag`                                                       | create, edit, delete, list, show                                                                     | utility                                    | tags                  |
| `/roll` `/coinflip` `/8ball`                                 | —                                                                                                    | utility                                    | fun                   |
| `/quote`                                                     | add, random, list, delete                                                                            | utility                                    | quotes                |
| `/reactionrole`                                              | create, remove, list                                                                                 | admin (Manage Roles)                       | reactionroles         |
| `/starboard`                                                 | config, disable                                                                                      | admin (Manage Server)                      | starboard             |
| `/trivia`                                                    | start, stop, import                                                                                  | utility (import needs mod rights)          | trivia                |
| `/birthday`                                                  | set, remove, today                                                                                   | utility                                    | birthdays             |
| `/gameserver`                                                | —                                                                                                    | utility                                    | gameservers           |
| `/gamestats`                                                 | steam, lol                                                                                           | utility                                    | gameservers           |
| `/streamwatch`                                               | add, remove, list                                                                                    | admin (Manage Server)                      | streams               |
| `/activityrole`                                              | add, remove, list                                                                                    | admin (Manage Roles)                       | activityroles         |
| `/lfg`                                                       | —                                                                                                    | utility                                    | lfg                   |
| `/tournament`                                                | create, join, leave, start, report, view                                                             | utility                                    | tournaments           |
| `/map`                                                       | add, remove, list, random, vote                                                                      | utility (add/remove need mod rights)       | maps                  |
| `/jam`                                                       | —                                                                                                    | utility                                    | music                 |
| `/music`                                                     | play, skip, pause, resume, queue, shuffle, remove, stop                                              | utility (DJ role, if set)                  | music                 |
| `/purge`                                                     | — (amount, user, bots_only, contains)                                                                | moderation (Manage Messages)               | core                  |
| `/slowmode` `/lock` `/unlock`                                | —                                                                                                    | moderation (Manage Channels)               | core                  |
| `/unban`                                                     | —                                                                                                    | moderation (Ban Members)                   | core                  |
| `/role`                                                      | add, remove                                                                                          | moderation (Manage Roles)                  | core                  |
| `/help`                                                      | — (command)                                                                                          | utility                                    | core                  |
| `/dashboard`                                                 | —                                                                                                    | admin (Manage Server)                      | core                  |
| `/addons`                                                    | add, list, test, remove                                                                              | admin (Manage Server)                      | addons                |
| `/exportcases`                                               | — (format, user)                                                                                     | moderation (Moderate Members)              | core                  |
| `/bannetwork`                                                | create, join, mode, status, leave                                                                    | admin (Manage Server)                      | bannetwork            |
| `/ticket`                                                    | panel, close, add, remove                                                                            | utility (panel: admins; add/remove: staff) | tickets               |
| `/giveaway`                                                  | start, end, reroll, list                                                                             | moderation (Manage Server)                 | giveaways             |
| `/suggest`                                                   | — (idea)                                                                                             | utility                                    | suggestions           |
| `/suggestion`                                                | approve, deny                                                                                        | moderation (Manage Server)                 | suggestions           |
| `/autoresponder`                                             | add, remove, list                                                                                    | admin (Manage Server)                      | autoresponders        |
| `/announce`                                                  | send, list, cancel                                                                                   | admin (Manage Server)                      | announcements         |
| `/voice`                                                     | rename, limit, lock, unlock                                                                          | utility (room owner or mods)               | tempvoice             |

Plugin commands (from `./plugins`) belong to the `plugins` module and use the scope each plugin declares. AI triage has no command: it's switched on in `/setup` (module `aitriage`, off by default).

Legacy prefix commands (`!warn`, `!kick`, `!ban`, `!cases`) exist behind `ENABLE_PREFIX_COMMANDS` + `ENABLE_MESSAGE_CONTENT` and a per-server flag (§17).

## 12. Configuration

Host-level settings live in `.env` (documented line by line in `.env.example`); everything per-server is set in Discord. Only `DISCORD_TOKEN` is required.

| Variable                                                      | Default                    | What it does                                                              |
| ------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------- |
| `DISCORD_TOKEN`                                               | — (required)               | Bot token from the Developer Portal → Bot. Trimmed of stray whitespace.   |
| `DISCORD_CLIENT_ID`                                           | looked up from the token   | Only kept for older setups / `deploy-commands`.                           |
| `DISCORD_GUILD_ID`                                            | empty (global commands)    | Developers: register commands in one server instantly.                    |
| `DATABASE_URL`                                                | `file:../data/bot.db`      | Relative to `prisma/`, so it lands in `./data` (§16).                     |
| `ENABLE_MESSAGE_CONTENT`                                      | false                      | Privileged intent: invite/word filters, mention spam, prefix commands.    |
| `ENABLE_PREFIX_COMMANDS`, `PREFIX`                            | false, `!`                 | Legacy `!` commands.                                                      |
| `ENABLE_GUILD_MEMBERS`                                        | false                      | Privileged intent: welcome/goodbye, anti-raid, birthday-role cleanup.     |
| `ENABLE_PRESENCE`                                             | false                      | Privileged intent: `/activityrole`.                                       |
| `ENABLE_MUSIC`                                                | false                      | Turns on `/music` (needs the `music` image, or ffmpeg + yt-dlp).          |
| `MUSIC_AUTO_UPDATE`                                           | true                       | With music on, update yt-dlp at each start.                               |
| `BOT_IMAGE_TAG`                                               | `latest`                   | Compose only: `latest` or `music`.                                        |
| `COMPOSE_PROFILES`                                            | empty                      | Compose only: `autoupdate` turns on the daily updater.                    |
| `TZ`                                                          | UTC                        | Time zone for the 04:00 update check.                                     |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `YOUTUBE_API_KEY` | empty                      | Stream alerts.                                                            |
| `STEAM_API_KEY`, `RIOT_API_KEY`                               | empty                      | `/gamestats`.                                                             |
| `LOG_LEVEL`, `NODE_ENV`                                       | info, production           | Logging.                                                                  |
| `CHECKPOINT_DISABLE`                                          | 1                          | Turns off Prisma's CLI update check (already set in the image).           |
| `ENABLE_DASHBOARD`                                            | false                      | Turns on the web dashboard and `/dashboard` sign-in links.                |
| `DASHBOARD_PORT`                                              | 3000                       | Dashboard port. Compose publishes it on 127.0.0.1 only when it's set.     |
| `DASHBOARD_HOST`                                              | 127.0.0.1 (image: 0.0.0.0) | Address the dashboard listens on.                                         |
| `DASHBOARD_URL`                                               | `http://localhost:PORT`    | Public address for sign-in links (reverse proxy, tunnel, Railway).        |
| `BACKUP_KEEP`                                                 | 7                          | Daily automatic backups kept in `data/backups` (0 = off).                 |
| `ADDONS_ALLOW_PRIVATE_NETWORK`                                | false                      | Let add-on feeds reach private/local addresses.                           |
| `AI_TRIAGE_API_KEY`                                           | empty (off)                | The host's Anthropic API key; turns AI triage on for servers that opt in. |
| `AI_TRIAGE_MODEL`                                             | `claude-opus-5-5`          | Claude model for triage.                                                  |
| `AI_TRIAGE_MAX_PER_MINUTE`                                    | 20                         | Messages checked per server per minute.                                   |
| `ENABLE_PLUGINS`, `PLUGINS_DIR`                               | false, `./plugins`         | Load host plugins (docs/PLUGINS.md).                                      |

Intents: Guilds, GuildMessages, GuildMessageReactions, GuildVoiceStates and GuildModeration (bans done outside the bot, for server logs) are always on (none privileged). The three privileged ones are opt-in via the flags above. Invite permissions requested (explicit list, never Administrator): View Channels, Send Messages, Embed Links, Read Message History, Add Reactions, Manage Messages, Kick, Ban, Moderate Members, Manage Roles, Manage Channels, Create Invite, Create Polls, Connect, Speak, Create Private Threads, Send Messages in Threads, Manage Threads, Attach Files, Move Members. Discord's AutoMod option additionally needs the bot's role to have Manage Server in that server (not in the invite link). No new env vars were needed for the all-in-one set: everything is configured per server in `/setup`. Blank values in `.env` (`DASHBOARD_PORT=`) mean "use the default".

## 13. Deployment & Updates

- **Images.** `.github/workflows/docker-image.yml` runs typecheck, lint, tests and build, then builds `ghcr.io/bessv2/discordbot:latest` and `:music` for linux/amd64 and linux/arm64 (64-bit Raspberry Pi). Published on push to `main`, on `v*` tags (versioned tags too) and weekly (fresh Alpine/Node fixes and yt-dlp); PRs only test-build (amd64, nothing pushed). The `music` image is built with `MUSIC=true` (ffmpeg, python3, yt-dlp's official release).
- **Compose.** `docker-compose.yml` pulls the image (`BOT_IMAGE_TAG`), mounts `./data`, `restart: unless-stopped`, mounts `./plugins` read-only, and publishes the dashboard port on 127.0.0.1 only: `127.0.0.1:${DASHBOARD_PORT:-}:${DASHBOARD_PORT:-3000}`, so with `DASHBOARD_PORT` unset Docker picks a random free port and the line can never clash with another service on 3000. The image sets `DASHBOARD_HOST=0.0.0.0` (inside the container). `docker-compose.build.yml` overrides it to build from source.
- **Releases.** A `v*` git tag (e.g. `v1.0.0`) publishes `1.0.0` and `1.0.0-music` images alongside `latest`/`music`; `CHANGELOG.md` lists what changed. Hosts pin with `BOT_IMAGE_TAG=1.0.0`.
- **Startup** (`docker-entrypoint.sh`): `prisma migrate deploy`, then (music only) `yt-dlp -U`, then the bot.
- **Updates.** Manual: `docker compose pull && docker compose up -d`. Automatic (opt-in): `COMPOSE_PROFILES=autoupdate` adds `nickfedor/watchtower:1.23.2`, which only updates containers labelled `com.centurylinklabs.watchtower.enable=true` (just the bot), daily at 04:00, and cleans up old images.
- **Other paths.** Railway builds the Dockerfile itself (`docs/RAILWAY.md`; set `MUSIC=true` there for music). Bare Node: `npm ci && npm run build && npm run db:migrate && npm start`, with pm2.

## 14. Data Model

SQLite through Prisma; every table is per-server and cascades when a server's config row is deleted. `guild_configs` holds every per-server setting (mod-log, auto-mod thresholds, anti-raid, mute role, appeal channel, XP, starboard, welcome, birthdays, economy, `disabledModules`, `musicDjRoleId`, server-log channel and event switches, ticket staff role and transcript channel, suggestions channel, join roles, verified role, join-to-create hub). The other tables: `permission_roles`, `cases`, `reminders`, `polls`, `mutes`, `channel_automod_overrides`, `appeals`, `tags`, `user_xp`, `level_role_rewards`, `starboard_posts`, `birthdays`, `quotes`, `reaction_roles`, `wallets`, `trivia_questions`, `stream_notifications`, `lfg_posts`, `tournaments`, `voice_activity_roles`, `map_pools`, `content_log_messages`, `tickets`, `giveaways`, `giveaway_entries`, `suggestions`, `suggestion_votes`, `auto_responders`, `temp_voice_channels`, `scheduled_messages`, `addons`, `ban_networks`, `ban_network_members`. `guild_configs` also holds `nativeAutomod` + `nativeAutomodState` and `aiTriageEnabled` + `aiTriageChannelId`.

Migrations, in order: `init` (v1 core) → `add_v1x_and_fun_modules` → `add_prelockdown_verification_level` → `add_setup_modules_maps_music` → `add_assistant_features` → `add_addons` → `add_native_automod` → `add_ban_networks_ai_triage` (each hand-trimmed to `CREATE TABLE` / `ADD COLUMN`; `prisma migrate diff` shows no drift; upgrading a populated database through the last three was tested 2026-11-02). Case numbers are per server and assigned inside a transaction so two moderators can't get the same number.

## 15. Testing & Verification

- **Unit tests** (`npm test`, 180): auto-mod detectors, permission gate, role hierarchy and role-assign checks, durations, dice, economy payouts and daily reset, XP curve, raid detection, brackets, activity-role matching, module switches and registry consistency, map parsing, music query classification and yt-dlp output parsing, `/setup` status logic, purge selection, auto-responder matching, announcement repeats, ticket transcripts, server-log switches, message-text redaction, dashboard sign-in tokens and sessions, field validation, HTML escaping, feed/Epic/webhook parsing, private-address blocking, AutoMod rule building, case export (CSV formula defusing), backups, ban sharing, AI triage parsing and rate caps, and plugin validation.
- **CI**: the same checks on every PR, plus test builds of both images.
- **End-to-end check** (`npm run build && npm run test:e2e`, `tests/e2e/`, runs in CI): the real bot code and a real SQLite database, with discord.js's network layer replaced by a simulated Discord that records every API call. It drives all 55 commands (plus the example plugin's), every `/setup` screen and button, auto-mod, XP and auto-responders via message events, reaction roles, starboard, welcome, join roles and Verify, appeals, tickets (thread, transcript, close), giveaways, suggestions, server logs (deletes, edits, roles, bans, voice), join-to-create voice, the scheduler jobs, and the web dashboard over real HTTP (sign-in link used once, CSRF refusal, toggles, saving and refusing settings, role hierarchy, XSS escaping, a non-admin session ended, sign-out), add-ons (a local feed server, webhooks over HTTP), Discord AutoMod rule sync, exports and the Lists page, ban sharing, AI triage with a stand-in classifier (CI never calls the API), and plugins: 298/298 checks, 302/302 with music on (`-- --music`). The yt-dlp → ffmpeg → Opus pipeline was checked separately with a stand-in yt-dlp (3 s of audio → 151 Opus packets). Bugs it has found and that were fixed: `/unmute` not recording a case, module switches failing for a server with no settings row, and `/unban` trusting a stale ban cache.
- **Manual test walkthrough** for a fresh server: `docs/TESTING.md`.

## 16. Decision Log

Decisions already made, so they don't get relitigated. Newest last.

- **2026-09-22 — Stack:** Node + TypeScript + discord.js v14 + Prisma/SQLite, Docker first (§3).
- **v1 — SQLite path is `file:../data/bot.db`.** Prisma resolves relative SQLite paths against `prisma/`, so `./data/bot.db` would land in `prisma/data` and be lost on rebuild.
- **v1 — Privileged intents are opt-in env flags**, and the bot warns at startup if a server turned on a feature whose intent is off, instead of silently doing nothing.
- **v1 — The bot never pings `@everyone`/roles:** client-wide `allowedMentions: { parse: ['users'] }`, because lots of member-written text is echoed (tags, quotes, welcome templates, imported trivia).
- **v1 — Permission gate:** Administrator always passes; roles picked for a scope replace Discord's native permission for that scope; otherwise the native permission applies. Usable straight after invite.
- **2026-10-31 — Slash commands register themselves** on startup, gated by a hash, instead of a manual `deploy-commands` step (which also never worked inside the Docker image). `DISCORD_CLIENT_ID` became optional; the bot prints its own invite link.
- **2026-10-31 — Prisma's CLI update check is off** (`CHECKPOINT_DISABLE=1`): it phoned home on every boot and its banner suggested a breaking major upgrade.
- **2026-10-31 — Module switches are an opt-out list** (`disabledModules`), so a module added later is available without a migration; older features keep their own boolean.
- **2026-10-31 — Music ships as a clearly optional, clearly heavy module** (the condition the original roadmap set). `/jam` (Discord Watch Together, no audio through the bot) is the default. `/music` (yt-dlp + ffmpeg) is off unless the host sets `ENABLE_MUSIC=true` and uses the separate `music` image, so a host who never turns it on downloads none of it and loads none of its code. Hosts are told plainly that streaming YouTube through a bot is against YouTube's ToS — their call. Only YouTube links are accepted.
- **2026-10-31 — Ready-made images on GitHub's registry**, so installing and updating are downloads, not builds. Auto-update is opt-in (§7), uses the maintained Watchtower fork (the original was archived in Dec 2025), pinned to one release and label-scoped to the bot, because it gets access to Docker itself.
- **2026-10-31 — Node 22 LTS** (Node 20 end-of-life; `@discordjs/voice` 0.19 needs 22.12+). `@discordjs/voice` is an optional dependency so a failed install never breaks the bot.
- **2026-10-31 — Additive migrations:** Prisma's generated table rebuild for the latest migration was replaced with plain `ADD COLUMN`s, verified with `prisma migrate diff` and by upgrading a populated database.
- **2026-11-01 — This file was renamed from `CLAUDE.md` to `PROJECT.md`** and expanded into full project notes. A one-line `CLAUDE.md` imports it so Claude Code still loads these rules automatically.
- **2026-11-01 — Tickets are private threads, not channels:** no category or per-ticket channel permissions to manage, and they need no Server Boost. Mentioning the staff role adds staff to the thread.
- **2026-11-01 — Message-text retention edits the log message**, because the text only ever lives in Discord (the mod-log or server-log message), never in the database. Each such message is recorded with an expiry, and the slow tick replaces the text fields with "(removed after N days)".
- **2026-11-01 — "Not set up yet" is its own state** (◽) on the feature map, so a fresh server isn't covered in ⚠️ warnings for features that simply need a channel picked. ⚠️ now means "on, but something's wrong".
- **2026-11-01 — Web dashboard runs inside the bot, off by default.** No second container or service; express is only loaded when `ENABLE_DASHBOARD=true`. Server-rendered forms with no JavaScript, so there's no front-end build and nothing for a CSP to let through.
- **2026-11-01 — Dashboard sign-in is a one-time link from `/dashboard`, not Discord OAuth.** OAuth would need the host to register a redirect URL and keep a client secret, and only works on a fixed public address; a link from an ephemeral slash-command reply proves who the person is and that they're an admin, with nothing to configure. Sessions live in memory (a restart signs everyone out) and need no schema change.
- **2026-11-01 — The dashboard is local-only by default** (127.0.0.1, and compose publishes on 127.0.0.1). Remote access is the host's explicit choice: SSH tunnel, VPN, or an HTTPS reverse proxy with `DASHBOARD_URL`.
- **2026-11-01 — `latest` / `music` image tags follow `main` itself** (`github.ref == 'refs/heads/main'`), not `{{is_default_branch}}`, so they can't silently go missing when the default branch is something else.
- **2026-11-02 — Add-ons refuse private addresses at connect time**, not just by checking the URL, because admins (not the host) type the URLs and DNS can point anywhere. Opt-out (`ADDONS_ALLOW_PRIVATE_NETWORK`) is the host's call. Feeds use `fast-xml-parser` (boring and maintained) rather than hand-rolled XML parsing.
- **2026-11-02 — Discord AutoMod is opt-in per server and Manage Server isn't added to the invite.** It needs that permission, which is broad; servers that want it grant it, and the bot keeps its own filters running until Discord's rules actually exist.
- **2026-11-02 — Ban sharing stays inside one bot instance.** No federation between separately hosted bots: that would need a shared service or trust exchange, which §5 rules out by default.
- **2026-11-02 — AI triage uses Claude through the official SDK, default `claude-opus-5-5` at low effort**, with the model overridable by the host. It never acts by itself and is opt-in twice (host key + server switch).
- **2026-11-02 — Plugins are local files only, with full access**, off by default, mounted read-only. No sandbox (it would give a false sense of safety) and no store (§5).
- **2026-11-02 — Daily backups are on by default** (7 kept), because a self-hoster who never set up backups is the common case and a copy of a small SQLite file is cheap.
- **2026-11-01 — `/setup` has one menu per group** (Moderation, Community, Games & fun), because a Discord menu holds at most 25 options and there are now 33 features.

## 17. Known Gaps & Open Items

- **Switching `DISCORD_GUILD_ID` on or off** leaves the commands registered the other way behind, so they can show up twice.
- **No 32-bit ARM image** (older Raspberry Pi OS); 64-bit Pi OS works.
- **Postgres** needs the Prisma provider changed in `schema.prisma`, not just `DATABASE_URL`.
- **Watch Together's app ID** (`880218394199220334`) is Discord's and could change; `/jam` then explains how to start it by hand from the voice channel.
- **yt-dlp vs YouTube:** YouTube changes often; `/music` relies on yt-dlp keeping up (the music image updates it at each start and is rebuilt weekly).
- **Server logs only know message text the bot saw arrive**, and only with Message Content on: messages from before the last restart are logged as deleted without their text, and edits to them aren't logged.
- **Ticket transcripts** include message text only with Message Content on; without it they list who wrote when, plus attachments.
- **`/voice rename`** is limited by Discord to 2 renames per room every 10 minutes.
- **Dashboard scope:** it edits each feature's settings and switches, permission roles and reads cases. Lists managed by commands (tags, reaction roles, XP role rewards, map pools, auto-responders, stream alerts, channel overrides, scheduled announcements) are still managed in Discord. Dashboard changes are written to the bot's log, not the mod-log.
- **Dashboard sessions are in memory**, so a restart signs everyone out (run `/dashboard` again).
- **Discord AutoMod** blocks are alerted to the mod-log by Discord itself but don't create cases in the bot's history.
- **Add-on webhooks** need the dashboard to be reachable by the sending app (a local game server is fine; outside apps need a tunnel or proxy).
- **AI triage** costs money per message checked (host's key) and only sees messages while Message Content is on; it's only been tested against a stand-in classifier.
- **Ban sharing** works only between servers on the same bot instance.
- **Cross-server announcements** (the last v2 item) aren't built.

Fixed on 2026-11-02: the invite and word filters can run on Discord's AutoMod without Message Content.

Fixed on 2026-11-01: legacy `!` commands now have a `/setup` switch; message text in logs has an opt-in and enforced retention; the Muted role is applied to channels created later (and now blocks thread posting too); the end-to-end check is in the repo and in CI.

## 18. History

- **2026-09-22** — Project guidelines written (this file, originally `CLAUDE.md`).
- **PR #1 (2026-10-31)** — v1 release: core moderation, v1.x (anti-raid, mutes, appeals, channel overrides) and every Fun/Game module; a 16-issue code review fixed before release.
- **PR #3 (2026-10-31)** — Beginner step-by-step Docker guide; self-registering commands and invite link; Prisma update check off; all-in-one `/setup` feature map with per-server module switches; `/map`, `/jam`, `/music`; ready-made images with opt-in auto-update; `/unmute` case fix.
- **PR #5 (2026-11-01)** — `CLAUDE.md` → `PROJECT.md`, rewritten as full project notes.
- **2026-11-01** — All-in-one assistant (PR #6): the three known gaps fixed; moderation essentials; server logs; tickets; suggestions; giveaways; join roles and Verify; auto-responders; announcements; join-to-create voice; `/help`; `/setup` menus per group; end-to-end check committed and run in CI.
- **PR #6 (2026-11-01)** — Full Discord assistant (moderation essentials, server logs, tickets, giveaways, suggestions, join roles, auto-responders, announcements, voice rooms) and the optional web dashboard.
- **v1.0.0 (2026-11-02)** — Security updates (undici, zod 4, vitest 4); add-ons and webhooks; Discord AutoMod option; ban sharing; AI triage; case export; dashboard Lists page and mod-log notes; daily backups; plugins; versioned releases.
