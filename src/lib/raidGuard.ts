// Pure anti-raid join-rate logic, kept separate from Discord/DB IO so it's
// unit tested directly. Note: unlike automod's spam tracker, this DOES
// need a privileged intent at the call site — guildMemberAdd is gated
// behind GuildMembers (ENABLE_GUILD_MEMBERS=true), same as welcome
// messages. There's no non-privileged substitute for join events.
const joinLog = new Map<string, number[]>();

export function shouldFlagRaid(timestamps: number[], now: number, threshold: number, intervalMs: number): boolean {
  return timestamps.filter((t) => t >= now - intervalMs).length >= threshold;
}

export function recordJoinAndCheckRaid(guildId: string, now: number, threshold: number, intervalMs: number): boolean {
  const existing = joinLog.get(guildId) ?? [];
  const pruned = existing.filter((t) => t >= now - intervalMs);
  pruned.push(now);
  joinLog.set(guildId, pruned);
  return shouldFlagRaid(pruned, now, threshold, intervalMs);
}
