import { ActivityType, Presence } from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { rolesToAssign } from '../lib/activityRoles';

// Requires the privileged GuildPresences intent (ENABLE_PRESENCE=true) —
// this event never fires without it, so the whole feature is intent-gated
// as a unit (see src/discord/client.ts for why this is opt-in only).
export async function presenceUpdate(_oldPresence: Presence | null, newPresence: Presence): Promise<void> {
  const member = newPresence.member;
  if (!member) return;

  const mappings = await prisma.voiceActivityRole.findMany({ where: { guildId: member.guild.id } });
  if (mappings.length === 0) return;

  const activityNames = newPresence.activities.filter((a) => a.type === ActivityType.Playing).map((a) => a.name);
  const shouldHave = rolesToAssign(
    activityNames,
    mappings.map((m) => ({ pattern: m.gameNamePattern, roleId: m.roleId })),
  );

  for (const mapping of mappings) {
    const hasRole = member.roles.cache.has(mapping.roleId);
    const wants = shouldHave.has(mapping.roleId);
    if (wants && !hasRole) {
      await member.roles.add(mapping.roleId).catch((err) => {
        logger.warn(`Could not add activity role ${mapping.roleId} to ${member.id}: ${(err as Error).message}`);
      });
    } else if (!wants && hasRole) {
      await member.roles.remove(mapping.roleId).catch((err) => {
        logger.warn(`Could not remove activity role ${mapping.roleId} from ${member.id}: ${(err as Error).message}`);
      });
    }
  }
}
