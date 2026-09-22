import { GuildMember, PermissionResolvable, PermissionFlagsBits } from 'discord.js';
import { prisma } from './db';

export type CommandScope = 'moderation' | 'admin' | 'utility';

export interface PermissionCheckInput {
  isAdministrator: boolean;
  /** Role IDs an admin has explicitly configured for this scope via /setup or /config. Empty = not configured. */
  configuredRoleIds: string[];
  memberRoleIds: string[];
  /** Whether the member satisfies the command's default native-Discord-permission requirement. Null = command has none (open to everyone). */
  hasNativePermission: boolean | null;
}

/**
 * Pure decision function, kept separate from Discord/DB IO so it's unit
 * testable. Rule: Administrator always passes. Otherwise, if the guild has
 * configured specific roles for this scope, membership in one of those
 * roles is required — full stop, regardless of native Discord permissions.
 * That's what makes this "not just Discord's built-in permissions": an
 * admin can hand out a narrower or wider grant than the native permission
 * model allows. Only when nothing is configured do we fall back to the
 * command's native-permission default, so the bot is usable immediately
 * after invite, before anyone has run /setup.
 */
export function evaluatePermission(input: PermissionCheckInput): boolean {
  if (input.isAdministrator) return true;

  if (input.configuredRoleIds.length > 0) {
    const configured = new Set(input.configuredRoleIds);
    return input.memberRoleIds.some((id) => configured.has(id));
  }

  return input.hasNativePermission ?? true;
}

export async function getConfiguredRoleIds(guildId: string, scope: CommandScope): Promise<string[]> {
  const rows = await prisma.permissionRole.findMany({
    where: { guildId, scope },
    select: { roleId: true },
  });
  return rows.map((r) => r.roleId);
}

/** Replaces the full set of roles gating a scope — used by /setup and /config. */
export async function setPermissionRoles(guildId: string, scope: CommandScope, roleIds: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.permissionRole.deleteMany({ where: { guildId, scope } }),
    prisma.permissionRole.createMany({
      data: roleIds.map((roleId) => ({ guildId, roleId, scope })),
    }),
  ]);
}

/**
 * @param nativePermission The Discord permission a command requires when the
 * guild hasn't configured explicit roles for its scope. Pass null for
 * commands that should be open to everyone by default (e.g. utility).
 */
export async function memberHasPermission(
  member: GuildMember,
  scope: CommandScope,
  nativePermission: PermissionResolvable | null,
): Promise<boolean> {
  const configuredRoleIds = await getConfiguredRoleIds(member.guild.id, scope);
  return evaluatePermission({
    isAdministrator: member.permissions.has(PermissionFlagsBits.Administrator),
    configuredRoleIds,
    memberRoleIds: [...member.roles.cache.keys()],
    hasNativePermission: nativePermission === null ? null : member.permissions.has(nativePermission),
  });
}
