// Upper bound so absurd inputs ("99999999d") can't overflow into an
// Invalid Date when added to Date.now(). Indefinite mutes are expressed by
// omitting the duration, not by a huge one.
export const MAX_DURATION_MS = 365 * 86_400_000;

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses a compact duration like "10m", "1h30m", "2d" into milliseconds.
 * Pure function — no Discord/DB dependency — so it's unit tested directly.
 * Returns null for anything unparseable, non-positive, or over MAX_DURATION_MS.
 */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  const matches = [...trimmed.matchAll(/(\d+)\s*(s|m|h|d)/g)];
  if (matches.length === 0) return null;

  // Reject stray characters outside the matched segments (e.g. "10x").
  const consumed = matches.map((m) => m[0]).join('');
  if (consumed.replace(/\s+/g, '') !== trimmed.replace(/\s+/g, '')) return null;

  let totalMs = 0;
  for (const match of matches) {
    const value = Number(match[1]);
    const unit = match[2] as string;
    totalMs += value * UNIT_MS[unit]!;
  }

  return totalMs > 0 && totalMs <= MAX_DURATION_MS ? totalMs : null;
}

const DISCORD_MAX_TIMEOUT_MS = 28 * 86_400_000;

export function clampToDiscordTimeoutLimit(ms: number): number {
  return Math.min(ms, DISCORD_MAX_TIMEOUT_MS);
}
