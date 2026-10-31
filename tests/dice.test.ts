import { describe, expect, it } from 'vitest';
import { parseDiceNotation, rollDice } from '../src/lib/dice';

describe('parseDiceNotation', () => {
  it('parses a bare NdS expression', () => {
    expect(parseDiceNotation('2d20')).toEqual({ count: 2, sides: 20, modifier: 0 });
  });

  it('defaults count to 1 when omitted', () => {
    expect(parseDiceNotation('d6')).toEqual({ count: 1, sides: 6, modifier: 0 });
  });

  it('parses a positive modifier', () => {
    expect(parseDiceNotation('2d20+5')).toEqual({ count: 2, sides: 20, modifier: 5 });
  });

  it('parses a negative modifier', () => {
    expect(parseDiceNotation('4d6-2')).toEqual({ count: 4, sides: 6, modifier: -2 });
  });

  it('rejects out-of-range counts and sides', () => {
    expect(parseDiceNotation('101d6')).toBeNull();
    expect(parseDiceNotation('1d1')).toBeNull();
    expect(parseDiceNotation('1d1001')).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(parseDiceNotation('roll two dice')).toBeNull();
    expect(parseDiceNotation('')).toBeNull();
  });
});

describe('rollDice', () => {
  it('sums rolls plus the modifier using an injected RNG', () => {
    const fixedRng = () => 0.999; // always picks the top face
    const result = rollDice(2, 6, 3, fixedRng);
    expect(result.rolls).toEqual([6, 6]);
    expect(result.total).toBe(15); // 6 + 6 + 3
  });

  it('respects the lowest face with an RNG returning 0', () => {
    const result = rollDice(1, 20, 0, () => 0);
    expect(result.rolls).toEqual([1]);
    expect(result.total).toBe(1);
  });
});
