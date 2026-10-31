import { describe, expect, it } from 'vitest';
import { canClaimDaily } from '../src/lib/walletActions';

describe('canClaimDaily', () => {
  it('allows a claim when there is no prior claim', () => {
    expect(canClaimDaily(null)).toBe(true);
  });

  it('blocks a second claim on the same UTC day', () => {
    const now = new Date();
    expect(canClaimDaily(now)).toBe(false);
  });

  it('allows a claim after the UTC day has changed', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(canClaimDaily(yesterday)).toBe(true);
  });
});
