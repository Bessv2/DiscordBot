# Deploying on Railway

Railway is a good fit if you'd rather not manage a VPS yourself: you connect
this repo, Railway builds the existing `Dockerfile`, and it stays running on
their infrastructure. This is still self-hosting in the spirit of
`CLAUDE.md` §1 — it's **your** Railway account and **your** database, not a
shared service this project runs — just on someone else's hardware instead
of a Pi or a $5 VPS.

> **No "Deploy on Railway" button here on purpose.** That button only works
> once a project is published as a Railway Template through their dashboard,
> which needs a Railway account and can't be done from a repo file alone. A
> button pointing at a template that doesn't exist yet would just be a dead
> link. The steps below use Railway's standard "deploy from a GitHub repo"
> flow instead, which works today with zero extra setup. If you want a real
> one-click button later, see **Publishing your own template** at the
> bottom.

## 1. Connect the repo

1. Go to [railway.com/new](https://railway.com/new) and sign in.
2. **Deploy from GitHub repo** → pick this repository (fork it to your own
   account first if you don't have push access to the original).
3. Railway detects the `Dockerfile` at the repo root automatically — no
   build configuration needed. `railway.json` in this repo pins the builder
   to Dockerfile explicitly, just in case.

## 2. Add a persistent volume

This is the one step that's easy to miss and will cost you your data if you
skip it: without a volume, every redeploy wipes the SQLite database.

1. Open the service → **Settings** → **Volumes** → **New Volume**.
2. Mount path: `/app/data` (matches where the bot writes `bot.db`, same as
   the `./data:/app/data` mount in `docker-compose.yml`).

## 3. Set environment variables

Open the service → **Variables** and add everything from
[`.env.example`](../.env.example) that applies to you. At minimum:

```
DISCORD_TOKEN=...
DATABASE_URL=file:../data/bot.db
```

Leave `DATABASE_URL` exactly as above — see the note in `.env.example` about
why it's `../data/bot.db` and not `./data/bot.db`. Everything else
(`ENABLE_MESSAGE_CONTENT`, the optional integration keys, etc.) is optional,
same as any other deployment.

**Music on Railway:** Railway builds the `Dockerfile` itself rather than
using the published image, so add `MUSIC=true` as well as
`ENABLE_MUSIC=true`. Railway passes variables to the build, and `MUSIC=true`
builds in ffmpeg and yt-dlp. (`BOT_IMAGE_TAG`, `COMPOSE_PROFILES` and `TZ`
only matter for Docker Compose, so you can leave them out here.)

## 4. Deploy, then invite the bot

Railway deploys automatically on push. The bot registers its own slash
commands on startup, so there's no extra step for that. Open the
deployment's **Deploy Logs** and look for the line
`The bot isn't in any server yet. Open this link in your browser...` —
that's your invite link. Then run `/setup` in your server.

## Upgrading

Push to the branch Railway is tracking — it rebuilds and redeploys
automatically, running `docker-entrypoint.sh` (which applies pending
migrations) on boot, same as the Docker Compose path. See
[`UPGRADING.md`](./UPGRADING.md) for the general migration story.

## Publishing your own template

If you want an actual clickable "Deploy on Railway" button — for your own
use later, or to share with others — that's a Railway Template, created
from your account once this is deployed and working:

1. [docs.railway.com/guides/templates](https://docs.railway.com/guides/templates)
   walks through publishing a project as a template.
2. Once published, Railway gives you the real button markdown (an image at
   `railway.com/button.svg` linking to `railway.com/new/template/<your-code>`)
   to drop into this README yourself.

This isn't something a repo file can do on its own — it has to come from a
live, working deployment in your account.
