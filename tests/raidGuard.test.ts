import { describe, expect, it } from 'vitest';
import { shouldFlagRaid } from '../src/lib/raidGuard';

describe('shouldFlagRaid', () => {
  it('flags when join count within the window meets the threshold', () => {
    const now = 10_000;
    const joins = [8000, 8500, 9000, 9500];
    expect(shouldFlagRaid(joins, now, 5, 5000)).toBe(false);
    expect(shouldFlagRaid([...joins, now], now, 5, 5000)).toBe(true);
  });

  it('ignores joins outside the rolling window', () => {
    const now = 20_000;
    const joins = [1000, 2000, 3000, 4000, 5000];
    expect(shouldFlagRaid(joins, now, 5, 5000)).toBe(false);
  });
});
