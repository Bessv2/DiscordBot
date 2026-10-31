import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma } from '../../lib/db';

export const leaderboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top members by XP or economy balance.')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Which leaderboard')
        .setRequired(true)
        .addChoices({ name: 'XP', value: 'xp' }, { name: 'Economy', value: 'economy' }),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const type = interaction.options.getString('type', true);
    const guildId = interaction.guild.id;

    if (type === 'xp') {
      const top = await prisma.userXp.findMany({ where: { guildId }, orderBy: { xp: 'desc' }, take: 10 });
      if (top.length === 0) {
        await interaction.reply({ content: 'No XP data yet.', ephemeral: true });
        return;
      }
      const lines = top.map((u, i) => `**${i + 1}.** <@${u.userId}> — level ${u.level} (${u.xp} XP)`);
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle('XP Leaderboard').setDescription(lines.join('\n'))] });
      return;
    }

    const top = await prisma.wallet.findMany({ where: { guildId }, orderBy: { balance: 'desc' }, take: 10 });
    if (top.length === 0) {
      await interaction.reply({ content: 'No economy data yet.', ephemeral: true });
      return;
    }
    const lines = top.map((w, i) => `**${i + 1}.** <@${w.userId}> — ${w.balance} coins`);
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Economy Leaderboard').setDescription(lines.join('\n'))] });
  },
};
