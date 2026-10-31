import { describe, expect, it } from 'vitest';
import { clampToDiscordTimeoutLimit, MAX_DURATION_MS, parseDuration } from '../src/lib/duration';

describe('parseDuration', () => {
  it('parses single units', () => {
    expect(parseDuration('10m')).toBe(10 * 60_000);
    expect(parseDuration('1h')).toBe(60 * 60_000);
    expect(parseDuration('2d')).toBe(2 * 86_400_000);
    expect(parseDuration('30s')).toBe(30_000);
  });

  it('parses compound durations', () => {
    expect(parseDuration('1h30m')).toBe(90 * 60_000);
  });

  it('is case-insensitive and tolerant of whitespace', () => {
    expect(parseDuration(' 1H 30M ')).toBe(90 * 60_000);
  });

  it('returns null for unparseable input', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('10x')).toBeNull();
    expect(parseDuration('10')).toBeNull();
  });

  it('returns null for a zero duration', () => {
    expect(parseDuration('0m')).toBeNull();
  });
});

describe('clampToDiscordTimeoutLimit', () => {
  it('passes through durations under the 28-day cap', () => {
    expect(clampToDiscordTimeoutLimit(60_000)).toBe(60_000);
  });

  it('clamps durations over the 28-day cap', () => {
    const overLimit = 30 * 86_400_000;
    expect(clampToDiscordTimeoutLimit(overLimit)).toBe(28 * 86_400_000);
  });
});

describe('parseDuration upper bound', () => {
  it('accepts exactly the maximum', () => {
    expect(parseDuration('365d')).toBe(MAX_DURATION_MS);
  });

  it('rejects anything over it, so huge input can never become an Invalid Date', () => {
    expect(parseDuration('366d')).toBeNull();
    expect(parseDuration('99999999d')).toBeNull();
  });
});
