export interface DiceRollResult {
  rolls: number[];
  modifier: number;
  total: number;
}

const DICE_PATTERN = /^(\d*)d(\d+)([+-]\d+)?$/i;

/**
 * Parses standard dice notation: "2d20+5", "d6", "4d6-2". Returns null for
 * anything else. Pure function, no RNG dependency injected here — the
 * caller supplies randomness so this stays unit testable deterministically.
 */
export function parseDiceNotation(input: string): { count: number; sides: number; modifier: number } | null {
  const match = input.trim().match(DICE_PATTERN);
  if (!match) return null;

  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;

  if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
  return { count, sides, modifier };
}

export function rollDice(count: number, sides: number, modifier: number, rng: () => number = Math.random): DiceRollResult {
  const rolls = Array.from({ length: count }, () => Math.floor(rng() * sides) + 1);
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { rolls, modifier, total };
}
