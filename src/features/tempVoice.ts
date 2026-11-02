import { ChannelType, Client, GuildMember, PermissionFlagsBits, VoiceState } from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { isModuleOn } from '../lib/modules';

// Join-to-create voice: joining the hub channel makes a room for you in the
// same category, owned by you (rename/limit/lock it with /voice), and moves
// you in. Rooms are deleted as soon as they're empty.

export async function handleTempVoice(before: VoiceState, after: VoiceState): Promise<void> {
  if (before.channelId === after.channelId) return;

  // Left a temp room: delete it if it's now empty.
  if (before.channelId) {
    const room = await prisma.tempVoiceChannel.findUnique({
      where: { channelId: before.channelId },
    });
    if (room && before.channel && before.channel.members.filter((m) => !m.user.bot).size === 0) {
      await before.channel.delete('Temp voice room is empty').catch(() => undefined);
      await prisma.tempVoiceChannel
        .delete({ where: { channelId: room.channelId } })
        .catch(() => undefined);
    }
  }

  // Joined the hub: make them a room.
  if (!after.channelId || !after.member || after.member.user.bot) return;
  const cfg = await prisma.guildConfig.findUnique({ where: { id: after.guild.id } });
  if (
    !cfg?.tempVoiceHubId ||
    after.channelId !== cfg.tempVoiceHubId ||
    !isModuleOn(cfg, 'tempvoice')
  )
    return;
  await createRoom(after.member, after.channel?.parentId ?? null, after.channel?.bitrate);
}

async function createRoom(
  member: GuildMember,
  parentId: string | null,
  bitrate?: number,
): Promise<void> {
  try {
    const room = await member.guild.channels.create({
      name: `${member.displayName}'s room`.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: parentId ?? undefined,
      bitrate,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.Connect,
          ],
        },
      ],
      reason: 'Join-to-create voice room',
    });
    await prisma.tempVoiceChannel.create({
      data: { channelId: room.id, guildId: member.guild.id, ownerId: member.id },
    });
    await member.voice.setChannel(room).catch(async () => {
      // They left before we could move them; don't leave an empty room behind.
      await room.delete().catch(() => undefined);
      await prisma.tempVoiceChannel
        .delete({ where: { channelId: room.id } })
        .catch(() => undefined);
    });
  } catch (err) {
    logger.warn(
      `Could not create a temp voice room in guild ${member.guild.id}: ${(err as Error).message}`,
      'Give the bot Manage Channels and Move Members.',
    );
  }
}

/** On startup: rooms emptied while the bot was offline get cleaned up. */
export async function cleanupTempVoice(client: Client<true>): Promise<void> {
  const rooms = await prisma.tempVoiceChannel.findMany();
  for (const r of rooms) {
    const channel = await client.channels.fetch(r.channelId).catch(() => null);
    if (
      !channel ||
      (channel.isVoiceBased() && channel.members.filter((m) => !m.user.bot).size === 0)
    ) {
      if (channel?.isVoiceBased())
        await channel.delete('Temp voice room is empty').catch(() => undefined);
      await prisma.tempVoiceChannel
        .delete({ where: { channelId: r.channelId } })
        .catch(() => undefined);
    }
  }
}
