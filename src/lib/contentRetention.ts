import { APIEmbed, Client, Message } from 'discord.js';
import { prisma } from './db';
import { logger } from './logger';

// Section 7: member message text in logs is opt-in, and expires. When a log
// message (mod-log or server log) includes message text, it's recorded here
// with an expiry; the slow scheduler tick then edits the text out of the
// log message once it expires. Everything else in the log entry stays.

/** Embed field names that hold member message text. Anything else is left alone. */
export const TEXT_FIELD_NAMES = new Set(['Matched content', 'Message', 'Before', 'After']);

export async function recordContentLog(message: Message, retainDays: number): Promise<void> {
  if (!message.guildId) return;
  await prisma.contentLogMessage
    .create({
      data: {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        expiresAt: new Date(Date.now() + Math.max(retainDays, 1) * 86_400_000),
      },
    })
    .catch((err) =>
      logger.warn(`Could not record a log message for text expiry: ${(err as Error).message}`),
    );
}

/** Pure: returns the embeds with message-text fields replaced, or null if there was nothing to remove. */
export function redactEmbeds(embeds: APIEmbed[], days: number): APIEmbed[] | null {
  let changed = false;
  const out = embeds.map((e) => ({
    ...e,
    fields: (e.fields ?? []).map((f) => {
      if (!TEXT_FIELD_NAMES.has(f.name) || f.value.startsWith('*(removed')) return f;
      changed = true;
      return { ...f, value: `*(removed after ${days} day${days === 1 ? '' : 's'})*` };
    }),
  }));
  return changed ? out : null;
}

const BATCH = 25; // per tick, so a backlog never bursts into Discord's rate limits

/** Scheduler job (slow tick): edit expired message text out of log messages. */
export async function pruneExpiredContent(client: Client<true>): Promise<void> {
  const due = await prisma.contentLogMessage.findMany({
    where: { expiresAt: { lte: new Date() } },
    take: BATCH,
    orderBy: { expiresAt: 'asc' },
  });
  for (const row of due) {
    // Delete first: if the message is gone or uneditable, retrying forever helps nobody.
    await prisma.contentLogMessage.delete({ where: { id: row.id } }).catch(() => undefined);
    const config = await prisma.guildConfig.findUnique({
      where: { id: row.guildId },
      select: { contentRetainDays: true },
    });
    const channel = await client.channels.fetch(row.channelId).catch(() => null);
    if (!channel?.isTextBased()) continue;
    const message = await channel.messages.fetch(row.messageId).catch(() => null);
    if (!message || message.author.id !== client.user.id) continue;
    const redacted = redactEmbeds(
      message.embeds.map((e) => e.toJSON()),
      config?.contentRetainDays ?? 30,
    );
    if (redacted) {
      await message.edit({ embeds: redacted }).catch((err) => {
        logger.warn(
          `Could not remove expired message text from log message ${row.messageId}: ${(err as Error).message}`,
        );
      });
    }
  }
}
