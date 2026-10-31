import { MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import { prisma } from './db';
import { logger } from './logger';
import { isModuleEnabledForGuild } from './modules';

function emojiKey(reaction: MessageReaction | PartialMessageReaction): string {
  return reaction.emoji.id ?? reaction.emoji.name ?? '';
}

export async function handleReactionRoleAdd(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
  if (!reaction.message.guildId) return;
  const row = await prisma.reactionRole.findUnique({
    where: { guildId_messageId_emoji: { guildId: reaction.message.guildId, messageId: reaction.message.id, emoji: emojiKey(reaction) } },
  });
  if (!row || !(await isModuleEnabledForGuild(row.guildId, 'reactionroles'))) return;

  const guild = reaction.message.guild;
  const member = await guild?.members.fetch(user.id).catch(() => null);
  await member?.roles.add(row.roleId).catch((err) => {
    logger.warn(`Could not add reaction role ${row.roleId} to ${user.id} in guild ${row.guildId}: ${(err as Error).message}`);
  });
}

export async function handleReactionRoleRemove(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
  if (!reaction.message.guildId) return;
  const row = await prisma.reactionRole.findUnique({
    where: { guildId_messageId_emoji: { guildId: reaction.message.guildId, messageId: reaction.message.id, emoji: emojiKey(reaction) } },
  });
  if (!row || !(await isModuleEnabledForGuild(row.guildId, 'reactionroles'))) return;

  const guild = reaction.message.guild;
  const member = await guild?.members.fetch(user.id).catch(() => null);
  await member?.roles.remove(row.roleId).catch((err) => {
    logger.warn(`Could not remove reaction role ${row.roleId} from ${user.id} in guild ${row.guildId}: ${(err as Error).message}`);
  });
}
