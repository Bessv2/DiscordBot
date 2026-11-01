import { GuildMember, PartialGuildMember } from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { renderTemplate } from '../lib/template';
import { logMemberLeave } from '../serverlog/handlers';

// Requires the privileged GuildMembers intent (ENABLE_GUILD_MEMBERS=true) —
// same as guildMemberAdd.
export async function guildMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  await logMemberLeave(member);
  const guildConfig = await prisma.guildConfig.findUnique({ where: { id: member.guild.id } });
  if (!guildConfig?.goodbyeChannelId) return;

  const channel = await member.guild.channels.fetch(guildConfig.goodbyeChannelId).catch(() => null);
  if (!channel?.isSendable()) return;

  // member may be partial on uncached removals; fall back to a plain mention/tag.
  const text = member.partial
    ? guildConfig.goodbyeMessage
        .replaceAll('{user}', `<@${member.id}>`)
        .replaceAll('{server}', member.guild.name)
        .replaceAll('{membercount}', `${member.guild.memberCount}`)
    : renderTemplate(guildConfig.goodbyeMessage, member);

  await channel.send(text).catch((err) => {
    logger.warn(
      `Could not send goodbye message in guild ${member.guild.id}: ${(err as Error).message}`,
    );
  });
}
