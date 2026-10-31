# Test-Driving This Bot

A self-contained walkthrough for trying this bot out against a throwaway Discord server before running it for real — useful if you're evaluating it, contributing, or just want to see every feature before pointing it at your community. Nothing here touches anyone else's deployment.

## 1. Get the code

```bash
git clone https://github.com/Bessv2/DiscordBot.git
cd DiscordBot
```

## 2. Create a Discord bot application

1. Go to https://discord.com/developers/applications → **New Application**.
2. **Bot** tab → **Reset Token** → copy it. This is your `DISCORD_TOKEN`. Treat it like a password — don't paste it anywhere public, and don't commit it.
3. (Optional) If you want to try the invite-link filter, word filter, or mention-spam detection, go back to the **Bot** tab and enable **Message Content Intent** under Privileged Gateway Intents. Everything else — every slash command, warn/kick/ban/timeout, flood-based spam detection — works without this.

## 3. Configure and start it

`.env` is never committed to the repo — that's what would leak a bot token to anyone with clone access — so a fresh clone will only ever have `.env.example`. You need to create your own `.env` from it:

```bash
cp .env.example .env          # macOS/Linux/WSL
Copy-Item .env.example .env   # Windows PowerShell
copy .env.example .env        # Windows cmd.exe
```

Then open the new **`.env`** file (not `.env.example` — that one's just the template and is never read by the app) and fill in `DISCORD_TOKEN` from step 2. Every other variable already has a working default — see `.env.example` for what each one does.

**With Docker (recommended):**
```bash
docker compose up -d
docker compose logs -f bot
```

**Without Docker:**
```bash
npm ci
npm run build
npm run db:migrate
npm run start
```

Either way, you should see something like:
```
Logged in as YourBot#1234 — serving 0 guild(s).
The bot isn't in any server yet. Open this link in your browser to add it to one:
    https://discord.com/api/oauth2/authorize?client_id=...
Registered 37 slash commands globally.
```
in the logs. The bot registers its own slash commands on startup, so there's no separate step for that. If you see an error instead, it should tell you specifically what's wrong and how to fix it (bad token, missing intent, unwritable data directory, etc.) rather than a raw stack trace — that's intentional, and if it isn't, that's a bug worth reporting.

## 4. Invite the bot to a test server

Use a server you own or have admin on — ideally a throwaway test server, since you'll be running moderation commands against it. Open the invite link from the log above, pick the server, and authorize. Then in **Server Settings → Roles**, drag the bot's role above the role(s) of whatever alt account you'll test moderation on.

Slash commands can take a few minutes to appear the first time; restart Discord (Ctrl+R) if they don't. For instant registration while testing, set `DISCORD_GUILD_ID` in `.env` to your test server's ID and run `docker compose up -d` again.

## 5. Try it out

In your test server, run `/setup` first and walk through the wizard — it'll ask for a mod-log channel, whether to turn on auto-mod, and (optionally) which roles can use moderation vs admin commands.

Then try:
- `/warn`, `/kick`, `/ban`, `/timeout` on a throwaway/alt account, and check the mod-log channel gets an embed for each
- `/cases @user` to see the case history you just built up
- `/userinfo`, `/serverinfo`
- `/remind time:1m message:test` and wait a minute
- `/poll question:"pizza or tacos?" options:"pizza, tacos"`
- `/config view` to see current settings, and `/config modlog`, `/config automod`, `/config permissions` to change them without re-running `/setup`
- If `ENABLE_MESSAGE_CONTENT=true`: post a `discord.gg/...` link or spam a bunch of messages quickly and see auto-mod catch it

## What to report back

For anything that seems off: what you did, what you expected, what actually happened, and — if the bot crashed or logged an error — the relevant log lines from `docker compose logs` (or the terminal, if running without Docker). That's usually enough to track down.

## Cleaning up

```bash
docker compose down
```
Your test data lives in `./data/bot.db` — delete that file (or the whole `data/` folder) if you want to start over from a clean slate.
