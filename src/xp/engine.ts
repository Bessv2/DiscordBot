import { Message } from 'discord.js';
import { prisma } from '../lib/db';
import { levelForXp } from '../lib/xp';
import { logger } from '../lib/logger';

/**
 * Message-based XP gain with a per-user cooldown so a burst of messages
 * can't farm levels. Doesn't need the Message Content intent — only the
 * fact that a message was sent matters, not what it says.
 */
export async function handleMessageXp(message: Message<true>): Promise<void> {
  const guildConfig = await prisma.guildConfig.findUnique({ where: { id: message.guild.id } });
  if (!guildConfig?.xpEnabled || !message.member) return;

  const existing = await prisma.userXp.findUnique({
    where: { guildId_userId: { guildId: message.guild.id, userId: message.author.id } },
  });

  const now = new Date();
  if (existing?.lastMessageAt && now.getTime() - existing.lastMessageAt.getTime() < guildConfig.xpCooldownSec * 1000) {
    return;
  }

  const range = Math.max(0, guildConfig.xpMaxPerMsg - guildConfig.xpMinPerMsg);
  const gained = guildConfig.xpMinPerMsg + Math.floor(Math.random() * (range + 1));
  const oldXp = existing?.xp ?? 0;
  const newXp = oldXp + gained;
  const oldLevel = levelForXp(oldXp);
  const newLevel = levelForXp(newXp);

  await prisma.userXp.upsert({
    where: { guildId_userId: { guildId: message.guild.id, userId: message.author.id } },
    create: { guildId: message.guild.id, userId: message.author.id, xp: newXp, level: newLevel, lastMessageAt: now },
    update: { xp: newXp, level: newLevel, lastMessageAt: now },
  });

  if (newLevel > oldLevel) {
    await message.channel.send(`🎉 ${message.author} leveled up to **level ${newLevel}**!`).catch(() => undefined);

    const reward = await prisma.levelRoleReward.findUnique({
      where: { guildId_level: { guildId: message.guild.id, level: newLevel } },
    });
    if (reward) {
      await message.member.roles.add(reward.roleId).catch((err) => {
        logger.warn(`Could not add level-reward role ${reward.roleId} to ${message.author.id}: ${(err as Error).message}`);
      });
    }
  }
}
