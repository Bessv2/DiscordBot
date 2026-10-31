// Manual fallback — `npm run deploy-commands` (or `deploy-commands:dev`
// from a source checkout). The bot already registers its commands on
// startup whenever they change (see commandSync.ts), so most hosts never
// need this. It's here for forcing a re-register, e.g. after deleting the
// commands from Discord by hand.
import { REST, Routes } from 'discord.js';
import { config } from '../config';
import { logger } from '../lib/logger';
import { commands } from '../commands';

async function main() {
  const body = commands.map((c) => c.data.toJSON());
  const rest = new REST().setToken(config.DISCORD_TOKEN);

  // The application ID can be looked up from the token, so hosts don't
  // have to copy it from the Developer Portal as well.
  const applicationId =
    config.DISCORD_CLIENT_ID ||
    ((await rest.get(Routes.currentApplication())) as { id: string }).id;

  const route = config.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(applicationId, config.DISCORD_GUILD_ID)
    : Routes.applicationCommands(applicationId);

  const scope = config.DISCORD_GUILD_ID
    ? `guild ${config.DISCORD_GUILD_ID} (instant)`
    : 'globally (may take a few minutes to appear)';

  logger.info(`Registering ${body.length} slash command(s) ${scope}...`);
  await rest.put(route, { body });
  logger.info('Done.');
}

main().catch((err) => {
  logger.error(
    `Failed to register slash commands: ${(err as Error).message}`,
    'Check that DISCORD_TOKEN in .env is correct and that the token has not been regenerated.',
  );
  process.exit(1);
});
