// Example plugin: /duel challenges someone to a dice roll, and the bot
// answers "gg" when someone says "good game". Copy this file into the bot's
// plugins folder, set ENABLE_PLUGINS=true in .env, and restart.
//
// Plugins are plain CommonJS JavaScript. They can use anything the bot
// already has installed, like discord.js. See docs/PLUGINS.md.
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'dice-duel',
  version: '1.0.0',

  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('duel')
        .setDescription('Challenge someone to a dice roll.')
        .addUserOption((o) =>
          o.setName('opponent').setDescription('Who to duel').setRequired(true),
        ),
      // 'utility' = anyone can use it (the default). 'moderation' or 'admin'
      // use the same permission gates as the bot's own commands.
      scope: 'utility',
      async execute(interaction, ctx) {
        const opponent = interaction.options.getUser('opponent', true);
        const a = 1 + Math.floor(Math.random() * 6);
        const b = 1 + Math.floor(Math.random() * 6);
        const result = a === b ? "It's a draw!" : `${a > b ? interaction.user : opponent} wins!`;
        ctx.log.info(`duel in ${interaction.guildId}`);
        await interaction.reply(
          `🎲 ${interaction.user} rolled **${a}**, ${opponent} rolled **${b}**. ${result}`,
        );
      },
    },
  ],

  // Optional: runs once when the bot is connected.
  async onReady(ctx) {
    ctx.log.info(`ready in ${ctx.client.guilds.cache.size} server(s)`);
  },

  // Optional: every message in servers where Plugins are switched on.
  // Message text is only available when the host turned on Message Content.
  async onMessage(message) {
    if (/^good game\b/i.test(message.content))
      await message.reply({ content: 'gg 🤝', allowedMentions: { parse: [] } });
  },
};
