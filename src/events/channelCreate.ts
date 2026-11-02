import { NonThreadGuildBasedChannel } from 'discord.js';
import { prisma } from '../lib/db';
import { applyMuteOverwrite } from '../lib/muteActions';
import { logServerEvent } from '../serverlog/events';

export async function channelCreate(channel: NonThreadGuildBasedChannel): Promise<void> {
  const guildConfig = await prisma.guildConfig.findUnique({
    where: { id: channel.guild.id },
    select: { muteRoleId: true },
  });
  // Without this, a channel made after the Muted role existed would let
  // muted members talk in it.
  if (guildConfig?.muteRoleId) await applyMuteOverwrite(channel, guildConfig.muteRoleId);
  await logServerEvent(channel.guild, 'channels', {
    title: 'Channel created',
    description: `${channel} (\`#${channel.name}\`)`,
    color: 'create',
  });
}
