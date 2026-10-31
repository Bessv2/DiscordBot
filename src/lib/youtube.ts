import { config } from '../config';
import { logger } from './logger';

export interface YoutubeLiveInfo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
}

let warnedMissingConfig = false;

/**
 * Checks whether a YouTube channel is currently live. Costs 100 quota units
 * per call against YouTube Data API v3's default 10,000/day budget — poll
 * sparingly (the scheduler's slow tick, every 5 minutes) and keep the
 * number of watched channels modest.
 *
 * channelId must be the channel's "UC..." ID, not an @handle — resolving a
 * handle to an ID would cost an extra API call per check, so hosts are
 * asked to provide the ID directly (see /streamwatch's option description).
 */
export async function getYoutubeLiveVideo(channelId: string): Promise<YoutubeLiveInfo | null> {
  if (!config.YOUTUBE_API_KEY) {
    if (!warnedMissingConfig) {
      logger.info('YouTube stream notifications are configured but YOUTUBE_API_KEY is not set — skipping.');
      warnedMissingConfig = true;
    }
    return null;
  }

  const params = new URLSearchParams({
    key: config.YOUTUBE_API_KEY,
    channelId,
    eventType: 'live',
    type: 'video',
    part: 'snippet',
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) {
    logger.warn(`YouTube live-check failed for channel ${channelId}: ${res.status} ${res.statusText}`);
    return null;
  }

  const body = (await res.json()) as {
    items: { id: { videoId: string }; snippet: { title: string; thumbnails: { high: { url: string } } } }[];
  };
  const live = body.items[0];
  if (!live) return null;

  return { videoId: live.id.videoId, title: live.snippet.title, thumbnailUrl: live.snippet.thumbnails.high.url };
}
