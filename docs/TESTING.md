# Test-Driving This Bot

You've been invited to try out this Discord bot before it's published. This walks through getting your own copy running against a test Discord server — nothing here touches the "real" deployment, and nothing you do here can break it for anyone else.

## 1. Get the code

```bash
git clone https://github.com/Bessv2/DiscordBot.git
cd DiscordBot
git checkout test
```

Use the `test` branch, not `main` — `main` is currently just a placeholder; all the code lives on `test` until it's reviewed and merged.

## 2. Create a Discord bot application

1. Go to https://discord.com/developers/applications → **New Application**.
2. **Bot** tab → **Reset Token** → copy it. This is your `DISCORD_TOKEN`. Treat it like a password — don't paste it anywhere public, and don't commit it.
3. **General Information** tab → copy the **Application ID**. This is your `DISCORD_CLIENT_ID`.
4. (Optional) If you want to try the invite-link filter, word filter, or mention-spam detection, go back to the **Bot** tab and enable **Message Content Intent** under Privileged Gateway Intents. Everything else — every slash command, warn/kick/ban/timeout, flood-based spam detection — works without this.

## 3. Invite the bot to a test server

Use a server you own or have admin on — ideally a throwaway test server, since you'll be running moderation commands against it.

- **OAuth2 → URL Generator** tab → scopes: `bot` and `applications.commands`
- Permissions: at minimum Kick Members, Ban Members, Moderate Members, Manage Messages, View Channels, Send Messages, Embed Links
- Open the generated URL and add the bot to your test server

## 4. Configure and start it

```bash
cp .env.example .env
```

Open `.env` and fill in `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` from step 2. Every other variable already has a working default — see `.env.example` for what each one does.

**With Docker (recommended):**
```bash
docker compose up -d
docker compose exec bot npm run deploy-commands
docker compose logs -f
```

**Without Docker:**
```bash
npm ci
npm run build
npm run db:migrate
npm run deploy-commands
npm run start
```

Either way, you should see something like:
```
Logged in as YourBot#1234 — serving 1 guild(s).
```
in the logs. If you see an error instead, it should tell you specifically what's wrong and how to fix it (bad token, missing intent, unwritable data directory, etc.) rather than a raw stack trace — that's intentional, and if it isn't, that's a bug worth reporting.

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
