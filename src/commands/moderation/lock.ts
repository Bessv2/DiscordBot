import {
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';
import { Command } from '../types';
import { postModLogNote } from '../../lib/modlog';

// Locks one channel (members can read but not post). The server-wide
// raid lockdown is /lockdown; this is for a single heated channel.
function build(name: 'lock' | 'unlock') {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(
      name === 'lock'
        ? 'Stop members posting in a channel (they can still read it).'
        : 'Let members post in a locked channel again.',
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Defaults to this channel')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Shown in the channel and the mod-log'),
    )
    .setDMPermission(false);
}

async function run(interaction: ChatInputCommandInteraction, lock: boolean) {
  if (!interaction.inCachedGuild()) return;
  const channel = (interaction.options.getChannel('channel') ??
    interaction.channel) as TextChannel | null;
  if (!channel || !('permissionOverwrites' in channel)) {
    await interaction.reply({ content: "That kind of channel can't be locked.", ephemeral: true });
    return;
  }
  const reason = interaction.options.getString('reason');
  const everyone = interaction.guild.roles.everyone;
  const ok = await channel.permissionOverwrites
    .edit(
      everyone,
      { SendMessages: lock ? false : null, SendMessagesInThreads: lock ? false : null },
      { reason: `/${lock ? 'lock' : 'unlock'} by ${interaction.user.tag}` },
    )
    .then(
      () => true,
      () => false,
    );
  if (!ok) {
    await interaction.reply({
      content: `I couldn't change ${channel}. I need **Manage Channels** and **Manage Roles** there.`,
      ephemeral: true,
    });
    return;
  }
  await interaction.reply(
    lock
      ? `🔒 ${channel} is locked.${reason ? ` Reason: ${reason}` : ''}`
      : `🔓 ${channel} is unlocked.`,
  );
  await postModLogNote(interaction.guild, {
    title: lock ? 'CHANNEL LOCKED' : 'CHANNEL UNLOCKED',
    moderator: interaction.user,
    fields: [
      { name: 'Channel', value: `${channel}`, inline: true },
      ...(reason ? [{ name: 'Reason', value: reason }] : []),
    ],
  });
}

export const lockCommand: Command = {
  data: build('lock'),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ManageChannels,
  execute: (i) => run(i, true),
};

export const unlockCommand: Command = {
  data: build('unlock'),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ManageChannels,
  execute: (i) => run(i, false),
};
