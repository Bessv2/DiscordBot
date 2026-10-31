import { Message } from 'discord.js';
import { config } from '../config';
import { runAutomod } from '../automod';
import { handlePrefixCommand } from '../discord/prefixHandler';
import { handleMessageXp } from '../xp/engine';
import { logger } from '../lib/logger';

export async function messageCreate(message: Message): Promise<void> {
  if (message.author.bot || !message.inGuild()) return;

  await runAutomod(message).catch((err) => {
    logger.error(`Automod threw on a message in guild ${message.guild.id}: ${(err as Error).message}`);
  });

  await handleMessageXp(message).catch((err) => {
    logger.error(`XP engine threw on a message in guild ${message.guild.id}: ${(err as Error).message}`);
  });

  if (config.ENABLE_PREFIX_COMMANDS) {
    await handlePrefixCommand(message).catch((err) => {
      logger.error(`Prefix command handler threw in guild ${message.guild.id}: ${(err as Error).message}`);
    });
  }
}
