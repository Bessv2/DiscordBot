# Running the bot without Docker

Docker is the easiest way to run the bot (see the [README](../README.md#setup-step-by-step)), but you don't need it. This guide runs the same bot straight on **Windows, macOS, Linux or a Raspberry Pi** with only [Node.js](https://nodejs.org) installed. It's a good fit when Docker won't install (older Windows, no virtualization, a locked-down work machine), when a Pi or small VPS is short on memory or disk, or when you simply prefer not to run Docker.

What's the same: every feature, the `.env` file, the `data` folder, `/setup`, automatic database upgrades on start, daily backups.

What's different:

|                                  | Docker                               | Without Docker                               |
| -------------------------------- | ------------------------------------ | -------------------------------------------- |
| You install                      | Docker                               | Node.js 22.12 or newer                       |
| Updating                         | `docker compose pull` (or automatic) | `npm run update-bot` (or a new ZIP)          |
| Restarts after a crash or reboot | Docker does it                       | pm2, systemd, or your Startup folder (below) |
| Music (`/music`)                 | the `music` image has everything     | install ffmpeg and yt-dlp yourself           |
| Disk space                       | the image                            | about 310 MB in the bot folder               |
| Memory                           | 60–100 MB idle                       | the same (no Docker running underneath)      |

## Step 1 — Install Node.js

You need **Node.js 22.12 or newer** (the "LTS" version).

- **Windows / Mac:** download the **LTS** installer from <https://nodejs.org> and run it with the default options.
- **Linux / Raspberry Pi (Debian, Ubuntu, Raspberry Pi OS):** the version in `apt` is usually too old. Run:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  ```
  ```bash
  sudo apt-get install -y nodejs
  ```
  A Raspberry Pi needs the **64-bit** Raspberry Pi OS.

Check it worked: open a **new** terminal and run `node -v`. It should print `v22.12.0` or higher (any `v22`, `v24` or newer that is at least `22.12`).

## Step 2 — Download the bot

- **With git (recommended: updating is then one command):**
  ```bash
  git clone https://github.com/Bessv2/DiscordBot.git
  ```
- **Without git:** on the GitHub page click **Code → Download ZIP**, unzip it, and move the folder somewhere easy to find. If there's only one folder inside, that inner folder is "the bot folder".

## Step 3 — Create your bot on Discord

Follow [step 3 of the README](../README.md#step-3--create-your-bot-on-discord-and-copy-its-token): create the application, click **Reset Token** and copy the token. Keep it handy for the next step.

## Step 4 — Set it up and start it

Pick whichever is easier for you. Both do the same thing.

**Double-click (no terminal):**

- **Windows:** double-click `start-bot.cmd` in the bot folder. If Windows asks whether to run it, click **Run** (or **More info → Run anyway**).
- **Mac:** right-click `start-bot.command` → **Open** → **Open** (only the first time; macOS asks because it was downloaded).

**Or in a terminal** opened in the bot folder ([how to open one](../README.md#step-4--give-the-bot-its-token)):

```bash
npm run setup
```

```bash
npm run bot
```

The first run takes a minute or two. It checks your Node version, creates `.env` from `.env.example`, **asks you to paste your bot token** (nothing appears while you paste; press Enter after), installs what the bot needs, builds it and creates the database in `data/`. Later starts take a few seconds.

When you see `Logged in as YourBot#1234`, the bot is running. **Leave that window open**: closing it (or pressing Ctrl+C) stops the bot. To run it in the background instead, see [Keeping it running](#keeping-it-running).

Then carry on with the README from [step 6 (add the bot to your server)](../README.md#step-6--add-the-bot-to-your-server). The invite link is printed in this window rather than in Docker Desktop.

> Want the optional features that need a switch on Discord (welcome messages, word filter, …)? Change the matching `ENABLE_...=false` lines in `.env` to `true` (the table in the README's step 3), then restart the bot.

## Changing settings in `.env`

Edit `.env` in the bot folder (Notepad, TextEdit, nano), save, then restart the bot: Ctrl+C and start it again, or `pm2 restart discord-mod-bot`, or `sudo systemctl restart discord-mod-bot`. Everything per-server is still set inside Discord with `/setup`.

## Keeping it running

A bot started from a terminal stops when you close it or log out. Pick one of these to keep it running in the background, restart it if it crashes, and start it again after a reboot.

### Option A: pm2 (Mac, Linux, Raspberry Pi)

[pm2](https://pm2.keymetrics.io/) is a small, widely used process manager for Node.

```bash
npm install -g pm2
```

```bash
pm2 start ecosystem.config.cjs
```

```bash
pm2 save
```

```bash
pm2 startup
```

The last command prints one more command (starting with `sudo env PATH=...`). Copy and run it once; from then on the bot starts at boot. (On Linux, `npm install -g` may need `sudo` in front.)

Everyday use:

| To                                  | Run                                                      |
| ----------------------------------- | -------------------------------------------------------- |
| See the log (and the invite link)   | `pm2 logs discord-mod-bot`                               |
| Restart (after changing `.env`)     | `pm2 restart discord-mod-bot`                            |
| Stop / start                        | `pm2 stop discord-mod-bot` / `pm2 start discord-mod-bot` |
| Keep log files from growing forever | `pm2 install pm2-logrotate` (once)                       |

If the token is wrong, pm2 tries a few times with growing pauses and then gives up; the log tells you what to fix.

### Option B: Windows, start when you sign in

pm2 can't start things at boot on Windows, so use the Startup folder:

1. Press **Win + R**, type `shell:startup`, press Enter. A folder opens.
2. In another window, open the bot folder, right-click `start-bot.cmd` → **Show more options** → **Create shortcut**.
3. Move that shortcut into the Startup folder.

The bot now starts in its own window each time you sign in. To stop it, close that window. (pm2 from option A also works on Windows for keeping it running while you're signed in; it just can't do the "start at boot" part.)

### Option C: systemd (Linux servers and Raspberry Pi)

systemd is built into most Linux systems and is the standard way to run a service. A ready-made file is in [`deploy/discord-mod-bot.service`](../deploy/discord-mod-bot.service):

1. Run `npm run setup` once as your normal user first (so the token is in `.env` and everything is built).
2. Open `deploy/discord-mod-bot.service` and replace the three `CHANGE_ME` values: your user name (`whoami`), the bot folder (`pwd` inside it), and the folder Node is in (`dirname "$(command -v node)"`, e.g. `/usr/bin`).
3. Install and start it:
   ```bash
   sudo cp deploy/discord-mod-bot.service /etc/systemd/system/
   ```
   ```bash
   sudo systemctl daemon-reload
   ```
   ```bash
   sudo systemctl enable --now discord-mod-bot
   ```
4. Log (and the invite link): `journalctl -u discord-mod-bot -f`. Restart after changing `.env`: `sudo systemctl restart discord-mod-bot`.

Don't run the bot as `root`: the service file runs it as the user you name, who owns the bot folder.

## Updating to a new version

1. **Stop the bot** (Ctrl+C, `pm2 stop discord-mod-bot`, or `sudo systemctl stop discord-mod-bot`). On Windows this is required, because a running bot keeps its files locked.
2. **Update.**
   - **Used git:** in the bot folder, run
     ```bash
     npm run update-bot
     ```
     It backs up the database (to `data/backups/`), downloads the new version with `git pull`, reinstalls, rebuilds and upgrades the database. Your `.env` and `data` folder are never touched.
   - **Downloaded a ZIP:** download the new ZIP and unzip it to a **new** folder. Move your `.env` file and your `data` folder (and `plugins`, if you added any) from the old folder into the new one. Then run `npm run setup` in the new folder (or just double-click `start-bot` there). Keep the old folder until the new one is running, then delete it.
3. **Start it again** (`npm run bot`, `pm2 start discord-mod-bot`, or `sudo systemctl start discord-mod-bot`). Check the log for `Logged in as`.

Compare `.env.example` with your `.env` now and then: new optional settings appear there, and [`CHANGELOG.md`](../CHANGELOG.md) and [`UPGRADING.md`](./UPGRADING.md) say when one matters.

**Going back:** stop the bot, check out or download the older version, copy the backup from before the update over `data/bot.db` (see [`BACKUP.md`](./BACKUP.md)), run `npm run setup`, start.

## Music (`/music`)

Docker users get the tools in the `music` image; without Docker, install them yourself so `ffmpeg` and `yt-dlp` work in a terminal:

- **Windows:** `winget install Gyan.FFmpeg yt-dlp.yt-dlp`, then open a new terminal.
- **Mac:** `brew install ffmpeg yt-dlp` ([Homebrew](https://brew.sh)).
- **Linux / Pi:** `sudo apt-get install -y ffmpeg`, then yt-dlp's own download (the `apt` version goes out of date quickly):
  ```bash
  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  ```
  ```bash
  sudo chmod a+rx /usr/local/bin/yt-dlp
  ```

Then set `ENABLE_MUSIC=true` in `.env` and restart. The log should say `Music is on: ffmpeg and yt-dlp found.` On each start the bot runs `yt-dlp -U` to keep it current (only with music on; `MUSIC_AUTO_UPDATE=false` turns that off). That only works for yt-dlp's own download; if you installed it with winget, brew or pip, update it the same way from time to time. Read the README's [Music and watch parties](../README.md#music-and-watch-parties) first: streaming YouTube through a bot is against YouTube's Terms of Service.

## Web dashboard, backups, plugins

All work the same as with Docker:

- **Dashboard:** `ENABLE_DASHBOARD=true` in `.env` is enough. It listens on `http://localhost:3000` on the bot's computer only (change with `DASHBOARD_PORT`). See the README's [Web dashboard](../README.md#web-dashboard) for using it from elsewhere.
- **Backups:** a copy of the database is saved to `data/backups/` once a day (7 kept). Make one any time with `npm run backup`. See [`BACKUP.md`](./BACKUP.md).
- **Plugins:** `ENABLE_PLUGINS=true` and `.js` files in the `plugins` folder. See [`PLUGINS.md`](./PLUGINS.md).

## Troubleshooting

| What you see                                                                   | What to do                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` / `npm` is not recognized, or `command not found`                       | Node.js isn't installed, or the terminal was opened before you installed it. Install it (step 1), then open a new terminal.                                       |
| `This bot needs Node.js 22.12 or newer`                                        | Your Node is too old. Install the current LTS (step 1). On Linux, `apt`'s `nodejs` is usually too old; use the NodeSource commands.                               |
| `"npm ci ..." failed`, `EBUSY` or `EPERM` on Windows                           | The bot (or an editor) is still running and holds its files. Stop it, close other windows using the folder, and run the command again.                            |
| `npm ci` fails with `ENOSPC` or gets killed on a Raspberry Pi                  | Out of disk space or memory. Free up some space; on a Pi with 1 GB of RAM, close other programs while installing.                                                 |
| `The database could not be set up or upgraded`                                 | The `data` folder isn't writable by the user running the bot (common after first running it as `root` or with `sudo`). Fix the owner: `sudo chown -R $USER data`. |
| `DISCORD_TOKEN: DISCORD_TOKEN is required` or `Discord rejected the bot token` | Put the bot token in `.env` (`DISCORD_TOKEN=...`), copied from the **Bot** tab (Reset Token), then restart.                                                       |
| `disallowed intents`                                                           | An `ENABLE_...=true` line in `.env` doesn't have its switch on in the Developer Portal. See the README's step 3 table.                                            |
| Mac: `start-bot.command` "can't be opened" or does nothing                     | Right-click it → **Open**. If it still won't run, use the terminal commands in step 4.                                                                            |
| Anything else                                                                  | The README's [Troubleshooting](../README.md#troubleshooting) table applies too; just read "restart the bot" wherever it says `docker compose up -d`.              |
