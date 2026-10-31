import { describe, expect, it } from 'vitest';
import { levelForXp, totalXpForLevel, xpToNextLevel } from '../src/lib/xp';

describe('totalXpForLevel', () => {
  it('requires zero XP for level 0', () => {
    expect(totalXpForLevel(0)).toBe(0);
  });

  it('increases monotonically', () => {
    expect(totalXpForLevel(2)).toBeGreaterThan(totalXpForLevel(1));
    expect(totalXpForLevel(10)).toBeGreaterThan(totalXpForLevel(9));
  });
});

describe('levelForXp', () => {
  it('returns 0 below the level-1 threshold', () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(totalXpForLevel(1) - 1)).toBe(0);
  });

  it('returns the exact level at its threshold', () => {
    expect(levelForXp(totalXpForLevel(5))).toBe(5);
  });

  it('does not round up to the next level early', () => {
    expect(levelForXp(totalXpForLevel(5) + 1)).toBe(5);
  });
});

describe('xpToNextLevel', () => {
  it('matches the gap to the next threshold', () => {
    const xp = totalXpForLevel(3) + 10;
    expect(xpToNextLevel(xp)).toBe(totalXpForLevel(4) - xp);
  });
});
