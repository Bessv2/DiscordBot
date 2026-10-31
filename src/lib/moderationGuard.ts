import { Guild, GuildMember, Role, APIRole } from 'discord.js';

export interface HierarchyCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Role-hierarchy safety checks that apply on top of the permission-gate
 * system: even a member allowed to run /ban shouldn't be able to ban the
 * server owner or someone with a higher role, and the bot needs a high
 * enough role itself to carry out the action. Kept separate from the
 * permission gate because these are about *who can be targeted*, not
 * *who can run the command*.
 */
export function checkModerationHierarchy(
  guild: Guild,
  invoker: GuildMember,
  target: GuildMember,
  botMember: GuildMember,
): HierarchyCheckResult {
  if (target.id === invoker.id) {
    return { allowed: false, reason: "You can't moderate yourself." };
  }
  if (target.id === guild.ownerId) {
    return { allowed: false, reason: "You can't moderate the server owner." };
  }
  if (target.id === botMember.id) {
    return { allowed: false, reason: "You can't moderate the bot." };
  }
  if (!invoker.permissions.has('Administrator') && invoker.roles.highest.position <= target.roles.highest.position) {
    return {
      allowed: false,
      reason: "That member's highest role is above or equal to yours.",
    };
  }
  if (botMember.roles.highest.position <= target.roles.highest.position) {
    return {
      allowed: false,
      reason:
        "My highest role is below that member's — move my role above theirs in Server Settings → Roles.",
    };
  }
  return { allowed: true };
}

export interface RoleAssignInput {
  isEveryoneRole: boolean;
  isManaged: boolean;
  rolePosition: number;
  invokerIsOwner: boolean;
  invokerHighestPosition: number;
  botHighestPosition: number;
}

/**
 * Pure check for features that let the bot hand out a role automatically
 * (reaction roles, XP rewards, activity roles). Mirrors Discord's own rule
 * that you can only grant roles below your highest one — otherwise anyone
 * allowed to configure these could map an emoji to Administrator and react.
 */
export function evaluateRoleAssignable(input: RoleAssignInput): HierarchyCheckResult {
  if (input.isEveryoneRole) return { allowed: false, reason: "That's the @everyone role." };
  if (input.isManaged) return { allowed: false, reason: 'That role is managed by an integration or bot and can’t be assigned.' };
  if (!input.invokerIsOwner && input.rolePosition >= input.invokerHighestPosition) {
    return { allowed: false, reason: 'That role is above or equal to your highest role.' };
  }
  if (input.rolePosition >= input.botHighestPosition) {
    return {
      allowed: false,
      reason: 'That role is above my highest role — move my role above it in Server Settings → Roles.',
    };
  }
  return { allowed: true };
}

export async function checkRoleAssignable(
  guild: Guild,
  invoker: GuildMember,
  role: Role | APIRole,
): Promise<HierarchyCheckResult> {
  const fullRole = guild.roles.cache.get(role.id) ?? (await guild.roles.fetch(role.id).catch(() => null));
  if (!fullRole) return { allowed: false, reason: "I can't find that role." };
  const botMember = await guild.members.fetchMe();
  return evaluateRoleAssignable({
    isEveryoneRole: fullRole.id === guild.id,
    isManaged: fullRole.managed,
    rolePosition: fullRole.position,
    invokerIsOwner: invoker.id === guild.ownerId,
    invokerHighestPosition: invoker.roles.highest.position,
    botHighestPosition: botMember.roles.highest.position,
  });
}
