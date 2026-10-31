import { describe, expect, it } from 'vitest';
import { calculatePayout, payoutMultiplier, spinSlots } from '../src/lib/economy';

describe('payoutMultiplier', () => {
  it('pays the top multiplier for three diamonds', () => {
    expect(payoutMultiplier(['💎', '💎', '💎'])).toBe(10);
  });

  it('pays a mid multiplier for three stars', () => {
    expect(payoutMultiplier(['⭐', '⭐', '⭐'])).toBe(7);
  });

  it('pays the base three-of-a-kind multiplier for other symbols', () => {
    expect(payoutMultiplier(['🍒', '🍒', '🍒'])).toBe(5);
  });

  it('pays a small multiplier for two matching', () => {
    expect(payoutMultiplier(['🍒', '🍒', '🍋'])).toBe(2);
    expect(payoutMultiplier(['🍋', '🍒', '🍒'])).toBe(2);
  });

  it('pays nothing for no match', () => {
    expect(payoutMultiplier(['🍒', '🍋', '🔔'])).toBe(0);
  });
});

describe('calculatePayout', () => {
  it('multiplies the bet by the multiplier', () => {
    expect(calculatePayout(100, 5)).toBe(500);
    expect(calculatePayout(100, 0)).toBe(0);
  });
});

describe('spinSlots', () => {
  it('is deterministic with a fixed RNG', () => {
    const result = spinSlots(() => 0);
    expect(result.reels).toEqual(['🍒', '🍒', '🍒']);
    expect(result.multiplier).toBe(5);
  });
});
