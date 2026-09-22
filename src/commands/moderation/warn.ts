import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { warnMember } from '../../lib/moderationActions';

export const warnCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member and log it to their case history.')
    .addUserOption((o) => o.setName('user').setDescription('The member to warn').setRequired(true))
    .addStringOption((o) =>
      o.setName('reason').setDescription('Why are you warning them?').setRequired(false),
    )
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ModerateMembers,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason');

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({ content: "That user isn't in this server.", ephemeral: true });
      return;
    }

    const result = await warnMember(interaction.guild, interaction.member, targetMember, interaction.user, reason);
    await interaction.reply({ content: result.message, ephemeral: !result.ok });
  },
};
