import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { setLockdown } from '../../lib/raidActions';

export const lockdownCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Manually raise or lower the server verification level during a raid.')
    .addStringOption((o) =>
      o
        .setName('state')
        .setDescription('Turn lockdown on or off')
        .setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
    )
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const state = interaction.options.getString('state', true);
    const message = await setLockdown(interaction.guild, state === 'on');
    await interaction.reply({ content: message });
  },
};
