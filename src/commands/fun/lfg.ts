import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';
import { buildLfgButtons, buildLfgEmbed } from '../../lib/lfgActions';

export const lfgCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('lfg')
    .setDescription('Post a looking-for-group listing for a game session.')
    .addStringOption((o) => o.setName('game').setDescription('What you want to play').setRequired(true))
    .addIntegerOption((o) => o.setName('size').setDescription('Max group size, including you').setRequired(true).setMinValue(2).setMaxValue(50))
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const game = interaction.options.getString('game', true);
    const maxSize = interaction.options.getInteger('size', true);

    await getOrCreateGuildConfig(interaction.guild.id);
    const post = await prisma.lfgPost.create({
      data: {
        guildId: interaction.guild.id,
        channelId: interaction.channelId,
        game,
        hostId: interaction.user.id,
        maxSize,
        memberIds: JSON.stringify([interaction.user.id]),
      },
    });

    await interaction.reply({ embeds: [buildLfgEmbed(post)], components: [buildLfgButtons(post.id, false)] });
    const message = await interaction.fetchReply();
    await prisma.lfgPost.update({ where: { id: post.id }, data: { messageId: message.id } });
  },
};
