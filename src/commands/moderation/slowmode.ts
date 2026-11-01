import {
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { parseDuration } from '../../lib/duration';
import { postModLogNote } from '../../lib/modlog';

const MAX_SLOWMODE_S = 6 * 60 * 60; // Discord's limit

export const slowmodeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Make members wait between messages in a channel, e.g. 10s, 2m, or "off".')
    .addStringOption((o) =>
      o.setName('delay').setDescription('10s, 1m, 5m... up to 6h, or "off"').setRequired(true),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Defaults to this channel')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildForum,
        ),
    )
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ManageChannels,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const raw = interaction.options.getString('delay', true).trim().toLowerCase();
    const seconds = ['off', '0', 'none'].includes(raw)
      ? 0
      : Math.round((parseDuration(raw) ?? -1000) / 1000);
    if (seconds < 0 || seconds > MAX_SLOWMODE_S) {
      await interaction.reply({
        content: 'Use something like `10s`, `2m` or `1h` (6h at most), or `off`.',
        ephemeral: true,
      });
      return;
    }
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel || !('setRateLimitPerUser' in channel)) {
      await interaction.reply({
        content: "Slowmode can't be set on this kind of channel.",
        ephemeral: true,
      });
      return;
    }
    const ok = await channel
      .setRateLimitPerUser(seconds, `/slowmode by ${interaction.user.tag}`)
      .then(
        () => true,
        () => false,
      );
    if (!ok) {
      await interaction.reply({
        content: `I couldn't change slowmode in ${channel}. I need **Manage Channels** there.`,
        ephemeral: true,
      });
      return;
    }
    await interaction.reply(
      seconds ? `🐢 Slowmode in ${channel} is now ${raw}.` : `Slowmode is off in ${channel}.`,
    );
    await postModLogNote(interaction.guild, {
      title: 'SLOWMODE',
      moderator: interaction.user,
      fields: [
        { name: 'Channel', value: `${channel}`, inline: true },
        { name: 'Delay', value: seconds ? raw : 'off', inline: true },
      ],
    });
  },
};
