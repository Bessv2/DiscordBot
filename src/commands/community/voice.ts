import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  VoiceChannel,
} from 'discord.js';
import { Command } from '../types';
import { prisma } from '../../lib/db';
import { memberHasPermission } from '../../lib/permissions';

export const voiceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Control your own join-to-create voice room.')
    .addSubcommand((sc) =>
      sc
        .setName('rename')
        .setDescription('Rename your room')
        .addStringOption((o) =>
          o.setName('name').setDescription('New name').setRequired(true).setMaxLength(100),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('limit')
        .setDescription('Limit how many can join (0 = no limit)')
        .addIntegerOption((o) =>
          o
            .setName('people')
            .setDescription('0-99')
            .setMinValue(0)
            .setMaxValue(99)
            .setRequired(true),
        ),
    )
    .addSubcommand((sc) => sc.setName('lock').setDescription('Stop new people joining your room'))
    .addSubcommand((sc) => sc.setName('unlock').setDescription('Let people join your room again'))
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const channel = interaction.member.voice.channel as VoiceChannel | null;
    const room = channel
      ? await prisma.tempVoiceChannel.findUnique({ where: { channelId: channel.id } })
      : null;
    if (!channel || !room) {
      await interaction.reply({
        content: 'Join your own room first (made by the join-to-create channel).',
        ephemeral: true,
      });
      return;
    }
    if (
      room.ownerId !== interaction.user.id &&
      !(await memberHasPermission(
        interaction.member,
        'moderation',
        PermissionFlagsBits.MoveMembers,
      ))
    ) {
      await interaction.reply({
        content: `Only <@${room.ownerId}> (who made this room) can change it.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }
    const sub = interaction.options.getSubcommand();
    const everyone = interaction.guild.roles.everyone;
    const done = await (
      sub === 'rename'
        ? channel.setName(interaction.options.getString('name', true))
        : sub === 'limit'
          ? channel.setUserLimit(interaction.options.getInteger('people', true))
          : channel.permissionOverwrites.edit(everyone, { Connect: sub === 'lock' ? false : null })
    ).then(
      () => true,
      () => false,
    );
    await interaction.reply({
      content: done
        ? 'Done.'
        : "Discord didn't let me change that (renames are limited to 2 every 10 minutes).",
      ephemeral: true,
    });
  },
};
