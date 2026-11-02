import { describe, expect, it } from 'vitest';

process.env.DISCORD_TOKEN ??= 'test-token';

const now = Date.UTC(2026, 10, 1);
const msg = (
  id: string,
  o: Partial<{
    authorId: string;
    bot: boolean;
    content: string;
    ageDays: number;
    pinned: boolean;
  }> = {},
) => ({
  id,
  authorId: o.authorId ?? 'u1',
  bot: o.bot ?? false,
  content: o.content ?? '',
  createdAt: now - (o.ageDays ?? 0) * 86_400_000,
  pinned: o.pinned ?? false,
});

describe('selectPurgeTargets', async () => {
  const { selectPurgeTargets } = await import('../src/commands/moderation/purge');
  it('never touches pinned messages or ones Discord cannot bulk-delete (14+ days old)', () => {
    const ids = selectPurgeTargets(
      [msg('1'), msg('2', { pinned: true }), msg('3', { ageDays: 15 })],
      { amount: 10, now },
    );
    expect(ids).toEqual(['1']);
  });
  it('filters by member, bots and text, then caps at the amount', () => {
    const list = [
      msg('1', { authorId: 'a' }),
      msg('2', { authorId: 'b', bot: true, content: 'Buy NOW' }),
      msg('3', { authorId: 'a', content: 'buy now' }),
      msg('4', { authorId: 'a' }),
    ];
    expect(selectPurgeTargets(list, { amount: 10, userId: 'a', now })).toEqual(['1', '3', '4']);
    expect(selectPurgeTargets(list, { amount: 10, botsOnly: true, now })).toEqual(['2']);
    expect(selectPurgeTargets(list, { amount: 10, contains: 'buy now', now })).toEqual(['2', '3']);
    expect(selectPurgeTargets(list, { amount: 2, now })).toEqual(['1', '2']);
  });
});
