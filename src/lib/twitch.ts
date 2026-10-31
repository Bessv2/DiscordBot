import { config } from '../config';
import { logger } from './logger';

export interface TwitchStreamInfo {
  streamId: string;
  title: string;
  gameName: string;
  thumbnailUrl: string;
  viewerCount: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;
let warnedMissingConfig = false;

async function getAppToken(): Promise<string | null> {
  if (!config.TWITCH_CLIENT_ID || !config.TWITCH_CLIENT_SECRET) {
    if (!warnedMissingConfig) {
      logger.info('Twitch stream notifications are configured but TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET are not set — skipping.');
      warnedMissingConfig = true;
    }
    return null;
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const params = new URLSearchParams({
    client_id: config.TWITCH_CLIENT_ID,
    client_secret: config.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' });
  if (!res.ok) {
    logger.warn(`Twitch app-token request failed: ${res.status} ${res.statusText}`, 'Check TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET in .env.');
    return null;
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.token;
}

/** Looks up live status for up to 100 Twitch logins in one call. Returns only the ones currently live. */
export async function getLiveTwitchStreams(logins: string[]): Promise<Map<string, TwitchStreamInfo>> {
  const result = new Map<string, TwitchStreamInfo>();
  if (logins.length === 0) return result;

  const token = await getAppToken();
  if (!token || !config.TWITCH_CLIENT_ID) return result;

  const params = new URLSearchParams();
  for (const login of logins.slice(0, 100)) params.append('user_login', login);

  const res = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': config.TWITCH_CLIENT_ID },
  });
  if (!res.ok) {
    logger.warn(`Twitch streams lookup failed: ${res.status} ${res.statusText}`);
    return result;
  }

  const body = (await res.json()) as {
    data: { user_login: string; title: string; game_name: string; thumbnail_url: string; viewer_count: number; id: string }[];
  };
  for (const stream of body.data) {
    result.set(stream.user_login.toLowerCase(), {
      streamId: stream.id,
      title: stream.title,
      gameName: stream.game_name,
      thumbnailUrl: stream.thumbnail_url.replace('{width}', '640').replace('{height}', '360'),
      viewerCount: stream.viewer_count,
    });
  }
  return result;
}
