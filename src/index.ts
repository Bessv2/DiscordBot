import { config } from './config';
import { client } from './discord/client';
import { loadCommands } from './discord/commandHandler';
import { loadEvents } from './discord/eventHandler';
import { runStartupHealthCheck } from './lib/healthcheck';
import { prisma } from './lib/db';
import { logger } from './lib/logger';
import { checkMusicTools } from './music/check';
import { stopAllMusic } from './commands/fun/music';
import { loadPlugins, pluginsReady } from './plugins/loader';

async function main() {
  await runStartupHealthCheck();
  checkMusicTools();

  // Plugins first, so their commands are registered with Discord too.
  loadPlugins(client);
  client.once('ready', () => void pluginsReady());
  loadCommands(client);
  loadEvents(client);

  try {
    await client.login(config.DISCORD_TOKEN);
  } catch (err) {
    handleLoginError(err as Error);
    process.exit(1);
  }

  // Loaded only when switched on, so a host who never uses it never loads express.
  if (config.ENABLE_DASHBOARD) {
    const { startDashboard } = await import('./dashboard/server');
    startDashboard(client);
  }
}

function handleLoginError(err: Error): void {
  const message = err.message ?? String(err);

  if (message.includes('disallowed intents') || message.includes('Used disallowed intents')) {
    // Name exactly which switches the host turned on, so they know which
    // toggles to look for in the portal.
    const wanted = [
      config.ENABLE_MESSAGE_CONTENT && '"Message Content Intent" (ENABLE_MESSAGE_CONTENT)',
      config.ENABLE_GUILD_MEMBERS && '"Server Members Intent" (ENABLE_GUILD_MEMBERS)',
      config.ENABLE_PRESENCE && '"Presence Intent" (ENABLE_PRESENCE)',
    ].filter(Boolean);
    logger.error(
      `Discord rejected the connection: ${message}`,
      `.env turns on ${wanted.join(', ')}, but the matching switch isn't on for your bot yet. ` +
        'Go to https://discord.com/developers/applications → your application → Bot → Privileged Gateway Intents, ' +
        'turn those on and click Save Changes, then restart. Or set the matching ENABLE_... line in .env back to false.',
    );
    return;
  }

  if (message.includes('TOKEN_INVALID') || message.includes('An invalid token was provided')) {
    logger.error(
      `Discord rejected the bot token: ${message}`,
      'Double check DISCORD_TOKEN in .env against the Bot tab at https://discord.com/developers/applications ' +
        '(Bot → Reset Token). It must be the bot token from the Bot tab, not the "Client Secret" from the OAuth2 tab, ' +
        'and it may have been regenerated since you copied it.',
    );
    return;
  }

  logger.error(`Failed to log in to Discord: ${message}`);
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down...`);
  stopAllMusic(); // kills ffmpeg/yt-dlp children before the process exits
  if (config.ENABLE_DASHBOARD) await (await import('./dashboard/server')).stopDashboard();
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
