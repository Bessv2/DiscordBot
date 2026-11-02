import { Message } from 'discord.js';
import { config } from '../config';
import { runAutomod } from '../automod';
import { handlePrefixCommand } from '../discord/prefixHandler';
import { handleMessageXp } from '../xp/engine';
import { logger } from '../lib/logger';
import { runAutoResponders } from '../features/autoResponders';
import { triageMessage } from '../features/aiTriage';

export async function messageCreate(message: Message): Promise<void> {
  if (message.author.bot || !message.inGuild()) return;

  const flagged = await runAutomod(message).catch((err) => {
    logger.error(
      `Automod threw on a message in guild ${message.guild.id}: ${(err as Error).message}`,
    );
    return false;
  });
  // A message auto-mod just deleted shouldn't earn XP or run a prefix command.
  if (flagged) return;

  // Not awaited: an API call must never slow down the rest of the bot.
  void triageMessage(message).catch((err) => {
    logger.debug(`AI triage failed in guild ${message.guild.id}: ${(err as Error).message}`);
  });

  await handleMessageXp(message).catch((err) => {
    logger.error(
      `XP engine threw on a message in guild ${message.guild.id}: ${(err as Error).message}`,
    );
  });

  // Trigger phrases need the message text, so only with Message Content on.
  if (config.ENABLE_MESSAGE_CONTENT) {
    await runAutoResponders(message).catch((err) => {
      logger.error(`Auto-responder threw in guild ${message.guild.id}: ${(err as Error).message}`);
    });
  }

  if (config.ENABLE_PREFIX_COMMANDS) {
    await handlePrefixCommand(message).catch((err) => {
      logger.error(
        `Prefix command handler threw in guild ${message.guild.id}: ${(err as Error).message}`,
      );
    });
  }
}
