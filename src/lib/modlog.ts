import { Guild, EmbedBuilder, SendableChannels, User } from 'discord.js';
import { prisma } from './db';
import { logger } from './logger';
import { recordContentLog } from './contentRetention';

const ACTION_COLOR: Record<string, number> = {
  warn: 0xf5a623,
  kick: 0xe67e22,
  ban: 0xe74c3c,
  timeout: 0x9b59b6,
  mute: 0x9b59b6,
  unmute: 0x2ecc71,
  unban: 0x2ecc71,
  note: 0x607d8b,
  automod: 0x3498db,
};

export interface ModLogEntry {
  type: 'warn' | 'kick' | 'ban' | 'timeout' | 'mute' | 'unmute' | 'unban';
  /** Omitted for actions (like unmute) that resolve an existing case rather than opening a new one. */
  caseNumber?: number;
  target: User;
  moderator: User;
  reason: string | null;
  durationMs?: number | null;
}

export interface AutomodLogEntry {
  rule: string;
  user: User;
  channelId: string;
  reason: string;
  /** Only set when the guild has opted in to logging matched content (section 7 retention rule). */
  contentSnippet?: string;
}

export async function resolveModLogChannel(guild: Guild): Promise<SendableChannels | null> {
  const guildConfig = await prisma.guildConfig.findUnique({ where: { id: guild.id } });
  if (!guildConfig?.modLogChannelId) {
    logger.debug(`[modlog] No mod-log channel configured for guild ${guild.id}; skipping embed.`);
    return null;
  }

  const channel = await guild.channels.fetch(guildConfig.modLogChannelId).catch(() => null);
  if (!channel || !channel.isSendable()) {
    logger.warn(
      `[modlog] Configured mod-log channel ${guildConfig.modLogChannelId} in guild ${guild.id} no longer exists or isn't a text channel.`,
      'Run /config modlog channel:<channel> to point it at a valid channel.',
    );
    return null;
  }
  return channel;
}

/**
 * Sends a rich embed to the guild's configured mod-log channel. This is
 * graceful-degradation by design (principle #5): a guild that hasn't run
 * /setup yet, or has removed the channel, still gets moderation actions
 * applied and recorded as a Case — they just won't see a log message, and
 * we log that clearly for the host instead of throwing.
 */
export async function postModLog(guild: Guild, entry: ModLogEntry): Promise<void> {
  const channel = await resolveModLogChannel(guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(ACTION_COLOR[entry.type] ?? 0x95a5a6)
    .setTitle(
      entry.caseNumber
        ? `Case #${entry.caseNumber} · ${entry.type.toUpperCase()}`
        : entry.type.toUpperCase(),
    )
    .addFields(
      { name: 'Member', value: `${entry.target} (${entry.target.tag})`, inline: true },
      { name: 'Moderator', value: `${entry.moderator} (${entry.moderator.tag})`, inline: true },
      { name: 'Reason', value: entry.reason ?? 'No reason provided' },
    )
    .setTimestamp();

  if (entry.durationMs) {
    embed.addFields({ name: 'Duration', value: formatDuration(entry.durationMs), inline: true });
  }

  await channel.send({ embeds: [embed] }).catch((err) => {
    logger.warn(
      `[modlog] Failed to send mod-log embed in guild ${guild.id}: ${(err as Error).message}`,
      'Check that the bot has View Channel + Send Messages + Embed Links permissions in the mod-log channel.',
    );
  });
}

/**
 * For moderator actions on channels rather than members (purge, lock,
 * slowmode, role changes): still logged with who did it and why (section 7),
 * just without a case number.
 */
export async function postModLogNote(
  guild: Guild,
  note: {
    title: string;
    moderator: User;
    fields: { name: string; value: string; inline?: boolean }[];
  },
): Promise<void> {
  const channel = await resolveModLogChannel(guild);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLOR.note!)
    .setTitle(note.title)
    .addFields(
      { name: 'Moderator', value: `${note.moderator} (${note.moderator.tag})`, inline: true },
      ...note.fields.map((f) => ({ ...f, value: f.value.slice(0, 1024) || '—' })),
    )
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((err) => {
    logger.warn(
      `[modlog] Failed to send mod-log note in guild ${guild.id}: ${(err as Error).message}`,
    );
  });
}

/** Same mod-log channel, for automated (non-Case) auto-mod actions. */
export async function postAutomodLog(guild: Guild, entry: AutomodLogEntry): Promise<void> {
  const channel = await resolveModLogChannel(guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(ACTION_COLOR.automod!)
    .setTitle(`AUTO-MOD · ${entry.rule}`)
    .addFields(
      { name: 'Member', value: `${entry.user} (${entry.user.tag})`, inline: true },
      { name: 'Channel', value: `<#${entry.channelId}>`, inline: true },
      { name: 'Reason', value: entry.reason },
    )
    .setTimestamp();

  if (entry.contentSnippet) {
    embed.addFields({ name: 'Matched content', value: entry.contentSnippet.slice(0, 1000) });
  }

  const sent = await channel.send({ embeds: [embed] }).catch((err) => {
    logger.warn(
      `[modlog] Failed to send auto-mod embed in guild ${guild.id}: ${(err as Error).message}`,
      'Check that the bot has View Channel + Send Messages + Embed Links permissions in the mod-log channel.',
    );
    return null;
  });
  // The snippet is member message text, so it expires (section 7).
  if (sent && entry.contentSnippet) {
    const config = await prisma.guildConfig.findUnique({
      where: { id: guild.id },
      select: { contentRetainDays: true },
    });
    await recordContentLog(sent, config?.contentRetainDays ?? 30);
  }
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
