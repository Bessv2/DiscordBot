import {
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { Command } from '../types';
import { prisma } from '../../lib/db';
import { memberHasPermission } from '../../lib/permissions';
import { buildTicketPanel, closeTicket, isTicketStaff } from '../../features/tickets';

export const ticketCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Support tickets: private threads between a member and staff.')
    .addSubcommand((sc) =>
      sc
        .setName('panel')
        .setDescription('(Admins) Post the "Open a ticket" button in a channel')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Where to post it')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sc) => sc.setName('close').setDescription('Close the ticket you are in'))
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('(Staff) Add someone to this ticket')
        .addUserOption((o) => o.setName('user').setDescription('Who to add').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('(Staff) Remove someone from this ticket')
        .addUserOption((o) => o.setName('user').setDescription('Who to remove').setRequired(true)),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'panel') {
      if (
        !(await memberHasPermission(interaction.member, 'admin', PermissionFlagsBits.ManageGuild))
      ) {
        await interaction.reply({
          content: 'Only admins can post the ticket panel.',
          ephemeral: true,
        });
        return;
      }
      const channel = interaction.options.getChannel('channel', true, [ChannelType.GuildText]);
      const ok = await channel.send(buildTicketPanel()).then(
        () => true,
        () => false,
      );
      await interaction.reply({
        content: ok ? `Ticket button posted in ${channel}.` : `I can't post in ${channel}.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'close') {
      await interaction.reply({
        content: await closeTicket(interaction.member, interaction.channelId, null),
        ephemeral: true,
      });
      return;
    }

    // add / remove
    const ticket = await prisma.ticket.findUnique({ where: { threadId: interaction.channelId } });
    if (!ticket || ticket.status !== 'open') {
      await interaction.reply({ content: 'Run this inside an open ticket.', ephemeral: true });
      return;
    }
    if (!(await isTicketStaff(interaction.member))) {
      await interaction.reply({
        content: 'Only staff can change who is in a ticket.',
        ephemeral: true,
      });
      return;
    }
    const user = interaction.options.getUser('user', true);
    const thread = interaction.channel as ThreadChannel;
    const ok = await (
      sub === 'add' ? thread.members.add(user.id) : thread.members.remove(user.id)
    ).then(
      () => true,
      () => false,
    );
    await interaction.reply({
      content: ok ? `${sub === 'add' ? 'Added' : 'Removed'} ${user}.` : "I couldn't do that here.",
      allowedMentions: { parse: [] },
    });
  },
};
