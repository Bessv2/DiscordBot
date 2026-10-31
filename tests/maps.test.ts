import { describe, expect, it } from 'vitest';
import { MAX_MAP_NAME, normalizeGame, parseMapList, pickRandom } from '../src/lib/maps';

describe('parseMapList', () => {
  it('splits on commas/newlines, trims, and drops empties', () => {
    expect(parseMapList(' Ascent, Bind,,\nHaven ').maps).toEqual(['Ascent', 'Bind', 'Haven']);
  });

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(parseMapList('Dust 2, dust 2, DUST 2').maps).toEqual(['Dust 2']);
  });

  it('rejects names too long for a Discord poll answer', () => {
    const long = 'x'.repeat(MAX_MAP_NAME + 1);
    const result = parseMapList(`Mirage, ${long}`);
    expect(result.maps).toEqual(['Mirage']);
    expect(result.tooLong).toEqual([long]);
  });
});

describe('normalizeGame', () => {
  it('makes "Valorant" and " valorant " the same pool', () => {
    expect(normalizeGame(' Valorant ')).toBe(normalizeGame('valorant'));
    expect(normalizeGame('Counter   Strike 2')).toBe('counter strike 2');
  });
});

describe('pickRandom', () => {
  it('returns distinct items, never more than exist', () => {
    const picked = pickRandom(['a', 'b', 'c'], 10);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
  });

  it('is deterministic with an injected RNG and does not mutate the input', () => {
    const input = ['a', 'b', 'c', 'd'];
    expect(pickRandom(input, 2, () => 0)).toEqual(pickRandom(input, 2, () => 0));
    expect(input).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles a zero or negative count', () => {
    expect(pickRandom(['a'], 0)).toEqual([]);
    expect(pickRandom(['a'], -3)).toEqual([]);
  });
});
