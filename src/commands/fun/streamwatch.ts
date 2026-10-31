import { ChannelType, ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';

export const streamwatchCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('streamwatch')
    .setDescription('Get notified in a channel when a Twitch/YouTube channel goes live.')
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Watch a channel')
        .addStringOption((o) => o.setName('platform').setDescription('Which platform').setRequired(true).addChoices({ name: 'Twitch', value: 'twitch' }, { name: 'YouTube', value: 'youtube' }))
        .addStringOption((o) =>
          o
            .setName('channel_name')
            .setDescription('Twitch login, or the YouTube channel\'s "UC..." ID (not the @handle)')
            .setRequired(true),
        )
        .addChannelOption((o) =>
          o.setName('post_in').setDescription('Where to post the notification').addChannelTypes(ChannelType.GuildText).setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Stop watching a channel')
        .addStringOption((o) => o.setName('platform').setDescription('Which platform').setRequired(true).addChoices({ name: 'Twitch', value: 'twitch' }, { name: 'YouTube', value: 'youtube' }))
        .addStringOption((o) => o.setName('channel_name').setDescription('The same name/ID used when adding it').setRequired(true)),
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('List watched channels'))
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rows = await prisma.streamNotification.findMany({ where: { guildId } });
      if (rows.length === 0) {
        await interaction.reply({ content: 'Not watching any channels.', ephemeral: true });
        return;
      }
      await interaction.reply({
        content: rows.map((r) => `${r.platform}: \`${r.channelName}\` → <#${r.channelId}>`).join('\n'),
        ephemeral: true,
      });
      return;
    }

    const platform = interaction.options.getString('platform', true);
    const channelName = interaction.options.getString('channel_name', true);

    if (sub === 'add') {
      const postIn = interaction.options.getChannel('post_in', true);
      await getOrCreateGuildConfig(guildId);
      await prisma.streamNotification.upsert({
        where: { guildId_platform_channelName: { guildId, platform, channelName } },
        create: { guildId, platform, channelName, channelId: postIn.id },
        update: { channelId: postIn.id },
      });
      await interaction.reply({ content: `Watching ${platform}:\`${channelName}\` — will post in <#${postIn.id}>.`, ephemeral: true });
      return;
    }

    await prisma.streamNotification.deleteMany({ where: { guildId, platform, channelName } });
    await interaction.reply({ content: `Stopped watching ${platform}:\`${channelName}\`.`, ephemeral: true });
  },
};
