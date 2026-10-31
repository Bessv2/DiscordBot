import { ChannelType, ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';
import { config } from '../../config';
import { renderTemplate } from '../../lib/template';

export const welcomeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure welcome/goodbye messages. Needs ENABLE_GUILD_MEMBERS=true in .env to fire.')
    .addSubcommand((sc) =>
      sc
        .setName('set')
        .setDescription('Configure the welcome message')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn welcome messages on/off').setRequired(false))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Where to post welcomes').addChannelTypes(ChannelType.GuildText).setRequired(false),
        )
        .addStringOption((o) =>
          o.setName('message').setDescription('Supports {user}, {server}, {membercount}').setRequired(false),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('goodbye-set')
        .setDescription('Configure the goodbye message')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Where to post goodbyes').addChannelTypes(ChannelType.GuildText).setRequired(false),
        )
        .addStringOption((o) =>
          o.setName('message').setDescription('Supports {user}, {server}, {membercount}').setRequired(false),
        ),
    )
    .addSubcommand((sc) => sc.setName('test').setDescription('Preview the welcome message using your own account'))
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'test') {
      const guildConfig = await prisma.guildConfig.findUnique({ where: { id: guildId } });
      const text = renderTemplate(guildConfig?.welcomeMessage ?? 'Welcome {user} to {server}!', interaction.member);
      await interaction.reply({ content: `Preview: ${text}`, ephemeral: true });
      return;
    }

    await getOrCreateGuildConfig(guildId);

    if (sub === 'set') {
      const enabled = interaction.options.getBoolean('enabled');
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      await prisma.guildConfig.update({
        where: { id: guildId },
        data: {
          ...(enabled !== null ? { welcomeEnabled: enabled } : {}),
          ...(channel ? { welcomeChannelId: channel.id } : {}),
          ...(message ? { welcomeMessage: message } : {}),
        },
      });
      const warning = !config.ENABLE_GUILD_MEMBERS ? '\n⚠️ ENABLE_GUILD_MEMBERS is off in .env — welcome messages won\'t actually fire until it\'s enabled.' : '';
      await interaction.reply({ content: `Welcome message updated.${warning}`, ephemeral: true });
      return;
    }

    if (sub === 'goodbye-set') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      await prisma.guildConfig.update({
        where: { id: guildId },
        data: {
          ...(channel ? { goodbyeChannelId: channel.id } : {}),
          ...(message ? { goodbyeMessage: message } : {}),
        },
      });
      await interaction.reply({ content: 'Goodbye message updated.', ephemeral: true });
    }
  },
};
