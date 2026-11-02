import {
  ChannelType,
  ChatInputCommandInteraction,
  Message,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { config } from '../../config';
import { postModLogNote } from '../../lib/modlog';

const FOURTEEN_DAYS = 14 * 86_400_000;

/** Pure filter so it's unit tested: which fetched messages does a purge remove? */
export function selectPurgeTargets(
  messages: {
    id: string;
    authorId: string;
    bot: boolean;
    content: string;
    createdAt: number;
    pinned: boolean;
  }[],
  opts: {
    amount: number;
    userId?: string | null;
    botsOnly?: boolean;
    contains?: string | null;
    now: number;
  },
): string[] {
  const needle = opts.contains?.toLowerCase();
  return (
    messages
      // Discord refuses to bulk-delete messages older than 14 days; pins are kept on purpose.
      .filter((m) => opts.now - m.createdAt < FOURTEEN_DAYS && !m.pinned)
      .filter((m) => !opts.userId || m.authorId === opts.userId)
      .filter((m) => !opts.botsOnly || m.bot)
      .filter((m) => !needle || m.content.toLowerCase().includes(needle))
      .slice(0, opts.amount)
      .map((m) => m.id)
  );
}

export const purgeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription(
      'Delete recent messages in this channel, optionally only from one member or bots.',
    )
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setDescription('How many messages (1-100)')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    )
    .addUserOption((o) => o.setName('user').setDescription('Only messages from this member'))
    .addBooleanOption((o) => o.setName('bots_only').setDescription('Only messages from bots'))
    .addStringOption((o) =>
      o
        .setName('contains')
        .setDescription('Only messages containing this text (needs Message Content)'),
    )
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ManageMessages,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const channel = interaction.channel;
    if (!channel || channel.type === ChannelType.GuildVoice || !('bulkDelete' in channel)) {
      await interaction.reply({
        content: "Messages can't be purged in this kind of channel.",
        ephemeral: true,
      });
      return;
    }
    const contains = interaction.options.getString('contains');
    if (contains && !config.ENABLE_MESSAGE_CONTENT) {
      await interaction.reply({
        content:
          "I can't see message text, so `contains` won't work. The bot's host can turn on Message Content (ENABLE_MESSAGE_CONTENT). The other filters work without it.",
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const amount = interaction.options.getInteger('amount', true);
    const user = interaction.options.getUser('user');
    const fetched = await channel.messages
      .fetch({ limit: 100, before: undefined })
      .catch(() => null);
    if (!fetched) {
      await interaction.editReply(
        "I couldn't read this channel's messages. I need **Read Message History** here.",
      );
      return;
    }
    const ids = selectPurgeTargets(
      [...fetched.values()].map((m: Message) => ({
        id: m.id,
        authorId: m.author.id,
        bot: m.author.bot,
        content: m.content,
        createdAt: m.createdTimestamp,
        pinned: m.pinned,
      })),
      {
        amount,
        userId: user?.id,
        botsOnly: interaction.options.getBoolean('bots_only') ?? false,
        contains,
        now: Date.now(),
      },
    );
    if (ids.length === 0) {
      await interaction.editReply(
        'Nothing to delete: no matching messages from the last 14 days (pinned messages are kept).',
      );
      return;
    }
    const deleted = await channel.bulkDelete(ids, true).catch((err: Error) => err);
    if (deleted instanceof Error) {
      await interaction.editReply(
        `I couldn't delete those messages: ${deleted.message}. I need **Manage Messages** here.`,
      );
      return;
    }
    await interaction.editReply(`🧹 Deleted ${deleted.size} message(s).`);
    await postModLogNote(interaction.guild, {
      title: 'PURGE',
      moderator: interaction.user,
      fields: [
        { name: 'Channel', value: `${channel}`, inline: true },
        { name: 'Deleted', value: `${deleted.size}`, inline: true },
        ...(user ? [{ name: 'Only from', value: `${user} (${user.tag})`, inline: true }] : []),
      ],
    });
  },
};
