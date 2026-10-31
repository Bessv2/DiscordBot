import { Client, Guild, GuildMember, PermissionFlagsBits, User } from 'discord.js';
import { prisma, getOrCreateGuildConfig } from './db';
import { checkModerationHierarchy } from './moderationGuard';
import { createCase } from './caseManager';
import { postModLog } from './modlog';
import { logger } from './logger';
import type { ActionResult } from './moderationActions';
import { buildAppealButtonRow } from './appealActions';

/**
 * Role-based mute, complementing native /timeout (Discord caps timeouts at
 * 28 days; a mute here can last indefinitely). Lazily creates a "Muted"
 * role with channel overwrites denying Send Messages/Speak the first time
 * it's needed, rather than requiring the host to set one up by hand.
 */
export async function getOrCreateMuteRole(guild: Guild): Promise<string> {
  const guildConfig = await getOrCreateGuildConfig(guild.id);
  if (guildConfig.muteRoleId) {
    const existing = await guild.roles.fetch(guildConfig.muteRoleId).catch(() => null);
    if (existing) return existing.id;
  }

  const byName = guild.roles.cache.find((r) => r.name === 'Muted');
  if (byName) {
    await prisma.guildConfig.update({ where: { id: guild.id }, data: { muteRoleId: byName.id } });
    return byName.id;
  }

  const role = await guild.roles.create({
    name: 'Muted',
    permissions: [],
    reason: 'Auto-created by /mute for role-based muting.',
  });

  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (!channel || !channel.manageable) continue;
    await channel.permissionOverwrites
      .edit(role, { SendMessages: false, AddReactions: false, Speak: false, Stream: false })
      .catch((err) => {
        logger.warn(`Could not set Muted role overwrite on channel ${channel.id} in guild ${guild.id}: ${(err as Error).message}`);
      });
  }

  await prisma.guildConfig.update({ where: { id: guild.id }, data: { muteRoleId: role.id } });
  return role.id;
}

export async function muteMember(
  guild: Guild,
  invoker: GuildMember,
  target: GuildMember,
  moderator: User,
  reason: string | null,
  durationMs: number | null,
): Promise<ActionResult> {
  const botMember = await guild.members.fetchMe();
  const hierarchy = checkModerationHierarchy(guild, invoker, target, botMember);
  if (!hierarchy.allowed) return { ok: false, message: hierarchy.reason! };
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, message: "I don't have permission to manage roles." };
  }

  const roleId = await getOrCreateMuteRole(guild);
  try {
    await target.roles.add(roleId, reason ?? undefined);
  } catch (err) {
    return { ok: false, message: `Discord rejected the mute: ${(err as Error).message}` };
  }

  await prisma.mute.updateMany({ where: { guildId: guild.id, userId: target.id, active: true }, data: { active: false } });
  await prisma.mute.create({
    data: {
      guildId: guild.id,
      userId: target.id,
      expiresAt: durationMs ? new Date(Date.now() + durationMs) : null,
    },
  });

  const record = await createCase({
    guildId: guild.id,
    type: 'mute',
    targetId: target.id,
    targetTag: target.user.tag,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag,
    reason,
    durationMs,
  });

  await target
    .send({
      content: `You were muted in **${guild.name}**${reason ? `: ${reason}` : '.'}`,
      components: [buildAppealButtonRow(record.id)],
    })
    .catch(() => null);

  await postModLog(guild, { type: 'mute' as const, caseNumber: record.caseNumber, target: target.user, moderator, reason, durationMs });

  return {
    ok: true,
    message: `Muted ${target.user.tag}${durationMs ? ` for ${Math.round(durationMs / 60000)}m` : ' indefinitely'} (case #${record.caseNumber})`,
    caseNumber: record.caseNumber,
  };
}

export async function unmuteMember(guild: Guild, target: GuildMember, moderator: User, reason: string | null): Promise<ActionResult> {
  if (target.id === moderator.id) return { ok: false, message: "You can't unmute yourself." };
  const guildConfig = await getOrCreateGuildConfig(guild.id);
  if (guildConfig.muteRoleId) {
    await target.roles.remove(guildConfig.muteRoleId, reason ?? 'Unmuted').catch(() => null);
  }
  await prisma.mute.updateMany({ where: { guildId: guild.id, userId: target.id, active: true }, data: { active: false } });

  await postModLog(guild, {
    type: 'unmute',
    target: target.user,
    moderator,
    reason: reason ?? 'Unmuted',
  });

  return { ok: true, message: `Unmuted ${target.user.tag}.` };
}

/** Scheduler job: lift any mute whose expiresAt has passed. */
export async function checkExpiredMutes(client: Client<true>): Promise<void> {
  const due = await prisma.mute.findMany({
    where: { active: true, expiresAt: { lte: new Date() } },
  });

  for (const mute of due) {
    await prisma.mute.update({ where: { id: mute.id }, data: { active: false } });

    const guild = await client.guilds.fetch(mute.guildId).catch(() => null);
    if (!guild) continue;
    const guildConfig = await getOrCreateGuildConfig(mute.guildId);
    if (!guildConfig.muteRoleId) continue;

    const member = await guild.members.fetch(mute.userId).catch(() => null);
    if (!member) continue;

    await member.roles.remove(guildConfig.muteRoleId, 'Mute expired').catch((err) => {
      logger.warn(`Could not auto-remove expired mute role for ${mute.userId} in guild ${mute.guildId}: ${(err as Error).message}`);
    });
  }
}
