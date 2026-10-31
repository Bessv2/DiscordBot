import { MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import { syncStarboard } from '../lib/starboard';
import { handleReactionRoleAdd } from '../lib/reactionRoles';
import { logger } from '../lib/logger';

export async function messageReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  if (user.bot) return;

  await syncStarboard(reaction as MessageReaction).catch((err) => {
    logger.error(`Starboard sync threw: ${(err as Error).message}`);
  });
  await handleReactionRoleAdd(reaction, user).catch((err) => {
    logger.error(`Reaction-role add threw: ${(err as Error).message}`);
  });
}
