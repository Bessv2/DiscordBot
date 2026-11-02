import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  GuildMember,
  Message,
  PermissionFlagsBits,
  ThreadChannel,
} from 'discord.js';
import { config } from '../config';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { isModuleEnabledForGuild } from '../lib/modules';
import { memberHasPermission } from '../lib/permissions';

// Support tickets as private threads: no extra channels or category to set
// up, and only the member who opened it, the staff role and mods can see it.

export const TICKET_PANEL_BUTTON = 'ticket_open';
const MAX_TRANSCRIPT_MESSAGES = 500;

export function buildTicketPanel(): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('🎫 Need help?')
        .setDescription(
          'Press the button to open a **private ticket** with the staff team. Only you and staff can see it.\n\n' +
            'When it closes, a transcript is saved for staff.',
        )
        .setColor(0x5865f2),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(TICKET_PANEL_BUTTON)
          .setLabel('Open a ticket')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

function closeRow(ticketId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_close:${ticketId}`)
      .setLabel('Close ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );
}

export async function isTicketStaff(member: GuildMember): Promise<boolean> {
  const cfg = await prisma.guildConfig.findUnique({
    where: { id: member.guild.id },
    select: { ticketStaffRoleId: true },
  });
  if (cfg?.ticketStaffRoleId && member.roles.cache.has(cfg.ticketStaffRoleId)) return true;
  return memberHasPermission(member, 'moderation', PermissionFlagsBits.ManageThreads);
}

export async function openTicket(
  i: ButtonInteraction<'cached'>,
  topic: string | null = null,
): Promise<void> {
  if (!(await isModuleEnabledForGuild(i.guildId, 'tickets'))) {
    await i.reply({ content: 'Tickets are turned off on this server.', ephemeral: true });
    return;
  }
  const existing = await prisma.ticket.findFirst({
    where: { guildId: i.guildId, userId: i.user.id, status: 'open' },
  });
  if (existing) {
    await i.reply({
      content: `You already have an open ticket: <#${existing.threadId}>`,
      ephemeral: true,
    });
    return;
  }
  const parent = i.channel;
  if (!parent || parent.type !== ChannelType.GuildText) {
    await i.reply({
      content: 'Tickets can only be opened from a normal text channel.',
      ephemeral: true,
    });
    return;
  }
  const cfg = await prisma.guildConfig.findUniqueOrThrow({ where: { id: i.guildId } });

  await i.deferReply({ ephemeral: true });
  let thread: ThreadChannel;
  try {
    thread = await parent.threads.create({
      name: `ticket-${i.user.username}`.slice(0, 100),
      type: ChannelType.PrivateThread,
      invitable: false,
      reason: `Ticket opened by ${i.user.tag}`,
    });
    await thread.members.add(i.user.id);
  } catch (err) {
    logger.warn(
      `Could not create a ticket thread in guild ${i.guildId}: ${(err as Error).message}`,
      'Give the bot Create Private Threads, Send Messages in Threads and Manage Threads in that channel.',
    );
    await i.editReply(
      "I couldn't open a ticket here. Staff: I need **Create Private Threads** and **Manage Threads** in this channel.",
    );
    return;
  }

  const ticket = await prisma.ticket.create({
    data: { guildId: i.guildId, threadId: thread.id, userId: i.user.id, topic },
  });
  // Mentioning the staff role adds them to the private thread.
  await thread.send({
    content: `${i.user} opened a ticket.${cfg.ticketStaffRoleId ? ` <@&${cfg.ticketStaffRoleId}>` : ''}`,
    embeds: [
      new EmbedBuilder()
        .setDescription(
          `${topic ? `**Topic:** ${topic}\n\n` : ''}Tell us what you need and a staff member will be with you. Press **Close ticket** when you're done.`,
        )
        .setColor(0x5865f2),
    ],
    components: [closeRow(ticket.id)],
    allowedMentions: {
      users: [i.user.id],
      roles: cfg.ticketStaffRoleId ? [cfg.ticketStaffRoleId] : [],
    },
  });
  await i.editReply(`Your ticket is open: ${thread}`);
}

/** Pure: one line per message for the transcript. */
export function transcriptLine(m: {
  createdAt: Date;
  authorTag: string;
  content: string;
  attachments: string[];
}): string {
  const time = m.createdAt.toISOString().replace('T', ' ').slice(0, 16);
  const extra = m.attachments.length ? ` [attachments: ${m.attachments.join(' ')}]` : '';
  return `[${time}] ${m.authorTag}: ${m.content || (m.attachments.length ? '' : '(no text)')}${extra}`;
}

async function buildTranscript(thread: ThreadChannel): Promise<string> {
  const all: Message[] = [];
  let before: string | undefined;
  while (all.length < MAX_TRANSCRIPT_MESSAGES) {
    const batch = await thread.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    all.push(...batch.values());
    before = batch.last()!.id;
    if (batch.size < 100) break;
  }
  all.reverse();
  const header = config.ENABLE_MESSAGE_CONTENT
    ? ''
    : '(Message text is only included when the bot host turns on Message Content.)\n';
  return (
    header +
    all
      .map((m) =>
        transcriptLine({
          createdAt: m.createdAt,
          authorTag: m.author.tag,
          content: m.content,
          attachments: [...m.attachments.values()].map((a) => a.url),
        }),
      )
      .join('\n')
  );
}

/** Closes a ticket by ID (the button) or by the thread it's run in (/ticket close). Returns the reply to show. */
export async function closeTicket(
  member: GuildMember,
  channelId: string,
  ticketId: number | null,
): Promise<string> {
  const ticket = ticketId
    ? await prisma.ticket.findUnique({ where: { id: ticketId } })
    : await prisma.ticket.findUnique({ where: { threadId: channelId } });
  if (!ticket || ticket.guildId !== member.guild.id) return "This isn't a ticket.";
  if (ticket.status !== 'open') return 'This ticket is already closed.';
  if (ticket.userId !== member.id && !(await isTicketStaff(member)))
    return 'Only the person who opened it or staff can close this ticket.';

  const guild = member.guild;
  const closer = member.user;
  const thread = (guild.channels.cache.get(ticket.threadId) ??
    (await guild.channels.fetch(ticket.threadId).catch(() => null))) as ThreadChannel | null;
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: 'closed', closedAt: new Date(), closedById: closer.id },
  });

  const cfg = await prisma.guildConfig.findUnique({ where: { id: ticket.guildId } });
  if (thread && cfg?.ticketLogChannelId) {
    const log = await guild.channels.fetch(cfg.ticketLogChannelId).catch(() => null);
    if (log?.isSendable()) {
      const text = await buildTranscript(thread);
      await log
        .send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`Ticket #${ticket.id} closed`)
              .addFields(
                { name: 'Opened by', value: `<@${ticket.userId}>`, inline: true },
                { name: 'Closed by', value: `${closer}`, inline: true },
                { name: 'Thread', value: `${thread}`, inline: true },
              )
              .setColor(0x99aab5)
              .setTimestamp(),
          ],
          files: [
            new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${ticket.id}.txt` }),
          ],
          allowedMentions: { parse: [] },
        })
        .catch((err) =>
          logger.warn(
            `Could not post ticket transcript in guild ${guild.id}: ${(err as Error).message}`,
            'Give the bot Attach Files in the transcript channel.',
          ),
        );
    }
  }
  if (thread) {
    await thread
      .send({ content: `🔒 Ticket closed by ${closer}.`, allowedMentions: { parse: [] } })
      .catch(() => undefined);
    await thread.setLocked(true).catch(() => undefined);
    await thread.setArchived(true).catch(() => undefined);
  }
  return 'Ticket closed.';
}
