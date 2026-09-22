import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { timeoutMember } from '../../lib/moderationActions';
import { clampToDiscordTimeoutLimit, parseDuration } from '../../lib/duration';

export const timeoutCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Time out a member for a set duration and log it to their case history.')
    .addUserOption((o) => o.setName('user').setDescription('The member to time out').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('e.g. 10m, 1h, 1d (max 28 days)')
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Why are you timing them out?').setRequired(false),
    )
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ModerateMembers,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const targetUser = interaction.options.getUser('user', true);
    const durationInput = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason');

    const durationMs = parseDuration(durationInput);
    if (durationMs === null) {
      await interaction.reply({
        content: 'Could not parse that duration. Try something like `10m`, `1h`, or `1d`.',
        ephemeral: true,
      });
      return;
    }

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({ content: "That user isn't in this server.", ephemeral: true });
      return;
    }

    const result = await timeoutMember(
      interaction.guild,
      interaction.member,
      targetMember,
      interaction.user,
      reason,
      clampToDiscordTimeoutLimit(durationMs),
    );
    await interaction.reply({ content: result.message, ephemeral: !result.ok });
  },
};
