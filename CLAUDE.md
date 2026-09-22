# Discord Moderation Bot — Project Guidelines

2026-09-22 · @Someone

## 1. Mission & Vision

This bot exists to give any Discord community — not just ones with a DevOps-savvy admin — a moderation and utility bot they fully own. No third-party dashboard holding their data, no surprise pricing tier, no bot going offline because a hosting company shut down. **Self-hosting isn't a deployment option bolted on at the end — it's the design center.** Every architectural decision gets weighed against: does this stay easy for one person to run on a Pi, a VPS, or a homelab box?

Forward-thinking here means building for where Discord bots are headed — modular permission systems, audit-log-grade logging, slash-command-first UX, and hooks for AI-assisted moderation (auto-triage, sentiment flags, smart escalation) — without ever making self-hosting harder to get to. The bot should feel like a small, well-run SaaS product, except the "cloud" is the host's own machine.

## 2. Core Design Principles

1. **Zero-friction first run.** Clone, fill in one `.env`, run one command. No manual database setup, no multi-step wizard buried in a wiki.
2. **Config over code.** Server admins should tune behavior (prefixes, log channels, auto-mod thresholds, role gates) through slash commands or a config file — never by editing source.
3. **Own your data.** All moderation logs, warn history, and settings live in a local or self-hosted database (SQLite by default, swappable to Postgres). No bot author's cloud, no telemetry phoning home by default.
4. **Resource-conscious.** Runs comfortably on a $5/month VPS or a Raspberry Pi — sub-200MB idle memory footprint, no mandatory Redis/queue infra for small servers, though it should scale up cleanly if a host adds one.
5. **Graceful degradation.** Optional integrations (AI moderation, external APIs) fail closed and log clearly rather than crashing the bot when a key is missing or a service is down.
6. **Update without dread.** Migrations run automatically and are reversible; config schema changes are backward-compatible or come with a clear migration note.
7. **Documented for the host, not just the developer.** Every feature ships with the "why would I turn this on" explanation a volunteer mod-team lead needs, not just API docs.
8. **In-Discord onboarding, not local config.** All setup beyond cloning-and-running happens inside Discord — a guided `/setup` wizard walks the admin through mod-log channel, auto-mod thresholds, permission roles, and enabling optional modules. The only technical step for a no-skills user is getting the bot running (clone + `docker compose up`); everything after that is point-and-click in Discord itself.

## 3. Recommended Tech Stack

Stack is open, but here's the default recommendation — pick this unless there's a specific reason not to:

| Layer | Choice | Why |
| --- | --- | --- |
| Language/runtime | Node.js (LTS) + TypeScript | Best-maintained Discord library ecosystem, huge slash-command tooling, easy for a solo self-hoster to `npm install && run` |
| Discord library | discord.js v14+ | Most active library, native slash-command and permission-v2 support |
| Database | SQLite (via better-sqlite3 or Prisma) by default; Postgres as a drop-in option | Zero-setup default, no separate DB server for small hosts; Postgres for anyone scaling to multiple large guilds |
| Config | `.env` for secrets + a `config.yml` or in-Discord settings commands for behavior | Keeps secrets out of version control while making tunables discoverable |
| Deployment | Docker + docker-compose as the first-class path; bare Node as a documented fallback | One `docker compose up -d` should be the entire self-hosting story |
| Process management (non-Docker) | pm2 | Auto-restart on crash, log rotation, near-zero config |

If Python is preferred instead (discord.py), the same principles apply 1:1 — SQLite via `aiosqlite`/SQLAlchemy, Docker packaging, `.env` config. Don't let stack choice block starting; lock it in early and note the decision here so it doesn't get relitigated mid-project.

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

## 5. Feature Roadmap

### Core (v1 — moderation/utility baseline)

- [x] Warn/kick/ban/timeout with reason logging and a searchable case history
- [x] Auto-mod: spam/flood detection, invite-link filtering, word/phrase filter, mention-spam limits
- [x] Configurable mod-log channel with rich embeds per action
- [x] Role-based permission gates for every command (not just Discord's built-in permissions)
- [x] Slash-command-first UX with legacy prefix support as opt-in
- [x] Basic utility: userinfo, serverinfo, remind-me, simple polls

### Near-term (v1.x)

- [ ] Anti-raid mode: join-rate throttling, auto-lockdown trigger
- [ ] Mute/timeout scheduling with auto-expiry
- [ ] Appeal/DM-based mod-log acknowledgment flow
- [ ] Per-channel auto-mod rule overrides

### Fun, Creative & Game Integration (opt-in modules)

- [ ] Custom tag/command system — hosts define their own text/embed responses without touching code
- [ ] Leveling/XP system with configurable role rewards for activity
- [ ] Starboard — pin popular messages to a channel via emoji reactions
- [ ] Welcome/goodbye messages with custom embeds and images
- [ ] Birthday tracker + announcement
- [ ] Quote book / "said it here first" archive
- [ ] Dice roller, RPG stat tools, D&D-style utility commands
- [ ] Game server status pinger — live player count/uptime for self-hosted game servers (Minecraft, Valheim, ARK, etc.) via query protocols
- [ ] LFG (looking-for-group) matchmaking — post/join queues for a game session, auto-ping a role when a group forms
- [ ] Voice-channel "now playing" activity roles — auto-tag members by detected game activity (Discord Rich Presence)
- [ ] Optional game stats lookups (Steam, Riot, etc.) — API-key-gated, fails gracefully with a clear "not configured" message when no key is set
- [ ] Simple tournament/bracket tracker for community game nights
- [ ] Twitch/YouTube live-stream notifications, filterable by game

All of these are plugin-architecture candidates — a host running a pure moderation setup should never load this code or pay its resource cost unless they turn it on.

### Forward-thinking (v2+)

- [ ] Optional AI-assisted triage — flag likely-toxic messages for human review (never auto-action without a human-in-the-loop toggle)
- [ ] Plugin architecture so a host can drop in a custom command/module without forking core
- [ ] Web dashboard (self-hosted, same box) as an alternative to slash-command config — explicitly optional, bot must be fully usable without it
- [ ] Cross-server ban-list sharing for trusted server networks (opt-in, host-controlled trust list — never a shared cloud service by default)
- [ ] Audit-log export (CSV/JSON) for servers that need compliance records

Every item above should be gated so a host running only the core feels no weight from the features they haven't turned on.

## 6. Self-Hosting Requirements

What has to exist before this counts as "actually self-hostable," not just runnable by the original author:

- **README quickstart** under 10 steps: create a Discord application, invite the bot with the right scopes/permissions, copy `.env.example` to `.env`, fill in the token, run one command.
- **In-Discord `/setup` wizard** covers everything past that quickstart — mod-log channel, auto-mod thresholds, permission roles, enabling optional modules. Once the container is running, a no-skills host never opens a config file, edits YAML, or touches code again.
- **`.env.example`** committed with every variable named and commented — no variable required that isn't listed there.
- **Docker Compose file** as the primary path, with the SQLite volume mounted so data survives a container rebuild.
- **Health check / startup validation**: on boot, the bot checks for required intents, valid token, and writable data directory, and fails loudly with a specific fix instead of a stack trace.
- **Backup guidance**: one documented command or script to back up the database file/volume.
- **Upgrade guide**: how to pull a new version and run migrations without losing data — tested, not assumed.
- **No mandatory external accounts.** Optional integrations (AI moderation, uptime pings) are clearly marked optional in both docs and `.env.example`.
- **Resource baseline documented**: idle RAM/CPU footprint stated in the README so a host on a small VPS knows what they're committing to before installing.

## 7. Security & Privacy Guidelines

- Bot token, database credentials, and any AI/API keys stay in `.env` — never committed, `.gitignore` covers it from day one.
- Store only what moderation actually needs: message content is logged for auto-mod matches only when the host opts in, and even then should be truncatable/expirable via a retention setting.
- Every mod action logged with actor, target, reason, and timestamp — this is for the host's own accountability and dispute resolution, not for us.
- Default to the least-privileged Discord intents and permissions; document exactly which ones are required vs. optional and why.
- If AI-assisted moderation ships, message content sent to an external API must be opt-in, clearly disclosed in docs, and the host must supply their own API key — never proxied through a service the project runs.
- No phone-home telemetry, analytics, or update-check pinging without an explicit, off-by-default opt-in the host can see in the config.

## 8. Contribution & Coding Standards

- One command = one file/module where practical; commands are self-contained enough that a host can delete a file to disable a feature they don't want.
- Type-check or lint on every commit (TypeScript strict mode, or Python type hints + mypy if that stack is chosen).
- Every PR touching a config option updates `.env.example` and the README in the same PR — docs drift is treated as a bug.
- Tests for auto-mod logic and permission gating are required; UI/embed formatting can stay manual-tested.
- Commit messages and PR descriptions should note any new intent, permission, or external dependency introduced — this is what a self-hoster reads before upgrading.
