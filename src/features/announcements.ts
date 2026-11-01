import { Client, EmbedBuilder } from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { guildIdsWithModuleOff } from '../lib/modules';

export const REPEAT_MS: Record<string, number> = { daily: 86_400_000, weekly: 7 * 86_400_000 };

/** Pure: when does a repeating announcement next run, skipping any runs missed while the bot was off? */
export function nextRun(current: Date, repeat: string, now: Date): Date | null {
  const step = REPEAT_MS[repeat];
  if (!step) return null;
  let t = current.getTime() + step;
  while (t <= now.getTime()) t += step;
  return new Date(t);
}

export function announcementEmbed(a: {
  title: string | null;
  content: string;
  color: number | null;
}): EmbedBuilder {
  const e = new EmbedBuilder()
    .setDescription(a.content.slice(0, 4000))
    .setColor(a.color ?? 0x5865f2);
  if (a.title) e.setTitle(a.title.slice(0, 256));
  return e;
}

/** Scheduler job (fast tick): post announcements that are due. */
export async function checkAnnouncements(client: Client<true>): Promise<void> {
  const due = await prisma.scheduledMessage.findMany({
    where: { nextRunAt: { lte: new Date() } },
    take: 20,
  });
  if (!due.length) return;
  const off = await guildIdsWithModuleOff('announcements');
  for (const a of due) {
    const next = nextRun(a.nextRunAt, a.repeat, new Date());
    if (next)
      await prisma.scheduledMessage.update({ where: { id: a.id }, data: { nextRunAt: next } });
    else await prisma.scheduledMessage.delete({ where: { id: a.id } });
    if (off.has(a.guildId)) continue;
    const channel = await client.channels.fetch(a.channelId).catch(() => null);
    if (!channel?.isSendable()) {
      logger.warn(
        `Announcement #${a.id} in guild ${a.guildId}: its channel is gone or I can't post there.`,
        'Recreate it with /announce in a channel the bot can post in.',
      );
      continue;
    }
    await channel
      .send({ embeds: [announcementEmbed(a)], allowedMentions: { parse: [] } })
      .catch((err) =>
        logger.warn(`Could not post announcement #${a.id}: ${(err as Error).message}`),
      );
  }
}
