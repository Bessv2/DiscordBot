import { describe, expect, it } from 'vitest';
import { SHARED_PREFIX, firstShare, isSharedBan, sharedReason } from '../src/features/banNetwork';

describe('ban sharing', () => {
  it('marks shared bans so they are never passed on again (no loops)', () => {
    const r = sharedReason('Partner Server', 'spam bot');
    expect(r).toBe(`${SHARED_PREFIX} Partner Server: spam bot`);
    expect(isSharedBan(r)).toBe(true);
    expect(isSharedBan('spam bot')).toBe(false);
    expect(isSharedBan(null)).toBe(false);
    expect(sharedReason('S', null)).toMatch(/no reason given/);
    expect(sharedReason('S', 'x'.repeat(600))).toHaveLength(512);
  });
  it('shares each ban once per network for ten minutes', () => {
    expect(firstShare(1, 'u1', 0)).toBe(true);
    expect(firstShare(1, 'u1', 60_000)).toBe(false);
    expect(firstShare(2, 'u1', 60_000)).toBe(true);
    expect(firstShare(1, 'u1', 11 * 60_000)).toBe(true);
  });
});
