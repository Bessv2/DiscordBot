export interface Match {
  player1: string | null;
  player2: string | null;
  winner: string | null;
}
export type Bracket = Match[][];

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * Builds a single-elimination bracket. An odd participant count gives the
 * last pairing in round 1 a bye (no opponent), auto-advancing them — that's
 * the only point byes can originate, since every later round is generated
 * empty and filled in only as winners are reported.
 */
export function generateBracket(participants: string[]): Bracket {
  const shuffled = shuffle(participants);
  const round1: Match[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const player1 = shuffled[i]!;
    const player2 = shuffled[i + 1] ?? null;
    round1.push({ player1, player2, winner: player2 === null ? player1 : null });
  }

  const bracket: Bracket = [round1];
  let roundSize = round1.length;
  while (roundSize > 1) {
    roundSize = Math.ceil(roundSize / 2);
    bracket.push(Array.from({ length: roundSize }, () => ({ player1: null, player2: null, winner: null })));
  }

  for (let m = 0; m < round1.length; m++) {
    if (round1[m]!.winner) placeWinner(bracket, 0, m, round1[m]!.winner!);
  }

  return bracket;
}

function placeWinner(bracket: Bracket, roundIndex: number, matchIndex: number, winnerId: string): void {
  const nextRound = bracket[roundIndex + 1];
  if (!nextRound) return; // winnerId is the tournament champion
  const nextMatch = nextRound[Math.floor(matchIndex / 2)]!;
  if (matchIndex % 2 === 0) nextMatch.player1 = winnerId;
  else nextMatch.player2 = winnerId;
}

export function reportWinner(bracket: Bracket, roundIndex: number, matchIndex: number, winnerId: string): Bracket {
  const match = bracket[roundIndex]?.[matchIndex];
  if (!match) throw new Error('Invalid match');
  if (match.player1 !== winnerId && match.player2 !== winnerId) throw new Error('Winner must be one of the two players in that match');

  match.winner = winnerId;
  placeWinner(bracket, roundIndex, matchIndex, winnerId);
  return bracket;
}

/** Finds the first match still awaiting a result where both slots are filled — i.e. playable now. */
export function findNextPlayableMatch(bracket: Bracket): { roundIndex: number; matchIndex: number; match: Match } | null {
  for (let r = 0; r < bracket.length; r++) {
    for (let m = 0; m < bracket[r]!.length; m++) {
      const match = bracket[r]![m]!;
      if (!match.winner && match.player1 && match.player2) {
        return { roundIndex: r, matchIndex: m, match };
      }
    }
  }
  return null;
}

export function getChampion(bracket: Bracket): string | null {
  const lastRound = bracket[bracket.length - 1];
  return lastRound?.[0]?.winner ?? null;
}
