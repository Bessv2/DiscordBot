import {
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { getOrCreateGuildConfig, prisma } from '../../lib/db';
import { parseDuration } from '../../lib/duration';
import { announcementEmbed } from '../../features/announcements';

const COLORS: Record<string, number> = {
  blue: 0x5865f2,
  green: 0x57f287,
  yellow: 0xfee75c,
  red: 0xed4245,
  purple: 0x9b59b6,
};
const MAX_SCHEDULED = 25;

export const announceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post a styled announcement now, later, or on repeat.')
    .addSubcommand((sc) =>
      sc
        .setName('send')
        .setDescription('Post or schedule an announcement')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Where to post')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('The announcement (use \\n for new lines)')
            .setRequired(true)
            .setMaxLength(4000),
        )
        .addStringOption((o) =>
          o.setName('title').setDescription('Optional title').setMaxLength(256),
        )
        .addStringOption((o) =>
          o
            .setName('color')
            .setDescription('Side color')
            .addChoices(...Object.keys(COLORS).map((c) => ({ name: c, value: c }))),
        )
        .addStringOption((o) =>
          o.setName('in').setDescription('Post later, e.g. 30m, 2h, 1d (default: now)'),
        )
        .addStringOption((o) =>
          o
            .setName('repeat')
            .setDescription('Repeat it')
            .addChoices(
              { name: 'no', value: 'none' },
              { name: 'every day', value: 'daily' },
              { name: 'every week', value: 'weekly' },
            ),
        ),
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('Scheduled announcements'))
    .addSubcommand((sc) =>
      sc
        .setName('cancel')
        .setDescription('Cancel a scheduled announcement')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Number from /announce list').setRequired(true),
        ),
    )
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const list = await prisma.scheduledMessage.findMany({
        where: { guildId },
        orderBy: { nextRunAt: 'asc' },
      });
      await interaction.reply({
        content: list.length
          ? list
              .map(
                (a) =>
                  `**#${a.id}** <#${a.channelId}> · <t:${Math.floor(a.nextRunAt.getTime() / 1000)}:R>${a.repeat !== 'none' ? ` · ${a.repeat}` : ''} · ${(a.title ?? a.content).slice(0, 60)}`,
              )
              .join('\n')
          : 'Nothing scheduled.',
        ephemeral: true,
      });
      return;
    }
    if (sub === 'cancel') {
      const { count } = await prisma.scheduledMessage.deleteMany({
        where: { guildId, id: interaction.options.getInteger('id', true) },
      });
      await interaction.reply({
        content: count ? 'Cancelled.' : 'No such scheduled announcement.',
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true, [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
    ]);
    const data = {
      title: interaction.options.getString('title'),
      content: interaction.options.getString('message', true).replaceAll('\\n', '\n'),
      color: COLORS[interaction.options.getString('color') ?? 'blue'] ?? null,
    };
    const repeat = interaction.options.getString('repeat') ?? 'none';
    const delayRaw = interaction.options.getString('in');
    const delay = delayRaw ? parseDuration(delayRaw) : 0;
    if (delay === null) {
      await interaction.reply({
        content: 'Use a delay like `30m`, `2h` or `1d`.',
        ephemeral: true,
      });
      return;
    }
    if (!delay && repeat === 'none') {
      const ok = await channel
        .send({ embeds: [announcementEmbed(data)], allowedMentions: { parse: [] } })
        .then(
          () => true,
          () => false,
        );
      await interaction.reply({
        content: ok ? `📣 Posted in ${channel}.` : `I can't post in ${channel}.`,
        ephemeral: true,
      });
      return;
    }
    await getOrCreateGuildConfig(guildId);
    if ((await prisma.scheduledMessage.count({ where: { guildId } })) >= MAX_SCHEDULED) {
      await interaction.reply({
        content: `You can have up to ${MAX_SCHEDULED} scheduled announcements. Cancel one first.`,
        ephemeral: true,
      });
      return;
    }
    const a = await prisma.scheduledMessage.create({
      data: {
        guildId,
        channelId: channel.id,
        createdBy: interaction.user.id,
        repeat,
        nextRunAt: new Date(Date.now() + delay),
        ...data,
      },
    });
    await interaction.reply({
      content: `📅 Scheduled #${a.id} for <t:${Math.floor(a.nextRunAt.getTime() / 1000)}:f> in ${channel}${repeat !== 'none' ? `, then ${repeat}` : ''}.`,
      ephemeral: true,
    });
  },
};
