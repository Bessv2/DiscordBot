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
