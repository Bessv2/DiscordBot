# Plugins

Plugins let whoever runs the bot add their own slash commands and message reactions without changing the bot's code. A plugin is one JavaScript file in the `plugins` folder.

> **A plugin can do anything the bot can.** It runs inside the bot, with its token and its database. Only add plugins you wrote, have read, or trust as much as the bot itself. That's why plugins are off by default, only load from a folder you control, and there is no plugin store.

## Turning plugins on

1. Put the plugin's `.js` file in the `plugins` folder inside the bot folder (next to `docker-compose.yml`).
2. In `.env`, set `ENABLE_PLUGINS=true`.
3. Run `docker compose up -d` (or restart the bot). The log lists each plugin it loaded, or says why it skipped one.

Docker mounts the folder read-only at `/app/plugins`. Without Docker the folder is `./plugins`; `PLUGINS_DIR` points somewhere else, but keep that folder inside the bot folder, or plugins can't use the packages the bot already has, such as `discord.js`.

Each server can switch all plugin commands off from `/setup` → **Plugins** (or the web dashboard). Plugin commands use the same permission gates as built-in ones, and they show up in `/help`.

## Writing one

Copy [`docs/plugins/dice-duel.js`](./plugins/dice-duel.js) and change it. A plugin exports an object:

```js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'my-plugin',          // 1-32 lowercase letters, numbers or dashes
  version: '1.0.0',           // optional, shown in the log
  commands: [
    {
      data: new SlashCommandBuilder().setName('hello').setDescription('Say hello'),
      scope: 'utility',       // 'utility' (anyone), 'moderation' or 'admin'
      permission: null,       // e.g. PermissionFlagsBits.ManageMessages: needed when a server hasn't picked roles
      async execute(interaction, ctx) {
        await interaction.reply('Hello!');
      },
    },
  ],
  async onReady(ctx) {},              // optional: once, when the bot is connected
  async onMessage(message, ctx) {},   // optional: every message in servers with Plugins on
};
```

`ctx` gives the plugin:

- `ctx.client`: the discord.js client.
- `ctx.log.info / warn / error`: writes to the bot's log, tagged with the plugin's name.
- `ctx.dataDir`: a folder of its own inside the bot's data folder (`data/plugins/<name>`), kept across updates and included in the bot folder's backups. Store files there; don't touch the bot's database.

Rules the bot enforces when it loads a plugin:

- A plugin can't replace a built-in command or another plugin's command; it's skipped with a log line saying why.
- A plugin that throws while loading is skipped; the bot starts without it.
- Errors inside `execute`, `onReady` and `onMessage` are caught and logged; they never crash the bot.
- Message text is only there when the host turned on Message Content (`ENABLE_MESSAGE_CONTENT`).
- The bot never pings `@everyone` or roles on a plugin's behalf unless the plugin passes `allowedMentions` itself.

New plugin commands are registered with Discord automatically when the bot starts.
