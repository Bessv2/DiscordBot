import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { logger } from '../../lib/logger';

export const gameserverCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('gameserver')
    .setDescription('Check a self-hosted game server\'s live status.')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription("Game id — e.g. minecraft, valheim, ase (Ark: SE), csgo. See gamedig's games list.")
        .setRequired(true),
    )
    .addStringOption((o) => o.setName('host').setDescription('Hostname or IP').setRequired(true))
    .addIntegerOption((o) => o.setName('port').setDescription('Query port, if different from the default').setRequired(false)),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    const type = interaction.options.getString('type', true);
    const host = interaction.options.getString('host', true);
    const port = interaction.options.getInteger('port');

    await interaction.deferReply();

    try {
      // gamedig ships as an ESM-only package; this project is CommonJS, so
      // it has to be a dynamic import rather than a static one.
      const { GameDig } = await import('gamedig');
      const state = await GameDig.query({ type, host, ...(port ? { port } : {}) });

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(state.name || `${host}`)
        .addFields(
          { name: 'Map', value: state.map || 'Unknown', inline: true },
          { name: 'Players', value: `${state.numplayers}/${state.maxplayers}`, inline: true },
          { name: 'Ping', value: `${state.ping}ms`, inline: true },
        );
      if (state.players.length > 0) {
        embed.addFields({ name: 'Online', value: state.players.map((p) => p.name || 'Unknown').join(', ').slice(0, 1000) });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.debug(`Game server query failed for ${type}://${host}: ${(err as Error).message}`);
      await interaction.editReply(
        `Could not reach that server — it may be offline, the type/host/port may be wrong, or it may not respond to queries. (${(err as Error).message})`,
      );
    }
  },
};
