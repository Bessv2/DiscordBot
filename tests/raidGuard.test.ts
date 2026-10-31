import { describe, expect, it } from 'vitest';
import { shouldFlagRaid, shouldSendRaidAlert } from '../src/lib/raidGuard';

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

describe('shouldSendRaidAlert', () => {
  it('alerts the first time', () => {
    expect(shouldSendRaidAlert(null, 1000, 60_000)).toBe(true);
  });

  it('suppresses repeat alerts inside the window, so a raid posts once not once per join', () => {
    expect(shouldSendRaidAlert(1000, 30_000, 60_000)).toBe(false);
  });

  it('alerts again once the window has passed', () => {
    expect(shouldSendRaidAlert(1000, 61_000, 60_000)).toBe(true);
  });
});
