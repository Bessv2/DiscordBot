import { ChannelType, ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';

export const starboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Pin popular messages to a channel based on reaction count.')
    .addSubcommand((sc) =>
      sc
        .setName('config')
        .setDescription('Configure the starboard')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Where starred messages get posted').addChannelTypes(ChannelType.GuildText).setRequired(false),
        )
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji that triggers starring (default ⭐)').setRequired(false))
        .addIntegerOption((o) => o.setName('threshold').setDescription('Reactions needed to post (default 5)').setRequired(false)),
    )
    .addSubcommand((sc) => sc.setName('disable').setDescription('Turn off the starboard'))
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'disable') {
      await prisma.guildConfig.update({ where: { id: guildId }, data: { starboardChannelId: null } });
      await interaction.reply({ content: 'Starboard disabled.', ephemeral: true });
      return;
    }

    const channel = interaction.options.getChannel('channel');
    const emoji = interaction.options.getString('emoji');
    const threshold = interaction.options.getInteger('threshold');

    await getOrCreateGuildConfig(guildId);
    await prisma.guildConfig.update({
      where: { id: guildId },
      data: {
        ...(channel ? { starboardChannelId: channel.id } : {}),
        ...(emoji ? { starboardEmoji: emoji } : {}),
        ...(threshold !== null ? { starboardThreshold: threshold } : {}),
      },
    });

    const updated = await prisma.guildConfig.findUniqueOrThrow({ where: { id: guildId } });
    await interaction.reply({
      content: `Starboard: channel ${updated.starboardChannelId ? `<#${updated.starboardChannelId}>` : 'not set'}, emoji ${updated.starboardEmoji}, threshold ${updated.starboardThreshold}.`,
      ephemeral: true,
    });
  },
};
