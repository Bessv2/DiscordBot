import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { kickMember } from '../../lib/moderationActions';

export const kickCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member and log it to their case history.')
    .addUserOption((o) => o.setName('user').setDescription('The member to kick').setRequired(true))
    .addStringOption((o) =>
      o.setName('reason').setDescription('Why are you kicking them?').setRequired(false),
    )
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.KickMembers,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason');

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({ content: "That user isn't in this server.", ephemeral: true });
      return;
    }

    const result = await kickMember(interaction.guild, interaction.member, targetMember, interaction.user, reason);
    await interaction.reply({ content: result.message, ephemeral: !result.ok });
  },
};
