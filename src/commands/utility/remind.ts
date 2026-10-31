import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { parseDuration } from '../../lib/duration';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';

export const remindCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription("Have the bot ping you in this channel after a delay.")
    .addStringOption((o) =>
      o.setName('time').setDescription('e.g. 10m, 1h, 2d').setRequired(true),
    )
    .addStringOption((o) => o.setName('message').setDescription('What to remind you about').setRequired(true))
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const timeInput = interaction.options.getString('time', true);
    const message = interaction.options.getString('message', true);

    const durationMs = parseDuration(timeInput);
    if (durationMs === null) {
      await interaction.reply({
        content: 'Could not parse that duration (max 365d). Try something like `10m`, `1h`, or `2d`.',
        ephemeral: true,
      });
      return;
    }

    await getOrCreateGuildConfig(interaction.guild.id);
    const remindAt = new Date(Date.now() + durationMs);
    await prisma.reminder.create({
      data: {
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        channelId: interaction.channelId,
        message,
        remindAt,
      },
    });

    await interaction.reply({
      content: `Got it — I'll remind you here <t:${Math.floor(remindAt.getTime() / 1000)}:R>.`,
      ephemeral: true,
    });
  },
};
