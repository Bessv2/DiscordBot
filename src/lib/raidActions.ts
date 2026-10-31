import { EmbedBuilder, Guild, GuildVerificationLevel } from 'discord.js';
import { prisma, getOrCreateGuildConfig } from './db';
import { logger } from './logger';

/**
 * Called when the join-rate tracker (src/lib/raidGuard.ts) flags a burst of
 * joins. If the guild opted into auto-lockdown, raises the verification
 * level (which blocks new-account joins without kicking anyone already in)
 * and remembers the prior level so /lockdown off can restore it exactly.
 * Always posts an alert to the mod-log either way — a host who didn't
 * enable auto-lockdown still wants to know a raid might be happening.
 */
export async function handleRaidDetected(guild: Guild): Promise<void> {
  const guildConfig = await getOrCreateGuildConfig(guild.id);

  if (guildConfig.raidAutoLockdown && !guildConfig.lockdownActive) {
    await prisma.guildConfig.update({
      where: { id: guild.id },
      data: { lockdownActive: true, preLockdownVerificationLevel: guild.verificationLevel },
    });
    await guild.setVerificationLevel(GuildVerificationLevel.High, 'Anti-raid auto-lockdown').catch((err) => {
      logger.warn(
        `Could not raise verification level for anti-raid lockdown in guild ${guild.id}: ${(err as Error).message}`,
        'Check the bot has the Manage Server permission.',
      );
    });
  }

  await postRaidAlert(guild, guildConfig.raidAutoLockdown && !guildConfig.lockdownActive);
}

async function postRaidAlert(guild: Guild, lockdownJustEngaged: boolean): Promise<void> {
  const guildConfig = await getOrCreateGuildConfig(guild.id);
  const channelId = guildConfig.modLogChannelId;
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isSendable()) return;

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('⚠️ Possible raid detected')
    .setDescription(
      lockdownJustEngaged
        ? 'A burst of joins tripped the anti-raid threshold. Verification level has been raised automatically. Run `/lockdown off` once things calm down.'
        : 'A burst of joins tripped the anti-raid threshold. Auto-lockdown is off, so no action was taken — run `/lockdown on` if you want to raise verification manually.',
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => undefined);
}

export async function setLockdown(guild: Guild, enabled: boolean): Promise<string> {
  const guildConfig = await getOrCreateGuildConfig(guild.id);

  if (enabled) {
    if (guildConfig.lockdownActive) return 'Lockdown is already active.';
    await prisma.guildConfig.update({
      where: { id: guild.id },
      data: { lockdownActive: true, preLockdownVerificationLevel: guild.verificationLevel },
    });
    await guild.setVerificationLevel(GuildVerificationLevel.High, 'Manual lockdown');
    return 'Lockdown enabled — verification level raised to High.';
  }

  if (!guildConfig.lockdownActive) return 'Lockdown is not currently active.';
  const restoreTo = (guildConfig.preLockdownVerificationLevel ?? GuildVerificationLevel.Medium) as GuildVerificationLevel;
  await guild.setVerificationLevel(restoreTo, 'Lockdown lifted');
  await prisma.guildConfig.update({
    where: { id: guild.id },
    data: { lockdownActive: false, preLockdownVerificationLevel: null },
  });
  return 'Lockdown lifted — verification level restored.';
}
