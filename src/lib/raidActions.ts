import { EmbedBuilder, Guild, GuildVerificationLevel } from 'discord.js';
import { prisma, getOrCreateGuildConfig } from './db';
import { logger } from './logger';
import { shouldSendRaidAlert } from './raidGuard';

// Last alert time per guild, so a 100-account raid produces one alert per
// detection window instead of one per join past the threshold.
const lastAlertAt = new Map<string, number>();

/**
 * Atomically claims the lockdown: only succeeds if lockdown wasn't already
 * active, so concurrent join handlers can't both "engage" it — and the
 * second can't overwrite the saved pre-lockdown level with High. If Discord
 * then rejects the verification change, the claim is rolled back.
 */
async function engageLockdown(guild: Guild, reason: string): Promise<'engaged' | 'already' | 'failed'> {
  const previousLevel = guild.verificationLevel;
  const claimed = await prisma.guildConfig.updateMany({
    where: { id: guild.id, lockdownActive: false },
    data: { lockdownActive: true, preLockdownVerificationLevel: previousLevel },
  });
  if (claimed.count === 0) return 'already';

  try {
    await guild.setVerificationLevel(GuildVerificationLevel.High, reason);
    return 'engaged';
  } catch (err) {
    await prisma.guildConfig.update({
      where: { id: guild.id },
      data: { lockdownActive: false, preLockdownVerificationLevel: null },
    });
    logger.warn(
      `Could not raise verification level for lockdown in guild ${guild.id}: ${(err as Error).message}`,
      'Check the bot has the Manage Server permission.',
    );
    return 'failed';
  }
}

/**
 * Called when the join-rate tracker (src/lib/raidGuard.ts) flags a burst of
 * joins. If the guild opted into auto-lockdown, raises the verification
 * level (which blocks new-account joins without kicking anyone already in)
 * and remembers the prior level so /lockdown off can restore it exactly.
 * Always alerts the mod-log either way — a host who didn't enable
 * auto-lockdown still wants to know a raid might be happening.
 */
export async function handleRaidDetected(guild: Guild): Promise<void> {
  const guildConfig = await getOrCreateGuildConfig(guild.id);
  const outcome = guildConfig.raidAutoLockdown ? await engageLockdown(guild, 'Anti-raid auto-lockdown') : null;

  const now = Date.now();
  if (!shouldSendRaidAlert(lastAlertAt.get(guild.id) ?? null, now, guildConfig.raidIntervalMs)) return;
  lastAlertAt.set(guild.id, now);

  await postRaidAlert(guild, guildConfig.modLogChannelId, outcome);
}

async function postRaidAlert(guild: Guild, channelId: string | null, outcome: 'engaged' | 'already' | 'failed' | null): Promise<void> {
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isSendable()) return;

  const description = {
    engaged: 'A burst of joins tripped the anti-raid threshold. Verification level has been raised automatically. Run `/lockdown off` once things calm down.',
    already: 'A burst of joins tripped the anti-raid threshold. Lockdown is already active.',
    failed: "A burst of joins tripped the anti-raid threshold, but I couldn't raise the verification level — check I have the Manage Server permission, or run `/lockdown on` manually.",
    none: 'A burst of joins tripped the anti-raid threshold. Auto-lockdown is off, so no action was taken — run `/lockdown on` if you want to raise verification manually.',
  }[outcome ?? 'none'];

  const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle('⚠️ Possible raid detected').setDescription(description).setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => undefined);
}

export async function setLockdown(guild: Guild, enabled: boolean): Promise<string> {
  await getOrCreateGuildConfig(guild.id);

  if (enabled) {
    const outcome = await engageLockdown(guild, 'Manual lockdown');
    if (outcome === 'already') return 'Lockdown is already active.';
    if (outcome === 'failed') return "Couldn't raise the verification level — check I have the Manage Server permission.";
    return 'Lockdown enabled — verification level raised to High.';
  }

  const guildConfig = await getOrCreateGuildConfig(guild.id);
  if (!guildConfig.lockdownActive) return 'Lockdown is not currently active.';
  const restoreTo = (guildConfig.preLockdownVerificationLevel ?? GuildVerificationLevel.Medium) as GuildVerificationLevel;
  try {
    await guild.setVerificationLevel(restoreTo, 'Lockdown lifted');
  } catch (err) {
    return `Couldn't restore the verification level: ${(err as Error).message}`;
  }
  await prisma.guildConfig.update({
    where: { id: guild.id },
    data: { lockdownActive: false, preLockdownVerificationLevel: null },
  });
  return 'Lockdown lifted — verification level restored.';
}
