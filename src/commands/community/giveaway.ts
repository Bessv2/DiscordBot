import {
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { prisma } from '../../lib/db';
import { parseDuration } from '../../lib/duration';
import { drawGiveaway, startGiveaway } from '../../features/giveaways';

export const giveawayCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Run a giveaway members enter with a button.')
    .addSubcommand((sc) =>
      sc
        .setName('start')
        .setDescription('Start a giveaway')
        .addStringOption((o) =>
          o
            .setName('prize')
            .setDescription('What they can win')
            .setRequired(true)
            .setMaxLength(200),
        )
        .addStringOption((o) =>
          o.setName('duration').setDescription('How long, e.g. 1h, 2d').setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('winners')
            .setDescription('How many winners (default 1)')
            .setMinValue(1)
            .setMaxValue(20),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Where to post it (default: here)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('end')
        .setDescription('End a giveaway now and draw winners')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Giveaway number from /giveaway list').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('reroll')
        .setDescription('Draw new winners for an ended giveaway')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Giveaway number from /giveaway list').setRequired(true),
        ),
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('Show running and recent giveaways'))
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const ms = parseDuration(interaction.options.getString('duration', true));
      if (!ms || ms < 60_000) {
        await interaction.reply({
          content: 'Give a duration of at least a minute, like `30m`, `2h` or `3d`.',
          ephemeral: true,
        });
        return;
      }
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      if (!channel?.isSendable()) {
        await interaction.reply({ content: "I can't post in that channel.", ephemeral: true });
        return;
      }
      const { giveaway } = await startGiveaway(
        interaction.guild,
        channel,
        interaction.user.id,
        interaction.options.getString('prize', true),
        ms,
        interaction.options.getInteger('winners') ?? 1,
      );
      await interaction.reply({
        content: `🎉 Giveaway #${giveaway.id} started in ${channel}.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'list') {
      const list = await prisma.giveaway.findMany({
        where: { guildId: interaction.guild.id },
        orderBy: { id: 'desc' },
        take: 10,
      });
      if (!list.length) {
        await interaction.reply({
          content: 'No giveaways yet. Start one with `/giveaway start`.',
          ephemeral: true,
        });
        return;
      }
      const lines = list.map(
        (g) =>
          `**#${g.id}** ${g.prize} · ${g.ended ? 'ended' : `ends <t:${Math.floor(g.endsAt.getTime() / 1000)}:R>`} · <#${g.channelId}>`,
      );
      await interaction.reply({ content: lines.join('\n'), ephemeral: true });
      return;
    }

    const id = interaction.options.getInteger('id', true);
    const g = await prisma.giveaway.findUnique({ where: { id } });
    if (!g || g.guildId !== interaction.guild.id) {
      await interaction.reply({ content: `No giveaway #${id} here.`, ephemeral: true });
      return;
    }
    if (sub === 'end' && g.ended) {
      await interaction.reply({
        content: 'That giveaway already ended. Use `/giveaway reroll` to draw again.',
        ephemeral: true,
      });
      return;
    }
    if (sub === 'reroll' && !g.ended) {
      await interaction.reply({ content: "That giveaway hasn't ended yet.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const winners = await drawGiveaway(interaction.client, id, sub === 'reroll');
    await interaction.editReply(
      winners.length ? `Drew ${winners.length} winner(s).` : 'Nobody was left to draw.',
    );
  },
};
