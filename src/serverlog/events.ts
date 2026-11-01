import { EmbedBuilder, Guild } from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { isModuleOn } from '../lib/modules';
import { recordContentLog } from '../lib/contentRetention';
import { parseStringList } from '../lib/jsonList';

// Server logs: one channel that shows what happened on the server, for the
// mod team's own record. Each kind of event can be switched off on its own
// (serverLogEvents is an opt-out list), and member message text only ever
// appears if the server opted in to keeping it, and then only for a while.

export const SERVER_LOG_EVENTS = [
  { key: 'messages', label: 'Messages edited or deleted', host: null },
  { key: 'members', label: 'Members joining and leaving', host: 'guildMembers' },
  { key: 'memberUpdates', label: 'Nickname and role changes', host: 'guildMembers' },
  { key: 'voice', label: 'Voice channel joins, leaves and moves', host: null },
  { key: 'channels', label: 'Channels created, deleted or renamed', host: null },
  { key: 'roles', label: 'Roles created, deleted or changed', host: null },
  { key: 'bans', label: 'Bans and unbans, including ones done outside the bot', host: null },
] as const;

export type ServerLogEventKey = (typeof SERVER_LOG_EVENTS)[number]['key'];

/** Pure: is this kind of event logged, given the server's opt-out list? */
export function isServerLogEventOn(serverLogEventsJson: string, key: ServerLogEventKey): boolean {
  return !parseStringList(serverLogEventsJson).includes(key);
}

const COLORS = { create: 0x57f287, delete: 0xed4245, update: 0xfee75c, info: 0x5865f2 } as const;

export interface ServerLogEntry {
  title: string;
  description: string;
  color: keyof typeof COLORS;
  fields?: { name: string; value: string; inline?: boolean }[];
  /** Member message text: only shown if the server keeps message text; then it expires. */
  text?: { name: 'Message' | 'Before' | 'After'; value: string }[];
  /** Skip if the event happened in the log channel itself (avoids logging our own log). */
  channelId?: string | null;
  thumbnailUrl?: string;
}

export async function logServerEvent(
  guild: Guild,
  key: ServerLogEventKey,
  entry: ServerLogEntry,
): Promise<void> {
  const config = await prisma.guildConfig.findUnique({ where: { id: guild.id } });
  if (!config?.serverLogChannelId || !isModuleOn(config, 'serverlog')) return;
  if (!isServerLogEventOn(config.serverLogEvents, key)) return;
  if (entry.channelId && entry.channelId === config.serverLogChannelId) return;

  const channel =
    guild.channels.cache.get(config.serverLogChannelId) ??
    (await guild.channels.fetch(config.serverLogChannelId).catch(() => null));
  if (!channel?.isSendable()) {
    logger.warn(
      `[serverlog] Log channel ${config.serverLogChannelId} in guild ${guild.id} is gone or I can't post there.`,
      'Pick a new one in /setup → Server logs.',
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS[entry.color])
    .setTitle(entry.title)
    .setDescription(entry.description.slice(0, 4000))
    .setTimestamp();
  if (entry.thumbnailUrl) embed.setThumbnail(entry.thumbnailUrl);
  if (entry.fields?.length)
    embed.addFields(entry.fields.map((f) => ({ ...f, value: f.value.slice(0, 1024) || '—' })));
  const keepText = config.logMessageContent && entry.text?.some((t) => t.value);
  if (keepText)
    embed.addFields(
      entry.text!.map((t) => ({ name: t.name, value: t.value.slice(0, 1024) || '*(empty)*' })),
    );

  const sent = await channel
    .send({ embeds: [embed], allowedMentions: { parse: [] } })
    .catch((err) => {
      logger.warn(
        `[serverlog] Could not post in guild ${guild.id}: ${(err as Error).message}`,
        'Check the bot can View, Send Messages and Embed Links in the log channel.',
      );
      return null;
    });
  if (sent && keepText) await recordContentLog(sent, config.contentRetainDays);
}
