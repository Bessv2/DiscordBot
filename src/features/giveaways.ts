import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Guild,
  SendableChannels,
} from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { pickRandom } from '../lib/maps';
import { isModuleEnabledForGuild } from '../lib/modules';
import { parseStringList } from '../lib/jsonList';

// Giveaways: press the button to enter (press again to leave); the fast
// scheduler tick draws winners when time is up. Entries live in the
// database, so a restart mid-giveaway loses nothing.

const COUNT_REFRESH_MS = 10_000; // entry count on the message updates at most this often
const lastRefresh = new Map<number, number>();

export function giveawayEmbed(
  g: { prize: string; hostId: string; endsAt: Date; winnerCount: number },
  entries: number,
  ended = false,
  winners: string[] = [],
): EmbedBuilder {
  const ts = Math.floor(g.endsAt.getTime() / 1000);
  return new EmbedBuilder()
    .setTitle(`🎉 ${g.prize}`)
    .setColor(ended ? 0x99aab5 : 0xf1c40f)
    .setDescription(
      ended
        ? `**Ended** <t:${ts}:R>\n**Winner${winners.length === 1 ? '' : 's'}:** ${winners.length ? winners.map((w) => `<@${w}>`).join(', ') : 'nobody entered'}`
        : `Press **Enter** to join!\nEnds <t:${ts}:R> (<t:${ts}:f>)\n**Winners:** ${g.winnerCount}`,
    )
    .setFooter({
      text: `${entries} ${entries === 1 ? 'entry' : 'entries'} · hosted by a staff member`,
    })
    .addFields({ name: 'Host', value: `<@${g.hostId}>`, inline: true });
}

export function giveawayButtons(id: number, ended: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_enter:${id}`)
      .setLabel(ended ? 'Ended' : 'Enter')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success)
      .setDisabled(ended),
  );
}

export async function startGiveaway(
  guild: Guild,
  channel: SendableChannels,
  hostId: string,
  prize: string,
  durationMs: number,
  winnerCount: number,
) {
  const g = await prisma.giveaway.create({
    data: {
      guildId: guild.id,
      channelId: channel.id,
      prize,
      hostId,
      winnerCount,
      endsAt: new Date(Date.now() + durationMs),
    },
  });
  const msg = await channel.send({
    embeds: [giveawayEmbed(g, 0)],
    components: [giveawayButtons(g.id, false)],
    allowedMentions: { parse: [] },
  });
  await prisma.giveaway.update({ where: { id: g.id }, data: { messageId: msg.id } });
  return { giveaway: g, message: msg };
}

export async function toggleEntry(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
  const g = await prisma.giveaway.findUnique({ where: { id } });
  if (!g || g.guildId !== i.guildId) {
    await i.reply({ content: 'This giveaway no longer exists.', ephemeral: true });
    return;
  }
  if (g.ended || g.endsAt <= new Date()) {
    await i.reply({ content: 'This giveaway has ended.', ephemeral: true });
    return;
  }
  if (!(await isModuleEnabledForGuild(i.guildId, 'giveaways'))) {
    await i.reply({ content: 'Giveaways are turned off on this server.', ephemeral: true });
    return;
  }
  const key = { giveawayId_userId: { giveawayId: id, userId: i.user.id } };
  const existing = await prisma.giveawayEntry.findUnique({ where: key });
  if (existing) await prisma.giveawayEntry.delete({ where: key });
  else await prisma.giveawayEntry.create({ data: { giveawayId: id, userId: i.user.id } });
  await i.reply({
    content: existing ? 'You left the giveaway.' : "🎉 You're entered! Press again to leave.",
    ephemeral: true,
  });

  const now = Date.now();
  if (now - (lastRefresh.get(id) ?? 0) > COUNT_REFRESH_MS) {
    lastRefresh.set(id, now);
    const entries = await prisma.giveawayEntry.count({ where: { giveawayId: id } });
    await i.message.edit({ embeds: [giveawayEmbed(g, entries)] }).catch(() => undefined);
  }
}

/** Draws (or redraws) winners, updates the message and announces them. */
export async function drawGiveaway(
  client: Client<true>,
  id: number,
  reroll = false,
): Promise<string[]> {
  const g = await prisma.giveaway.findUnique({ where: { id }, include: { entries: true } });
  if (!g) return [];
  const previous = parseStringList(g.winnerIds);
  // A reroll picks from everyone who hasn't already won this one.
  const pool = g.entries.map((e) => e.userId).filter((u) => !reroll || !previous.includes(u));
  const winners = pickRandom(pool, g.winnerCount);
  await prisma.giveaway.update({
    where: { id },
    data: { ended: true, winnerIds: JSON.stringify(reroll ? [...previous, ...winners] : winners) },
  });

  const channel = await client.channels.fetch(g.channelId).catch(() => null);
  if (!channel?.isSendable() || !('messages' in channel)) return winners;
  if (g.messageId && !reroll) {
    const msg = await channel.messages.fetch(g.messageId).catch(() => null);
    await msg
      ?.edit({
        embeds: [giveawayEmbed(g, g.entries.length, true, winners)],
        components: [giveawayButtons(g.id, true)],
      })
      .catch(() => undefined);
  }
  const text = winners.length
    ? `🎉 ${reroll ? 'New winner' + (winners.length > 1 ? 's' : '') : 'Congratulations'} ${winners.map((w) => `<@${w}>`).join(', ')}! You won **${g.prize}**.`
    : `No one ${reroll ? 'else ' : ''}entered the giveaway for **${g.prize}**, so there's no winner.`;
  await channel
    .send({ content: text, allowedMentions: { users: winners } })
    .catch((err) => logger.warn(`Could not announce giveaway ${id}: ${(err as Error).message}`));
  return winners;
}

/** Scheduler job (fast tick). */
export async function checkGiveaways(client: Client<true>): Promise<void> {
  const due = await prisma.giveaway.findMany({
    where: { ended: false, endsAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const g of due) await drawGiveaway(client, g.id);
}
