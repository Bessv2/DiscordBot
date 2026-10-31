import { config } from './config';
import { client } from './discord/client';
import { loadCommands } from './discord/commandHandler';
import { loadEvents } from './discord/eventHandler';
import { runStartupHealthCheck } from './lib/healthcheck';
import { prisma } from './lib/db';
import { logger } from './lib/logger';

async function main() {
  await runStartupHealthCheck();

  loadCommands(client);
  loadEvents(client);

  try {
    await client.login(config.DISCORD_TOKEN);
  } catch (err) {
    handleLoginError(err as Error);
    process.exit(1);
  }
}

function handleLoginError(err: Error): void {
  const message = err.message ?? String(err);

  if (message.includes('disallowed intents') || message.includes('Used disallowed intents')) {
    logger.error(
      `Discord rejected the connection: ${message}`,
      'You have ENABLE_MESSAGE_CONTENT=true in .env but haven\'t enabled it for your bot yet. ' +
        'Go to the Discord Developer Portal → your application → Bot → Privileged Gateway Intents, ' +
        'turn on "Message Content Intent", and restart. Or set ENABLE_MESSAGE_CONTENT=false if you ' +
        "don't need the invite/word filters or mention-spam detection.",
    );
    return;
  }

  if (message.includes('TOKEN_INVALID') || message.includes('An invalid token was provided')) {
    logger.error(
      `Discord rejected the bot token: ${message}`,
      'Double check DISCORD_TOKEN in .env against the Bot tab at https://discord.com/developers/applications ' +
        '— it may have been regenerated since you copied it.',
    );
    return;
  }

  logger.error(`Failed to log in to Discord: ${message}`);
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down...`);
  client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
// Backstop for any async path not already wrapped (collector callbacks,
// fire-and-forget sends). Node's default would exit the process.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${(reason as Error)?.stack ?? reason}`);
});

main().catch((err) => {
  logger.error(`Fatal startup error: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
