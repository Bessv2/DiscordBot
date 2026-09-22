import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';

export const userinfoCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show information about a member.')
    .addUserOption((o) => o.setName('user').setDescription('Defaults to yourself').setRequired(false))
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: "That user isn't in this server.", ephemeral: true });
      return;
    }

    const roles = member.roles.cache
      .filter((r) => r.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position);

    const embed = new EmbedBuilder()
      .setTitle(targetUser.tag)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: 'ID', value: targetUser.id, inline: true },
        {
          name: 'Account created',
          value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`,
          inline: true,
        },
        {
          name: 'Joined server',
          value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown',
          inline: true,
        },
        { name: `Roles (${roles.size})`, value: roles.size ? roles.map((r) => `${r}`).join(' ') : 'None' },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
