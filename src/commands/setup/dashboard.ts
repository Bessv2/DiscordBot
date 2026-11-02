import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { config } from '../../config';
import { createLoginToken, LOGIN_TTL_MS } from '../../dashboard/auth';
import { dashboardUrl } from '../../dashboard/url';

// Hands an admin a one-time sign-in link for the web dashboard. The reply
// is ephemeral, so only the person who ran it ever sees the link.
export const dashboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Get a private sign-in link to manage this server from a web browser.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    if (!config.ENABLE_DASHBOARD) {
      await interaction.reply({
        content:
          "The web dashboard isn't turned on for this bot. Everything it does is also in `/setup`.\n" +
          'Whoever runs the bot can turn it on with `ENABLE_DASHBOARD=true` in `.env` (see the README, "Web dashboard").',
        ephemeral: true,
      });
      return;
    }
    const token = createLoginToken(interaction.user.id, interaction.guildId);
    const url = `${dashboardUrl()}/login?t=${token}`;
    const local = /^http:\/\/(localhost|127\.0\.0\.1)/.test(url);
    await interaction.reply({
      content:
        `🔐 **Your sign-in link for ${interaction.guild.name}:**\n<${url}>\n\n` +
        `It works once, within ${LOGIN_TTL_MS / 60_000} minutes. **Don't share it:** whoever opens it is signed in as you. ` +
        'Every change is still checked against your admin rights here.' +
        (local
          ? '\n-# This link opens on the computer running the bot (or through an SSH tunnel to it). To use it from elsewhere, the host sets DASHBOARD_URL.'
          : ''),
      ephemeral: true,
    });
  },
};
