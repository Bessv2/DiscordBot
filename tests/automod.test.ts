import { describe, expect, it } from 'vitest';
import { shouldFlagSpam } from '../src/automod/spam';
import { containsInviteLink } from '../src/automod/invite';
import { findBannedWord } from '../src/automod/wordFilter';
import { isMentionSpam } from '../src/automod/mentionSpam';

describe('shouldFlagSpam', () => {
  it('flags when message count within the window meets the limit', () => {
    const now = 10_000;
    const timestamps = [8000, 8500, 9000, 9500];
    expect(shouldFlagSpam(timestamps, now, 5, 5000)).toBe(false);
    expect(shouldFlagSpam([...timestamps, now], now, 5, 5000)).toBe(true);
  });

  it('ignores timestamps outside the rolling window', () => {
    const now = 20_000;
    const timestamps = [1000, 2000, 3000, 4000, 5000]; // all far outside a 5s window
    expect(shouldFlagSpam(timestamps, now, 5, 5000)).toBe(false);
  });
});

describe('containsInviteLink', () => {
  it('matches discord.gg invites', () => {
    expect(containsInviteLink('join us at discord.gg/abc123')).toBe(true);
  });

  it('matches discord.com/invite links', () => {
    expect(containsInviteLink('https://discord.com/invite/abc123')).toBe(true);
  });

  it('does not match unrelated links', () => {
    expect(containsInviteLink('check out https://example.com/discord.gg-fanpage')).toBe(false);
  });

  it('does not match plain text mentioning discord', () => {
    expect(containsInviteLink('I love using Discord with my friends')).toBe(false);
  });
});

describe('findBannedWord', () => {
  it('finds a banned word as a whole word, case-insensitively', () => {
    expect(findBannedWord('this message contains BadWord in it', ['badword'])).toBe('badword');
  });

  it('does not flag a banned word that is a substring of another word', () => {
    expect(findBannedWord('the classroom is big', ['ass'])).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(findBannedWord('a totally clean message', ['badword'])).toBeNull();
  });

  it('ignores empty entries in the banned word list', () => {
    expect(findBannedWord('hello world', ['', '   '])).toBeNull();
  });
});

describe('isMentionSpam', () => {
  it('flags when mention count meets the limit', () => {
    expect(isMentionSpam(5, 5)).toBe(true);
    expect(isMentionSpam(4, 5)).toBe(false);
  });
});
