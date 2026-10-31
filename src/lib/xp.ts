/**
 * MEE6-style XP curve: total XP required to reach a given level. Pure and
 * unit tested so the leveling logic can be reasoned about without a live
 * Discord/DB round-trip.
 */
export function totalXpForLevel(level: number): number {
  if (level <= 0) return 0;
  return 5 * level * level + 50 * level + 100;
}

/** Highest level whose XP requirement `totalXp` has met or passed. */
export function levelForXp(totalXp: number): number {
  let level = 0;
  while (totalXpForLevel(level + 1) <= totalXp) {
    level += 1;
  }
  return level;
}

export function xpToNextLevel(totalXp: number): number {
  const currentLevel = levelForXp(totalXp);
  return totalXpForLevel(currentLevel + 1) - totalXp;
}
