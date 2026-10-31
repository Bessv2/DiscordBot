import { MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import { syncStarboard } from '../lib/starboard';
import { handleReactionRoleRemove } from '../lib/reactionRoles';
import { logger } from '../lib/logger';

export async function messageReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  if (user.bot) return;

  await syncStarboard(reaction).catch((err) => {
    logger.error(`Starboard sync threw: ${(err as Error).message}`);
  });
  await handleReactionRoleRemove(reaction, user).catch((err) => {
    logger.error(`Reaction-role remove threw: ${(err as Error).message}`);
  });
}
