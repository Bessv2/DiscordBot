import { describe, expect, it } from 'vitest';
import { startOfUtcDay } from '../src/lib/walletActions';

describe('startOfUtcDay', () => {
  it('truncates to UTC midnight of the same day', () => {
    expect(startOfUtcDay(new Date('2026-03-15T23:59:59.999Z')).toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('is unaffected by time of day', () => {
    const a = startOfUtcDay(new Date('2026-03-15T00:00:00.000Z'));
    const b = startOfUtcDay(new Date('2026-03-15T18:30:00.000Z'));
    expect(a.getTime()).toBe(b.getTime());
  });

  it('a claim made yesterday is before today\'s boundary, one made today is not', () => {
    const now = new Date('2026-03-15T09:00:00.000Z');
    expect(new Date('2026-03-14T23:00:00.000Z') < startOfUtcDay(now)).toBe(true);
    expect(new Date('2026-03-15T00:30:00.000Z') < startOfUtcDay(now)).toBe(false);
  });
});
