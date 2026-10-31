import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const birthdayCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Set your birthday so the server can celebrate it.')
    .addSubcommand((sc) =>
      sc
        .setName('set')
        .setDescription('Set your birthday (year not stored)')
        .addIntegerOption((o) => o.setName('month').setDescription('1-12').setRequired(true).setMinValue(1).setMaxValue(12))
        .addIntegerOption((o) => o.setName('day').setDescription('1-31').setRequired(true).setMinValue(1).setMaxValue(31)),
    )
    .addSubcommand((sc) => sc.setName('remove').setDescription('Remove your saved birthday'))
    .addSubcommand((sc) => sc.setName('today').setDescription("Show whose birthday it is today"))
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const month = interaction.options.getInteger('month', true);
      const day = interaction.options.getInteger('day', true);
      if (month === 2 && day > 29) {
        await interaction.reply({ content: 'February only has up to 29 days.', ephemeral: true });
        return;
      }
      if ([4, 6, 9, 11].includes(month) && day > 30) {
        await interaction.reply({ content: `${MONTH_NAMES[month - 1]} only has 30 days.`, ephemeral: true });
        return;
      }

      await getOrCreateGuildConfig(guildId);
      await prisma.birthday.upsert({
        where: { guildId_userId: { guildId, userId: interaction.user.id } },
        create: { guildId, userId: interaction.user.id, month, day },
        update: { month, day },
      });
      await interaction.reply({ content: `Saved your birthday as ${MONTH_NAMES[month - 1]} ${day}.`, ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      await prisma.birthday.deleteMany({ where: { guildId, userId: interaction.user.id } });
      await interaction.reply({ content: 'Removed your birthday.', ephemeral: true });
      return;
    }

    const now = new Date();
    const todays = await prisma.birthday.findMany({
      where: { guildId, month: now.getUTCMonth() + 1, day: now.getUTCDate() },
    });
    if (todays.length === 0) {
      await interaction.reply({ content: 'No birthdays today.' });
      return;
    }
    await interaction.reply({ content: `🎂 Birthdays today: ${todays.map((b) => `<@${b.userId}>`).join(', ')}` });
  },
};
