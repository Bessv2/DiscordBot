// Pure helpers for /map, kept free of Discord/DB so they're unit tested.

/** Discord poll answers are capped at 55 characters, so map names are too. */
export const MAX_MAP_NAME = 55;
export const MAX_MAPS_PER_GAME = 100;
/** Discord polls allow at most 10 answers. */
export const MAX_POLL_CHOICES = 10;

export function normalizeGame(game: string): string {
  return game.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** "Ascent, Bind,, Haven " → ["Ascent", "Bind", "Haven"], deduped case-insensitively. */
export function parseMapList(input: string): { maps: string[]; tooLong: string[] } {
  const seen = new Set<string>();
  const maps: string[] = [];
  const tooLong: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (name.length > MAX_MAP_NAME) {
      tooLong.push(name);
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    maps.push(name);
  }
  return { maps, tooLong };
}

/** Picks `count` distinct items (Fisher–Yates on a copy). `rng` is injectable for tests. */
export function pickRandom<T>(
  items: readonly T[],
  count: number,
  rng: () => number = Math.random,
): T[] {
  const copy = [...items];
  const n = Math.min(Math.max(count, 0), copy.length);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}
