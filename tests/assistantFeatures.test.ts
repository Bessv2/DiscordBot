import { describe, expect, it } from 'vitest';
import { isServerLogEventOn } from '../src/serverlog/events';
import { redactEmbeds } from '../src/lib/contentRetention';
import { matchResponder } from '../src/features/autoResponders';
import { nextRun } from '../src/features/announcements';
import { transcriptLine } from '../src/features/tickets';
import { parseStringList } from '../src/lib/jsonList';

process.env.DISCORD_TOKEN ??= 'test-token';

describe('server log event switches', () => {
  it('logs everything by default and skips switched-off kinds', () => {
    expect(isServerLogEventOn('[]', 'messages')).toBe(true);
    expect(isServerLogEventOn('["voice"]', 'voice')).toBe(false);
    expect(isServerLogEventOn('["voice"]', 'bans')).toBe(true);
    expect(isServerLogEventOn('garbage', 'roles')).toBe(true);
  });
});

describe('message text retention', () => {
  it('removes only message-text fields and keeps who/where/when', () => {
    const out = redactEmbeds(
      [
        {
          title: 'Message deleted',
          fields: [
            { name: 'Message', value: 'secret' },
            { name: 'Channel', value: '#general' },
            { name: 'Matched content', value: 'bad' },
          ],
        },
      ],
      30,
    )!;
    expect(out[0]!.fields!.map((f) => f.value)).toEqual([
      '*(removed after 30 days)*',
      '#general',
      '*(removed after 30 days)*',
    ]);
    expect(out[0]!.title).toBe('Message deleted');
  });

  it('returns null when there is nothing to remove (already removed, or no text)', () => {
    expect(redactEmbeds([{ fields: [{ name: 'Channel', value: '#x' }] }], 1)).toBeNull();
    expect(
      redactEmbeds([{ fields: [{ name: 'Before', value: '*(removed after 1 day)*' }] }], 1),
    ).toBeNull();
  });
});

describe('auto-responders', () => {
  const list = [
    { trigger: 'how do i join', matchType: 'contains', response: 'A' },
    { trigger: 'ip', matchType: 'exact', response: 'B' },
    { trigger: '!rules', matchType: 'starts', response: 'C' },
  ];
  it('matches whole words anywhere for "contains"', () => {
    expect(matchResponder('Hey, how do I join this?', list)?.response).toBe('A');
    expect(matchResponder('somehow do i joint', list)).toBeNull();
  });
  it('"exact" needs the whole message; "starts" the beginning', () => {
    expect(matchResponder('IP', list)?.response).toBe('B');
    expect(matchResponder('whats the ip', list)).toBeNull();
    expect(matchResponder('!rules please', list)?.response).toBe('C');
  });
  it('treats regex characters in triggers literally', () => {
    expect(
      matchResponder('what is c++ for', [{ trigger: 'c++', matchType: 'contains', response: 'ok' }])
        ?.response,
    ).toBe('ok');
  });
});

describe('announcement repeats', () => {
  it('moves a daily announcement on by a day', () => {
    const t = new Date('2026-11-01T10:00:00Z');
    expect(nextRun(t, 'daily', new Date('2026-11-01T10:00:01Z'))!.toISOString()).toBe(
      '2026-11-02T10:00:00.000Z',
    );
  });
  it('skips runs missed while the bot was offline instead of posting them all', () => {
    const t = new Date('2026-11-01T10:00:00Z');
    expect(nextRun(t, 'weekly', new Date('2026-11-20T00:00:00Z'))!.toISOString()).toBe(
      '2026-11-22T10:00:00.000Z',
    );
  });
  it('one-off announcements have no next run', () => {
    expect(nextRun(new Date(), 'none', new Date())).toBeNull();
  });
});

describe('ticket transcripts', () => {
  it('writes one readable line per message, with attachments', () => {
    expect(
      transcriptLine({
        createdAt: new Date('2026-11-01T09:05:00Z'),
        authorTag: 'uma',
        content: 'hi',
        attachments: [],
      }),
    ).toBe('[2026-11-01 09:05] uma: hi');
    expect(
      transcriptLine({
        createdAt: new Date('2026-11-01T09:05:00Z'),
        authorTag: 'uma',
        content: '',
        attachments: ['https://x/y.png'],
      }),
    ).toBe('[2026-11-01 09:05] uma:  [attachments: https://x/y.png]');
  });
});

describe('parseStringList', () => {
  it('reads string arrays and survives junk', () => {
    expect(parseStringList('["a",1,"b"]')).toEqual(['a', 'b']);
    expect(parseStringList('{')).toEqual([]);
    expect(parseStringList(null)).toEqual([]);
  });
});
