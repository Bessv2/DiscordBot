const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎'] as const;
export type SlotSymbol = (typeof SYMBOLS)[number];

export interface SlotSpinResult {
  reels: [SlotSymbol, SlotSymbol, SlotSymbol];
  multiplier: number;
}

/** Pure spin — RNG is injected so outcomes are deterministic in tests. */
export function spinSlots(rng: () => number = Math.random): SlotSpinResult {
  const reels = [pick(rng), pick(rng), pick(rng)] as [SlotSymbol, SlotSymbol, SlotSymbol];
  return { reels, multiplier: payoutMultiplier(reels) };
}

function pick(rng: () => number): SlotSymbol {
  return SYMBOLS[Math.floor(rng() * SYMBOLS.length)]!;
}

export function payoutMultiplier(reels: [SlotSymbol, SlotSymbol, SlotSymbol]): number {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    if (a === '💎') return 10;
    if (a === '⭐') return 7;
    return 5;
  }
  if (a === b || b === c || a === c) return 2;
  return 0;
}

export function calculatePayout(bet: number, multiplier: number): number {
  return bet * multiplier;
}
