import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { banMember } from '../../lib/moderationActions';

export const banCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user (even if not currently in the server) and log it to their case history.')
    .addUserOption((o) => o.setName('user').setDescription('The user to ban').setRequired(true))
    .addStringOption((o) =>
      o.setName('reason').setDescription('Why are you banning them?').setRequired(false),
    )
    .addIntegerOption((o) =>
      o
        .setName('delete_message_days')
        .setDescription('Delete their messages from the last N days (0-7)')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false),
    )
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.BanMembers,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason');
    const deleteMessageDays = interaction.options.getInteger('delete_message_days') ?? 0;

    const result = await banMember(
      interaction.guild,
      interaction.member,
      targetUser,
      interaction.user,
      reason,
      deleteMessageDays * 86_400,
    );
    await interaction.reply({ content: result.message, ephemeral: !result.ok });
  },
};
