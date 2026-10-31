import { describe, expect, it } from 'vitest';
import { findNextPlayableMatch, generateBracket, getChampion, reportWinner } from '../src/lib/bracket';

describe('generateBracket', () => {
  it('pairs up an even number of participants with no byes', () => {
    const bracket = generateBracket(['a', 'b', 'c', 'd']);
    expect(bracket[0]).toHaveLength(2);
    expect(bracket[0]!.every((m) => m.player1 && m.player2 && !m.winner)).toBe(true);
    expect(bracket).toHaveLength(2); // round of 4 -> final
  });

  it('gives the last participant a bye on an odd count, auto-advanced to round 2', () => {
    const bracket = generateBracket(['a', 'b', 'c']);
    const byeMatch = bracket[0]!.find((m) => m.player2 === null);
    expect(byeMatch?.winner).toBe(byeMatch?.player1);
    // the bye winner should already be seeded into round 2
    const seededInRound2 = bracket[1]!.some((m) => m.player1 === byeMatch?.winner || m.player2 === byeMatch?.winner);
    expect(seededInRound2).toBe(true);
  });

  it('includes everyone exactly once in round 1', () => {
    const participants = ['a', 'b', 'c', 'd', 'e'];
    const bracket = generateBracket(participants);
    const seen = bracket[0]!.flatMap((m) => [m.player1, m.player2]).filter(Boolean);
    expect(seen.sort()).toEqual([...participants].sort());
  });
});

describe('reportWinner + findNextPlayableMatch + getChampion', () => {
  it('walks a 4-player bracket to completion', () => {
    let bracket = generateBracket(['a', 'b', 'c', 'd']);

    let next = findNextPlayableMatch(bracket);
    expect(next).not.toBeNull();
    bracket = reportWinner(bracket, next!.roundIndex, next!.matchIndex, next!.match.player1!);

    next = findNextPlayableMatch(bracket);
    expect(next).not.toBeNull();
    bracket = reportWinner(bracket, next!.roundIndex, next!.matchIndex, next!.match.player1!);

    // Both round-1 matches decided — the final should now be playable.
    next = findNextPlayableMatch(bracket);
    expect(next?.roundIndex).toBe(1);
    bracket = reportWinner(bracket, next!.roundIndex, next!.matchIndex, next!.match.player2!);

    expect(getChampion(bracket)).toBe(next!.match.player2);
    expect(findNextPlayableMatch(bracket)).toBeNull();
  });

  it('rejects a reported winner who was not in that match', () => {
    const bracket = generateBracket(['a', 'b']);
    expect(() => reportWinner(bracket, 0, 0, 'nobody')).toThrow();
  });
});
