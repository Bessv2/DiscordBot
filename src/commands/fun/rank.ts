import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma } from '../../lib/db';
import { levelForXp, xpToNextLevel, totalXpForLevel } from '../../lib/xp';

export const rankCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show your (or someone else\'s) level and XP.')
    .addUserOption((o) => o.setName('user').setDescription('Defaults to yourself').setRequired(false))
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const targetUser = interaction.options.getUser('user') ?? interaction.user;

    const userXp = await prisma.userXp.findUnique({
      where: { guildId_userId: { guildId: interaction.guild.id, userId: targetUser.id } },
    });
    const xp = userXp?.xp ?? 0;
    const level = levelForXp(xp);

    const embed = new EmbedBuilder()
      .setAuthor({ name: targetUser.tag, iconURL: targetUser.displayAvatarURL() })
      .addFields(
        { name: 'Level', value: `${level}`, inline: true },
        { name: 'XP', value: `${xp}`, inline: true },
        { name: 'Next level', value: `${xpToNextLevel(xp)} XP to go (at ${totalXpForLevel(level + 1)})`, inline: true },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
