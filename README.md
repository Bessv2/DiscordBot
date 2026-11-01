# Discord Moderation Bot

A self-hostable Discord moderation and utility bot. No third-party dashboard, no subscription, no cloud account holding your server's data — you run it, you own the database. See [`PROJECT.md`](./PROJECT.md) for the full project guidelines this bot is built against.

**Never set up a bot before?** Follow [Setup, step by step](#setup-step-by-step) below. It assumes no technical background. You only copy and paste, there's no coding, and it takes about 20 minutes. Already comfortable with Docker? Skip to the [short version](#short-version-for-docker-users).

## Setup, step by step

**What you need:**
- A computer running Windows 10/11, macOS, or Linux. The bot only runs while this computer is on, so see [Keeping it running](#keeping-it-running) if you want it online 24/7.
- A Discord account with **Manage Server** permission on the server you want to add the bot to. Owning the server is enough.
- About 2 GB of free disk space.

You'll install one free program (Docker Desktop), download the bot, give it a password-like "token" from Discord, and start it. Every bot setting after that is changed inside Discord itself.

### Step 1 — Install Docker Desktop

Docker is the free program that runs the bot for you, so you don't have to install anything else.

1. Go to <https://www.docker.com/products/docker-desktop/> and download Docker Desktop for your system.
   - **Mac:** pick **Apple Silicon** if your Mac has an M1/M2/M3/M4 chip, or **Intel** otherwise. Not sure? Click the Apple menu → **About This Mac** and look at **Chip**.
   - **Linux / Raspberry Pi:** you don't need Docker Desktop. In a terminal, run `curl -fsSL https://get.docker.com | sh`, then `sudo usermod -aG docker $USER`, then log out and back in.
2. Run the installer and accept the defaults.
   - **Windows:** if it asks about **WSL 2**, leave it ticked. Restart your computer if it asks you to.
3. Open **Docker Desktop**. Accept the terms. You can click **Skip** or **Continue without signing in**, because you don't need a Docker account.
4. Wait until the bottom-left corner of Docker Desktop says **Engine running**. Leave Docker Desktop open in the background.

### Step 2 — Download the bot

1. At the top of this page, click the green **Code** button, then **Download ZIP**.
2. Unzip it:
   - **Windows:** right-click the downloaded file → **Extract All** → **Extract**.
   - **Mac:** double-click the downloaded file.
3. Move the unzipped folder somewhere easy to find, such as your Documents folder. The bot keeps its database in this folder, so don't delete it later.

Open the folder. You should see files named `docker-compose.yml`, `Dockerfile` and `.env.example`. If you only see one folder inside, open it: that inner folder is "the bot folder" for the rest of this guide.

> Know git? `git clone https://github.com/Bessv2/DiscordBot.git` works too, and makes updating easier.

### Step 3 — Create your bot on Discord and copy its token

1. Go to <https://discord.com/developers/applications> and log in with your Discord account.
2. Click **New Application** (top right). Give it a name, for example "Mod Bot". Tick the box to agree, then click **Create**.
3. Optional: on this first page you can upload an icon. It becomes the bot's profile picture.
4. In the left menu, click **Bot**.
5. Click **Reset Token**, then **Yes, do it!** Discord may ask for your password or a 2-factor code. Click **Copy** next to the long code that appears.

That code is your **bot token**. Keep this browser tab open, because you'll paste the token in the next step. **Treat it like a password.** Anyone who has it can control your bot. Discord only shows it once, but if you lose it you can click **Reset Token** again and use the new one.

> **Optional extra features.** Further down the same **Bot** page, under **Privileged Gateway Intents**, there are three switches. You don't need any of them for moderation commands to work. Each one unlocks a few features:
>
> | Switch on Discord | Turns on | Line to change in `.env` (step 4) |
> | --- | --- | --- |
> | **Message Content Intent** | Invite-link filter, banned-word filter, mention-spam detection, `!` commands | `ENABLE_MESSAGE_CONTENT=true` |
> | **Server Members Intent** | Welcome/goodbye messages, anti-raid join detection | `ENABLE_GUILD_MEMBERS=true` |
> | **Presence Intent** | `/activityrole` (roles based on the game someone is playing) | `ENABLE_PRESENCE=true` |
>
> You need to do **both**: flip the switch here and click **Save Changes**, *and* change the matching line in `.env`. If you change `.env` but forget the switch, the bot won't start, and its log will tell you which switch is missing.

### Step 4 — Give the bot its token

The bot reads its settings from a file called `.env` in the bot folder. You make it by copying the example file.

**First, open a terminal in the bot folder.** A terminal is a window where you type commands. You'll only paste a few.

- **Windows:** open the bot folder in File Explorer. Click the address bar at the top, so the folder path turns blue, type `powershell`, and press **Enter**. A blue or black window opens, already pointed at the bot folder.
- **Mac:** open the **Terminal** app (press Cmd+Space and type "Terminal"). Type `cd` followed by a space. Don't press Enter yet. Drag the bot folder from Finder into the Terminal window, then press **Enter**.
- **Linux:** right-click inside the folder → **Open in Terminal**.

**Then create `.env` and open it.** Paste the line for your system into the terminal, then press **Enter**:

| System | Paste this |
| --- | --- |
| Windows | `copy .env.example .env; notepad .env` |
| Mac | `cp .env.example .env && open -e .env` |
| Linux | `cp .env.example .env && nano .env` |

A text editor opens with the new `.env` file. Find this line near the top:

```
DISCORD_TOKEN=
```

Paste your token straight after the `=`, with no spaces and no quotes, so it looks like `DISCORD_TOKEN=MTI3NDk...`. That's the only line you have to fill in, because everything else already has a working default. If you switched on any optional features in step 3, change their lines from `false` to `true` too.

Save the file and close the editor. In Notepad or TextEdit, use **File → Save**. In nano, press Ctrl+O, Enter, then Ctrl+X.

> Edit the file named **`.env`**, not `.env.example`. The bot never reads `.env.example`, because it's only a template.

### Step 5 — Start the bot

In the same terminal window, paste this and press **Enter**:

```
docker compose up -d
```

The first time, this takes a minute or two while Docker downloads the ready-made bot. That's normal. When you get your prompt back and it says the container is **Started**, the bot is running in the background. You can close the terminal now and the bot keeps running.

> **Want updates to install themselves?** Before running the command above, open `.env` again and change `COMPOSE_PROFILES=` to `COMPOSE_PROFILES=autoupdate`. See [Updating](#updating-to-a-new-version).

### Step 6 — Add the bot to your server

The bot writes your personal invite link in its log the first time it starts.

1. In Docker Desktop, click **Containers** in the left menu, then click **discord-mod-bot**. The **Logs** tab opens.
   - In a terminal, you can see the same thing with `docker compose logs bot`.
2. Look for the line:
   ```
   The bot isn't in any server yet. Open this link in your browser to add it to one:
       https://discord.com/api/oauth2/authorize?client_id=...
   ```
   You should also see `Logged in as YourBot#1234` and `Registered 37 slash commands globally`.
3. Copy that link into your browser. Pick your server, click **Continue**, and then click **Authorize**. Leave the permissions ticked: they're the ones the bot needs.

**One more click that's easy to miss:** in Discord, open **Server Settings → Roles** and drag the bot's role (it has the bot's name) **above** the roles of the members it should be able to moderate. Discord only lets a bot kick, ban, time out or give roles to members whose highest role is *below* its own.

> Red text in the log instead? Each error comes with a line starting `-> Fix:` that says what to do. Check [Troubleshooting](#troubleshooting) below too.

### Step 7 — Set it up inside Discord

In any channel on your server, type `/setup` and pick it from the menu that pops up. Only you can see what it shows.

It opens on a **feature map**: every feature the bot has, with ✅ on, ⬜ off, or ⚠️ on but needing something (like a channel to post in). From there:
- **🚀 Quick start** walks you through the three essentials: the mod-log channel, auto-moderation, and who can moderate.
- **Pick any feature** from the menu to turn it on or off and choose its channels and roles: welcome messages, levels and role rewards, starboard, birthdays, music and watch parties, game-night maps, and the rest.
- **Skip** is on every screen. Nothing is required, and every feature works with sensible defaults. **Skip for now** closes the wizard, and you can come back with `/setup` any time.

Changes save the moment you make them.

`/setup` not showing up yet? The first time, Discord can take a few minutes to show a new bot's commands. Wait a few minutes, then restart Discord or press Ctrl+R (Cmd+R on Mac).

### Step 8 — You're done

Try `/warn`, `/timeout`, `/cases`, `/userinfo`, `/poll` or `/remind`. Type `/` in Discord to see every command. Change any setting later with `/config`, without touching any files.

## Keeping it running

- **The bot runs only while your computer is on and Docker Desktop is running.** Docker restarts the bot by itself if it crashes, and starts it again whenever Docker Desktop starts.
- **To have it come back after a reboot:** open Docker Desktop → **Settings** (gear icon) → **General** → tick **Start Docker Desktop when you sign in to your computer**.
- **To stop the bot:** click the ■ stop button next to **discord-mod-bot** in Docker Desktop. Click ▶ to start it again.
- **For 24/7 uptime** without leaving a PC on: run the same steps on a Raspberry Pi or a cheap ($5/month) Linux VPS, or use [Railway](./docs/RAILWAY.md), which doesn't need a computer at all.

Your data (settings, case history, levels, and so on) lives in the `data` folder inside the bot folder. **To back it up, stop the bot and copy that `data` folder somewhere safe.** See [`docs/BACKUP.md`](./docs/BACKUP.md) for an automatic option.

## Updating to a new version

New versions are published as ready-made images, so updating never means downloading the bot again or rebuilding it. Your settings and data stay where they are.

**Automatic (recommended):** in `.env`, set `COMPOSE_PROFILES=autoupdate`, then run `docker compose up -d` once. From then on, the bot checks for a new version once a day at 04:00 and installs it by itself, with a quick restart. It's off unless you turn it on, because it means your computer checks GitHub daily. To turn it off again, empty that line and run `docker compose up -d`.

**By hand, whenever you like:** open a terminal in the bot folder and run:

```
docker compose pull
docker compose up -d
```

The first line downloads the new version, and the second restarts the bot on it.

Either way, database changes are applied automatically and slash commands update by themselves. See [`docs/UPGRADING.md`](./docs/UPGRADING.md) for details. Occasionally a release also needs a new file from this repo, such as a new `docker-compose.yml`. When that happens, the release notes say so.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `docker` is not recognized / `command not found` | Docker Desktop isn't installed, or the terminal was opened before you installed it. Close the terminal, make sure Docker Desktop is open, and open a new terminal. |
| `Cannot connect to the Docker daemon`, or `error during connect` | Docker Desktop isn't running. Open it and wait for **Engine running**, then try again. |
| `env file ... .env not found` | You haven't made `.env` yet, or it isn't in the bot folder. Redo step 4. On Windows, make sure Notepad didn't save it as `.env.txt`. |
| `manifest unknown`, `denied`, or `pull access denied` for `ghcr.io/bessv2/discordbot` | The ready-made image isn't published yet (or your `BOT_IMAGE_TAG` is misspelled). Build it yourself instead: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`. |
| `no configuration file provided: not found` | The terminal isn't in the bot folder. Open the terminal from the folder that contains `docker-compose.yml` (step 4). |
| Log says `DISCORD_TOKEN: DISCORD_TOKEN is required` | The token line in `.env` is empty or wasn't saved. Paste the token again and save. Then run `docker compose up -d` to restart. |
| Log says `Discord rejected the bot token` | The token is wrong or was reset. Copy a fresh one from the **Bot** tab (**Reset Token**), not the "Client Secret" on the OAuth2 tab. Put it in `.env`, then run `docker compose up -d`. |
| Log says `disallowed intents` | You set an `ENABLE_...=true` line in `.env` but didn't flip the matching switch on Discord (see the table in step 3). Flip it and click **Save Changes**, or set the line back to `false`. Then run `docker compose up -d`. |
| No invite link in the log | It's only printed while the bot isn't in a server yet. Once it's in one, the log shows `Invite link (to add the bot to another server)`. |
| Slash commands don't show up | Wait a few minutes and restart Discord. Check the log says `Registered ... slash commands`. Make sure you invited the bot with the link from its log. |
| The bot says it can't kick/ban/time out someone, or `Missing Permissions` | Drag the bot's role higher in **Server Settings → Roles** (step 6). It can never act on the server owner or on anyone with a higher role. |
| A box saying `Update available 5.x -> ...` with `npm i prisma@latest` | Ignore it, and **don't** run those commands. It comes from the database tool the bot uses, and upgrading it yourself can break the bot. Current versions of this bot switch the check off. If you still see it, follow [Updating](#updating-to-a-new-version). |
| Windows: `WSL 2 installation is incomplete` / `WSL needs updating` | Right-click the Start button → **Terminal (Admin)**, run `wsl --update`, then restart your computer. |

**Applying a change to `.env`:** any time you edit `.env`, run `docker compose up -d` in the bot folder so the bot picks it up. Restarting the container from Docker Desktop does **not** re-read `.env`.

Still stuck? Open an issue with what you did and the last ~20 lines of the log. Copy them from Docker Desktop's **Logs** tab, and **remove your token first** if it appears anywhere.

## Short version (for Docker users)

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications) → **Bot** → **Reset Token** → copy it. Optionally enable the privileged intents you want (see [Privileged intents](#privileged-intents--whats-required-vs-optional)).
2. `git clone https://github.com/Bessv2/DiscordBot.git && cd DiscordBot`
3. `cp .env.example .env` and set `DISCORD_TOKEN` (plus any `ENABLE_*` flags matching the intents you enabled).
4. `docker compose up -d` (pulls `ghcr.io/bessv2/discordbot:latest`; add `-f docker-compose.build.yml --build` to build from source instead)
5. `docker compose logs bot`, then open the invite link it prints. It requests `bot` + `applications.commands` with only the permissions the bot uses.
6. Move the bot's role above the roles it should moderate, then run `/setup` in your server.

Slash commands are registered automatically on startup whenever their definitions change (global by default; set `DISCORD_GUILD_ID` to register in one guild instantly). Migrations run automatically from the container entrypoint. Images are multi-arch (amd64, arm64) and rebuilt by GitHub Actions on every push to `main` and weekly; `COMPOSE_PROFILES=autoupdate` adds a pinned, label-scoped [Watchtower](https://github.com/nicholas-fedor/watchtower) that only updates this container.

### Running without Docker

Needs Node.js 22.12+. For `/music`, also install `ffmpeg` and [`yt-dlp`](https://github.com/yt-dlp/yt-dlp#installation) so both are on the `PATH`.

```bash
npm ci
npm run build
npm run db:migrate
npm run start
```

Use [pm2](https://pm2.keymetrics.io/) (`pm2 start dist/index.js --name discord-mod-bot`) to keep it running and restart on crash.

### Deploying on Railway

If you'd rather not manage a VPS, see [`docs/RAILWAY.md`](./docs/RAILWAY.md) — connects this repo to [Railway](https://railway.com) and builds the same `Dockerfile` you'd use locally. (No "Deploy on Railway" button here — that needs a published Railway Template from a live account, which a repo file can't create on its own; the doc explains why and how to get one later if you want it.)

## Music and watch parties

There are two ways to listen together, and you can use both:

| | `/jam` (Watch Together) | `/music` (the bot plays) |
| --- | --- | --- |
| How it works | Opens Discord's own YouTube **Watch Together** activity in your voice channel. Everyone watches and hears it in sync and can queue videos and playlists. | The bot joins your voice channel and plays songs, playlists or searches from YouTube, with a shared queue, skip, shuffle and pause. |
| Setup | None. On for every server. | Off by default. Its host turns it on (below). |
| Cost to run | Nothing: Discord does the streaming. | About 100–200 MB more RAM while playing, plus some CPU for ffmpeg. Nothing while idle. |
| YouTube's rules | Official Discord feature. | Streaming YouTube through a bot is against YouTube's Terms of Service. That's the host's call. |

**Turning on `/music` (for whoever runs the bot):** in `.env`, set `ENABLE_MUSIC=true` **and** `BOT_IMAGE_TAG=music` (the image that includes ffmpeg and yt-dlp), then run `docker compose up -d`. The log should say `Music is on: ffmpeg and yt-dlp found.` Because YouTube changes often, the music image updates yt-dlp each time it starts. Set `MUSIC_AUTO_UPDATE=false` to stop that.

Server admins can pick a **DJ role** in `/setup` → Music. Then only DJs, moderators, or whoever queued a song can skip or remove it. The bot only accepts YouTube links (anything else is treated as a search), skips live streams and videos over 3 hours, and leaves voice when the queue has been empty for 5 minutes or everyone else has left.

## Resource baseline

Idle footprint on a single small guild is roughly **60-100MB RAM** and negligible CPU — comfortable on a $5/month VPS or a Raspberry Pi. No Redis, no message queue, and no separate database server required at this scale (SQLite is the default). The optional integrations (`/streamwatch`, birthdays) poll on a 5-minute timer rather than holding connections open, so turning them on doesn't change this baseline meaningfully — the cost scales with how many channels/streamers you watch, not with being enabled at all.

## Features

**Core moderation**
- Warn / kick / ban / timeout / mute, each logged to a per-guild, sequentially numbered case history (`/cases`) — `/mute` is role-based and has no time cap, unlike native `/timeout`'s 28-day limit
- Auto-mod: message-flood detection, invite-link filtering, word/phrase filter, mention-spam limits, with per-channel exemptions (`/config channel-override`)
- Anti-raid join-rate detection with optional auto-lockdown (`/lockdown`)
- Appeal flow: a DM button on every mod action opens a modal, routes to a review channel with Accept/Deny
- Rich embed mod-log, posted to a channel you choose
- Role-based permission gates per command scope — on top of, or instead of, Discord's own permission model
- Slash commands first; legacy `!prefix` commands available as an opt-in

**Utility**
- `/userinfo`, `/serverinfo`, `/remind`, `/poll`
- `/setup`: a feature map of everything the bot does, where you turn each feature on or off and pick its channels and roles. `/config` covers the same settings as commands.

**Community & fun** (all opt-in, zero cost unless turned on)
- `/tag` custom commands, `/quote` archive, `/roll` `/coinflip` `/8ball`
- `/xp` leveling with role rewards, `/rank`, `/leaderboard`
- `/starboard`, `/reactionrole` self-assignment
- `/economy` (balance/daily/slots), `/trivia` (with custom question import)
- `/welcome` / goodbye messages, `/birthday` tracker
- `/gameserver` status lookup (Minecraft, Valheim, Ark, ~180 others via [gamedig](https://github.com/gamedig/node-gamedig))
- `/gamestats` (Steam, League of Legends — needs an API key), `/streamwatch` (Twitch/YouTube live alerts — needs API credentials)
- `/activityrole` (auto-role from Rich Presence), `/lfg` (looking-for-group posts), `/tournament` (bracket tracker)
- `/map`: per-game map pools for game nights; pick at random or open a Discord poll to vote
- `/jam` (YouTube Watch Together in voice) and opt-in `/music` (the bot plays YouTube songs and playlists), see [Music and watch parties](#music-and-watch-parties)

Any of these can be switched off per server from `/setup`. A switched-off feature's commands say so, and its background work (stream polling, birthday posts, reaction roles) stops for that server.

See [`PROJECT.md`](./PROJECT.md) for what's still on the roadmap (plugin architecture, AI-assisted triage, a web dashboard, cross-server features).

## Privileged intents — what's required vs. optional

| Intent | Required for | Notes |
| --- | --- | --- |
| Guilds | Everything | Always on, not privileged |
| Guild Messages | Flood-based spam detection, prefix commands, XP gain | Always on, not privileged |
| Guild Message Reactions | Starboard, reaction-roles | Always on, not privileged |
| Guild Voice States | `/jam` and `/music` finding which voice channel you're in | Always on, not privileged; a small cache of who is in voice |
| **Message Content** (privileged) | Invite-link filter, word filter, mention-spam detection, legacy prefix commands, starboard message text | **Opt-in** via `ENABLE_MESSAGE_CONTENT=true` in `.env`. |
| **Guild Members** (privileged) | Welcome/goodbye messages, anti-raid join tracking, birthday-role cleanup | **Opt-in** via `ENABLE_GUILD_MEMBERS=true` in `.env`. |
| **Presence** (privileged) | `/activityrole` (reading Rich Presence game activity) | **Opt-in** via `ENABLE_PRESENCE=true` in `.env` — the most invasive one here, off by default. |

Every slash command, warn/kick/ban/timeout/mute, and flood-based spam detection work with all three privileged intents off. The bot checks this at startup and logs a clear warning if a guild has turned on a feature that needs an intent you haven't enabled, instead of silently doing nothing.


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
- [`docs/TESTING.md`](./docs/TESTING.md) — a self-contained walkthrough for a friend/tester to clone this, stand up their own bot, and try it against a throwaway server.

## Health checks & troubleshooting

On boot the bot validates the database is reachable/writable and that the token is valid before it tries to connect to Discord's gateway, and fails with a specific fix instead of a raw stack trace. Check `docker compose logs -f` first if something isn't working.

## Security & privacy

- No telemetry or analytics. The bot itself never checks for updates. The only update checks are opt-in: the auto-updater (`COMPOSE_PROFILES=autoupdate`, daily, to GitHub's image registry) and, only with music on, yt-dlp updating itself at startup (`MUSIC_AUTO_UPDATE`).
- Message content is only stored (truncated, attached to auto-mod hits in the mod-log) if you explicitly enable `/config wordfilter` logging behavior — see [`PROJECT.md` §7](./PROJECT.md#7-security--privacy-guidelines).
- Every moderation action is logged with actor, target, reason, and timestamp for your own accountability record — that data never leaves your database.

## Development

```bash
npm ci
npm run dev            # tsx watch — restarts on file change
npm run lint
npm run typecheck
npm test
```

To run your local code changes in Docker, build from source with `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

Set `DISCORD_GUILD_ID` in `.env` while developing so commands register instantly in that one server instead of globally. The bot re-registers on startup whenever a command definition changes; it keeps a hash in `data/.commands-hash`, so delete that file to force a re-register (or run `npm run deploy-commands:dev`).
