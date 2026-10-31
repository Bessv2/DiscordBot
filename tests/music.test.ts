import { describe, expect, it } from 'vitest';
import {
  MAX_PLAYLIST_TRACKS,
  MAX_TRACK_SECONDS,
  classifyQuery,
  formatDuration,
  parseYtDlpJson,
} from '../src/music/resolve';

describe('classifyQuery', () => {
  it('accepts YouTube video, short, music and playlist links', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=abc',
      'https://www.youtube.com/playlist?list=PL123',
    ]) {
      expect(classifyQuery(url)).toEqual({ kind: 'url', url });
    }
  });

  it('refuses links to anything that is not YouTube, including local network addresses', () => {
    for (const url of [
      'http://192.168.1.1/admin',
      'http://localhost:8080',
      'https://evil.example/youtube.com',
      'https://youtube.com.evil.example/x',
    ]) {
      expect(classifyQuery(url).kind).toBe('rejected');
    }
  });

  it('treats plain text as a search, even text that starts with a dash', () => {
    expect(classifyQuery('daft punk one more time')).toEqual({
      kind: 'search',
      term: 'daft punk one more time',
    });
    expect(classifyQuery('--exec rm -rf /')).toEqual({ kind: 'search', term: '--exec rm -rf /' });
  });

  it('rejects empty input', () => {
    expect(classifyQuery('   ').kind).toBe('rejected');
  });
});

describe('parseYtDlpJson', () => {
  it('reads a single video', () => {
    const r = parseYtDlpJson(
      JSON.stringify({
        id: 'a',
        title: 'Song',
        webpage_url: 'https://www.youtube.com/watch?v=a',
        duration: 200,
      }),
    );
    expect(r.tracks).toEqual([
      { title: 'Song', url: 'https://www.youtube.com/watch?v=a', durationSec: 200 },
    ]);
    expect(r.playlistTitle).toBeNull();
  });

  it('reads a flat playlist and builds URLs from IDs', () => {
    const r = parseYtDlpJson(
      JSON.stringify({
        _type: 'playlist',
        id: 'PL1',
        title: 'Jams',
        entries: [
          { id: 'a', title: 'One', duration: 100 },
          { id: 'b', title: 'Two', url: 'https://www.youtube.com/watch?v=b', duration: null },
        ],
      }),
    );
    expect(r.playlistTitle).toBe('Jams');
    expect(r.tracks.map((t) => t.url)).toEqual([
      'https://www.youtube.com/watch?v=a',
      'https://www.youtube.com/watch?v=b',
    ]);
    expect(r.tracks[1]!.durationSec).toBeNull();
  });

  it('skips live streams, over-long videos, and private/deleted entries', () => {
    const r = parseYtDlpJson(
      JSON.stringify({
        _type: 'playlist',
        id: 'PL2',
        title: 'Mixed',
        entries: [
          { id: 'ok', title: 'Fine', duration: 60 },
          { id: 'live', title: 'Live', is_live: true },
          { id: 'long', title: 'Ten hours', duration: MAX_TRACK_SECONDS + 1 },
          { id: 'p', title: '[Private video]' },
        ],
      }),
    );
    expect(r.tracks.map((t) => t.title)).toEqual(['Fine']);
    expect(r.skipped).toBe(3);
  });

  it(`caps a playlist at ${MAX_PLAYLIST_TRACKS} tracks`, () => {
    const entries = Array.from({ length: MAX_PLAYLIST_TRACKS + 5 }, (_, i) => ({
      id: `v${i}`,
      title: `T${i}`,
      duration: 10,
    }));
    const r = parseYtDlpJson(
      JSON.stringify({ _type: 'playlist', id: 'PL3', title: 'Big', entries }),
    );
    expect(r.tracks).toHaveLength(MAX_PLAYLIST_TRACKS);
    expect(r.skipped).toBe(5);
  });

  it('does not call a search result a playlist', () => {
    const r = parseYtDlpJson(
      JSON.stringify({
        _type: 'playlist',
        id: 'ytsearch1:song',
        title: 'song',
        entries: [{ id: 'a', title: 'Song', duration: 10 }],
      }),
    );
    expect(r.playlistTitle).toBeNull();
    expect(r.tracks).toHaveLength(1);
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(null)).toBe('?:??');
  });
});
