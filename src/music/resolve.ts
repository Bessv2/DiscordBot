import { spawn } from 'node:child_process';

export interface Track {
  title: string;
  url: string;
  durationSec: number | null;
  requestedById: string;
  requestedByName: string;
}

export const MAX_PLAYLIST_TRACKS = 100;
export const MAX_TRACK_SECONDS = 3 * 60 * 60; // skips 10-hour loops and the like
const RESOLVE_TIMEOUT_MS = 30_000;

// Only YouTube links are fetched as links. Any other text is a YouTube
// search. That keeps yt-dlp from being pointed at arbitrary URLs, including
// addresses on the host's own network.
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export type QueryKind =
  | { kind: 'url'; url: string }
  | { kind: 'search'; term: string }
  | { kind: 'rejected'; reason: string };

export function classifyQuery(input: string): QueryKind {
  const text = input.trim();
  if (!text) return { kind: 'rejected', reason: 'Give a YouTube link or something to search for.' };
  if (/^https?:\/\//i.test(text)) {
    let host: string;
    try {
      host = new URL(text).hostname.toLowerCase();
    } catch {
      return { kind: 'rejected', reason: "That link doesn't look valid." };
    }
    if (!YOUTUBE_HOSTS.has(host))
      return {
        kind: 'rejected',
        reason: 'Only YouTube links are supported. Or type the song name to search YouTube.',
      };
    return { kind: 'url', url: text };
  }
  return { kind: 'search', term: text.slice(0, 200) };
}

interface YtDlpEntry {
  _type?: string;
  id?: string;
  title?: string;
  url?: string;
  webpage_url?: string;
  duration?: number | null;
  is_live?: boolean;
  live_status?: string;
  entries?: YtDlpEntry[];
}

export interface ResolveResult {
  tracks: Omit<Track, 'requestedById' | 'requestedByName'>[];
  playlistTitle: string | null;
  skipped: number;
}

/** Turns `yt-dlp -J --flat-playlist` output into tracks. Pure, so it's unit tested. */
export function parseYtDlpJson(json: string): ResolveResult {
  const data = JSON.parse(json) as YtDlpEntry;
  const isPlaylist = data._type === 'playlist' && Array.isArray(data.entries);
  const entries = isPlaylist ? data.entries! : [data];
  const tracks: ResolveResult['tracks'] = [];
  let skipped = 0;
  for (const e of entries) {
    const live = e.is_live || e.live_status === 'is_live';
    const url =
      e.webpage_url ??
      (e.url?.startsWith('http') ? e.url : e.id ? `https://www.youtube.com/watch?v=${e.id}` : null);
    const tooLong = typeof e.duration === 'number' && e.duration > MAX_TRACK_SECONDS;
    if (
      !url ||
      live ||
      tooLong ||
      !e.title ||
      e.title === '[Private video]' ||
      e.title === '[Deleted video]'
    ) {
      skipped++;
      continue;
    }
    if (tracks.length >= MAX_PLAYLIST_TRACKS) {
      skipped++;
      continue;
    }
    tracks.push({
      title: e.title,
      url,
      durationSec: typeof e.duration === 'number' ? e.duration : null,
    });
  }
  // A search ("ytsearch1:") also comes back as a playlist, but it isn't one to the user.
  const playlistTitle =
    isPlaylist && !data.id?.startsWith('ytsearch') && entries.length > 1
      ? (data.title ?? 'playlist')
      : null;
  return { tracks, playlistTitle, skipped };
}

/** Common yt-dlp flags. Node is already in the image, so it's YouTube's JS-challenge runtime. */
export const YTDLP_BASE_ARGS = ['--js-runtimes', 'node', '--no-warnings', '--ignore-config'];

export async function resolveQuery(input: string): Promise<ResolveResult> {
  const q = classifyQuery(input);
  if (q.kind === 'rejected') throw new UserFacingError(q.reason);
  const target = q.kind === 'url' ? q.url : `ytsearch1:${q.term}`;
  const stdout = await runYtDlp([...YTDLP_BASE_ARGS, '-J', '--flat-playlist', '--', target]);
  return parseYtDlpJson(stdout);
}

export class UserFacingError extends Error {}

function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), RESOLVE_TIMEOUT_MS);
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out) resolve(out);
      else if (/private|unavailable|not available|removed/i.test(err))
        reject(new UserFacingError('That video or playlist is private or unavailable.'));
      else
        reject(new Error(`yt-dlp exited with code ${code}: ${err.trim().split('\n').pop() ?? ''}`));
    });
  });
}

export function formatDuration(sec: number | null): string {
  if (sec === null) return '?:??';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
