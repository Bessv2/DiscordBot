// Rolling-window flood detection. Deliberately needs no message content —
// only "who sent a message and when" — so this works with zero privileged
// intents and is always available, even with ENABLE_MESSAGE_CONTENT=false.
const messageLog = new Map<string, number[]>();

/** Pure predicate, kept separate from the stateful tracker for unit testing. */
export function shouldFlagSpam(timestamps: number[], now: number, limit: number, intervalMs: number): boolean {
  return timestamps.filter((t) => t >= now - intervalMs).length >= limit;
}

export function recordMessageAndCheckSpam(key: string, now: number, limit: number, intervalMs: number): boolean {
  const existing = messageLog.get(key) ?? [];
  const pruned = existing.filter((t) => t >= now - intervalMs);
  pruned.push(now);
  messageLog.set(key, pruned);
  return shouldFlagSpam(pruned, now, limit, intervalMs);
}

// Keys for members who stopped posting would otherwise stay in the map
// forever, growing with every member who has ever spoken. The scheduler
// sweeps anyone whose newest message is older than this. It's far longer
// than any sane spam window (default 5s), so live tracking is unaffected.
export const SPAM_LOG_MAX_AGE_MS = 60 * 60_000;

/** Drops tracked users whose newest message is older than maxAgeMs. Returns how many were dropped. */
export function sweepSpamLog(now: number, maxAgeMs: number = SPAM_LOG_MAX_AGE_MS): number {
  let dropped = 0;
  for (const [key, timestamps] of messageLog) {
    const newest = timestamps[timestamps.length - 1];
    if (newest === undefined || now - newest > maxAgeMs) {
      messageLog.delete(key);
      dropped++;
    }
  }
  return dropped;
}
