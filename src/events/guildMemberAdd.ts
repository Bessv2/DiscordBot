import { GuildMember } from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { recordJoinAndCheckRaid } from '../lib/raidGuard';
import { handleRaidDetected } from '../lib/raidActions';
import { renderTemplate } from '../lib/template';
import { logMemberJoin } from '../serverlog/handlers';
import { giveJoinRoles } from '../features/joinRoles';

// Requires the privileged GuildMembers intent (ENABLE_GUILD_MEMBERS=true) —
// this event simply never fires without it, so both anti-raid join
// tracking and welcome messages are intent-gated as a unit.
export async function guildMemberAdd(member: GuildMember): Promise<void> {
  await logMemberJoin(member);
  await giveJoinRoles(member);
  const guildConfig = await prisma.guildConfig.findUnique({ where: { id: member.guild.id } });
  if (!guildConfig) return;

  if (guildConfig.antiRaidEnabled) {
    const flagged = recordJoinAndCheckRaid(
      member.guild.id,
      Date.now(),
      guildConfig.raidJoinThreshold,
      guildConfig.raidIntervalMs,
    );
    if (flagged) {
      await handleRaidDetected(member.guild).catch((err) => {
        logger.error(
          `Anti-raid handler threw in guild ${member.guild.id}: ${(err as Error).message}`,
        );
      });
    }
  }

  if (guildConfig.welcomeEnabled && guildConfig.welcomeChannelId) {
    const channel = await member.guild.channels
      .fetch(guildConfig.welcomeChannelId)
      .catch(() => null);
    if (channel?.isSendable()) {
      const text = renderTemplate(guildConfig.welcomeMessage, member);
      await channel.send(text).catch((err) => {
        logger.warn(
          `Could not send welcome message in guild ${member.guild.id}: ${(err as Error).message}`,
        );
      });
    }
  }
}
