import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { unmuteMember } from '../../lib/muteActions';

export const unmuteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a mute from a member.')
    .addUserOption((o) => o.setName('user').setDescription('The member to unmute').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why are you unmuting them?').setRequired(false))
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

    const result = await unmuteMember(interaction.guild, targetMember, interaction.user, reason);
    await interaction.reply({ content: result.message });
  },
};
