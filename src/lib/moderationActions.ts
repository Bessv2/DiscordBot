import { Guild, GuildMember, Message, User } from 'discord.js';
import { prisma } from './db';
import { checkModerationHierarchy } from './moderationGuard';
import { createCase } from './caseManager';
import { postModLog } from './modlog';
import { buildAppealButtonRow } from './appealActions';

// Core moderation actions, kept independent of *how* they were invoked
// (slash command vs. opt-in legacy prefix command) so there is exactly one
// implementation of "what a ban does" to reason about and test.
export interface ActionResult {
  ok: boolean;
  message: string;
  caseNumber?: number;
}

async function resolveBotMember(guild: Guild): Promise<GuildMember> {
  return guild.members.fetchMe();
}

// Kick/ban have to DM *before* the action — once someone is removed the bot
// usually shares no server with them and the DM fails. So if Discord then
// rejects the action, undo both: no phantom case, no "you were banned" DM
// with a live appeal link for a ban that never happened.
async function rollbackCase(caseId: number, dm: Message | null): Promise<void> {
  await prisma.case.delete({ where: { id: caseId } }).catch(() => undefined);
  await dm?.delete().catch(() => undefined);
}

export async function warnMember(
  guild: Guild,
  invoker: GuildMember,
  target: GuildMember,
  moderator: User,
  reason: string | null,
): Promise<ActionResult> {
  const botMember = await resolveBotMember(guild);
  const hierarchy = checkModerationHierarchy(guild, invoker, target, botMember);
  if (!hierarchy.allowed) return { ok: false, message: hierarchy.reason! };

  const record = await createCase({
    guildId: guild.id,
    type: 'warn',
    targetId: target.id,
    targetTag: target.user.tag,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag,
    reason,
  });

  const dmOk = await target
    .send({
      content: `You were warned in **${guild.name}**${reason ? `: ${reason}` : '.'}`,
      components: [buildAppealButtonRow(record.id)],
    })
    .then(() => true)
    .catch(() => false);

  await postModLog(guild, { type: 'warn', caseNumber: record.caseNumber, target: target.user, moderator, reason });

  return {
    ok: true,
    message: `Warned ${target.user.tag} (case #${record.caseNumber})${dmOk ? '' : ' — could not DM them.'}`,
    caseNumber: record.caseNumber,
  };
}

export async function kickMember(
  guild: Guild,
  invoker: GuildMember,
  target: GuildMember,
  moderator: User,
  reason: string | null,
): Promise<ActionResult> {
  const botMember = await resolveBotMember(guild);
  const hierarchy = checkModerationHierarchy(guild, invoker, target, botMember);
  if (!hierarchy.allowed) return { ok: false, message: hierarchy.reason! };
  if (!target.kickable) {
    return { ok: false, message: "I don't have permission to kick that member." };
  }

  const record = await createCase({
    guildId: guild.id,
    type: 'kick',
    targetId: target.id,
    targetTag: target.user.tag,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag,
    reason,
  });

  const dm = await target
    .send({
      content: `You were kicked from **${guild.name}**${reason ? `: ${reason}` : '.'}`,
      components: [buildAppealButtonRow(record.id)],
    })
    .catch(() => null);

  try {
    await target.kick(reason ?? undefined);
  } catch (err) {
    await rollbackCase(record.id, dm);
    return { ok: false, message: `Discord rejected the kick: ${(err as Error).message}` };
  }

  await postModLog(guild, { type: 'kick', caseNumber: record.caseNumber, target: target.user, moderator, reason });

  return { ok: true, message: `Kicked ${target.user.tag} (case #${record.caseNumber})`, caseNumber: record.caseNumber };
}

export async function banMember(
  guild: Guild,
  invoker: GuildMember,
  targetUser: User,
  moderator: User,
  reason: string | null,
  deleteMessageSeconds: number,
): Promise<ActionResult> {
  const botMember = await resolveBotMember(guild);
  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

  if (targetMember) {
    const hierarchy = checkModerationHierarchy(guild, invoker, targetMember, botMember);
    if (!hierarchy.allowed) return { ok: false, message: hierarchy.reason! };
    if (!targetMember.bannable) {
      return { ok: false, message: "I don't have permission to ban that member." };
    }
  } else if (targetUser.id === invoker.id || targetUser.id === guild.client.user.id) {
    return { ok: false, message: "You can't ban yourself or the bot." };
  }

  const record = await createCase({
    guildId: guild.id,
    type: 'ban',
    targetId: targetUser.id,
    targetTag: targetUser.tag,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag,
    reason,
  });

  const dm = await targetUser
    .send({
      content: `You were banned from **${guild.name}**${reason ? `: ${reason}` : '.'}`,
      components: [buildAppealButtonRow(record.id)],
    })
    .catch(() => null);

  try {
    await guild.members.ban(targetUser.id, { reason: reason ?? undefined, deleteMessageSeconds });
  } catch (err) {
    await rollbackCase(record.id, dm);
    return { ok: false, message: `Discord rejected the ban: ${(err as Error).message}` };
  }

  await postModLog(guild, { type: 'ban', caseNumber: record.caseNumber, target: targetUser, moderator, reason });

  return { ok: true, message: `Banned ${targetUser.tag} (case #${record.caseNumber})`, caseNumber: record.caseNumber };
}

export async function timeoutMember(
  guild: Guild,
  invoker: GuildMember,
  target: GuildMember,
  moderator: User,
  reason: string | null,
  durationMs: number,
): Promise<ActionResult> {
  const botMember = await resolveBotMember(guild);
  const hierarchy = checkModerationHierarchy(guild, invoker, target, botMember);
  if (!hierarchy.allowed) return { ok: false, message: hierarchy.reason! };
  if (!target.moderatable) {
    return { ok: false, message: "I don't have permission to time out that member." };
  }

  // The member stays in the server, so the DM can safely come after — do the action first.
  try {
    await target.timeout(durationMs, reason ?? undefined);
  } catch (err) {
    return { ok: false, message: `Discord rejected the timeout: ${(err as Error).message}` };
  }

  const record = await createCase({
    guildId: guild.id,
    type: 'timeout',
    targetId: target.id,
    targetTag: target.user.tag,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag,
    reason,
    durationMs,
  });

  await target
    .send({
      content: `You were timed out in **${guild.name}**${reason ? `: ${reason}` : '.'}`,
      components: [buildAppealButtonRow(record.id)],
    })
    .catch(() => null);

  await postModLog(guild, { type: 'timeout', caseNumber: record.caseNumber, target: target.user, moderator, reason, durationMs });

  return {
    ok: true,
    message: `Timed out ${target.user.tag} (case #${record.caseNumber})`,
    caseNumber: record.caseNumber,
  };
}
