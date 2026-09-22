import { Guild, GuildMember } from 'discord.js';

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
