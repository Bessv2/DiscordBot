import { spawnSync } from 'node:child_process';
import { config } from '../config';
import { logger } from '../lib/logger';

/**
 * Startup check, only when ENABLE_MUSIC=true: confirms ffmpeg and yt-dlp
 * are installed, so a missing tool shows up once, with the fix, at boot,
 * instead of as a confusing failure the first time someone hits play.
 * Never fatal: the rest of the bot runs either way.
 */
export function checkMusicTools(): void {
  if (!config.ENABLE_MUSIC) return;
  const missing = ['ffmpeg', 'yt-dlp'].filter((bin) => {
    const r = spawnSync(bin, [bin === 'ffmpeg' ? '-version' : '--version'], {
      stdio: 'ignore',
      timeout: 10_000,
    });
    return r.error !== undefined || r.status !== 0;
  });
  if (missing.length === 0) {
    logger.info('Music is on: ffmpeg and yt-dlp found.');
    return;
  }
  logger.warn(
    `ENABLE_MUSIC=true, but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not installed, so /music won't work.`,
    'With Docker, also set BOT_IMAGE_TAG=music in .env (that image includes both), then run `docker compose up -d`. ' +
      'Without Docker, install ffmpeg and yt-dlp so both are on the PATH.',
  );
}
