import { Client, EmbedBuilder } from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { getLiveTwitchStreams } from '../lib/twitch';
import { getYoutubeLiveVideo } from '../lib/youtube';
import { guildIdsWithModuleOff } from '../lib/modules';

/**
 * Scheduler job (slow tick, every 5 min): for each /streamwatch entry,
 * check whether the streamer just went live, and if so — and we haven't
 * already announced this specific stream/video — post an embed. Fails
 * closed per-platform: missing API credentials just skip that platform,
 * logged once (see src/lib/twitch.ts and src/lib/youtube.ts).
 */
export async function checkStreamNotifications(client: Client<true>): Promise<void> {
  // Servers that switched stream alerts off are dropped before any API
  // call, so they cost no Twitch/YouTube quota.
  const off = await guildIdsWithModuleOff('streams');
  const rows = (await prisma.streamNotification.findMany()).filter((r) => !off.has(r.guildId));
  if (rows.length === 0) return;

  const twitchRows = rows.filter((r) => r.platform === 'twitch');
  const youtubeRows = rows.filter((r) => r.platform === 'youtube');

  if (twitchRows.length > 0) {
    const logins = [...new Set(twitchRows.map((r) => r.channelName.toLowerCase()))];
    const live = await getLiveTwitchStreams(logins);
    for (const row of twitchRows) {
      const info = live.get(row.channelName.toLowerCase());
      if (!info || info.streamId === row.lastAnnouncedId) continue;

      await announce(client, row.channelId, {
        title: `${row.channelName} is live on Twitch!`,
        description: info.title,
        url: `https://twitch.tv/${row.channelName}`,
        thumbnail: info.thumbnailUrl,
        footer: `Playing ${info.gameName || 'something'} · ${info.viewerCount} viewers`,
      });
      await prisma.streamNotification.update({ where: { id: row.id }, data: { lastAnnouncedId: info.streamId } });
    }
  }

  for (const row of youtubeRows) {
    const live = await getYoutubeLiveVideo(row.channelName).catch((err) => {
      logger.warn(`YouTube check failed for ${row.channelName}: ${(err as Error).message}`);
      return null;
    });
    if (!live || live.videoId === row.lastAnnouncedId) continue;

    await announce(client, row.channelId, {
      title: `${row.channelName} is live on YouTube!`,
      description: live.title,
      url: `https://youtube.com/watch?v=${live.videoId}`,
      thumbnail: live.thumbnailUrl,
    });
    await prisma.streamNotification.update({ where: { id: row.id }, data: { lastAnnouncedId: live.videoId } });
  }
}

async function announce(
  client: Client<true>,
  channelId: string,
  entry: { title: string; description: string; url: string; thumbnail: string; footer?: string },
): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isSendable()) {
    logger.warn(`Stream-notification channel ${channelId} no longer exists or isn't text-based.`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x9146ff)
    .setTitle(entry.title)
    .setURL(entry.url)
    .setDescription(entry.description)
    .setImage(entry.thumbnail);
  if (entry.footer) embed.setFooter({ text: entry.footer });

  await channel.send({ content: entry.url, embeds: [embed] }).catch((err) => {
    logger.warn(`Could not post stream notification in channel ${channelId}: ${(err as Error).message}`);
  });
}
