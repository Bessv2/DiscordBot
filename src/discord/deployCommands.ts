// Standalone script — `npm run deploy-commands` — that registers all slash
// commands with Discord. Run it once after adding/changing a command, and
// again after any deploy that changes command definitions. Not run
// automatically on every boot because global command registration is
// rate-limited and takes up to an hour to propagate; re-running it when
// nothing changed is a harmless no-op on Discord's side.
import { REST, Routes } from 'discord.js';
import { config } from '../config';
import { logger } from '../lib/logger';
import { commands } from '../commands';

async function main() {
  const body = commands.map((c) => c.data.toJSON());
  const rest = new REST().setToken(config.DISCORD_TOKEN);

  const route = config.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID)
    : Routes.applicationCommands(config.DISCORD_CLIENT_ID);

  const scope = config.DISCORD_GUILD_ID
    ? `guild ${config.DISCORD_GUILD_ID} (instant)`
    : 'globally (may take up to an hour to appear)';

  logger.info(`Registering ${body.length} slash command(s) ${scope}...`);
  await rest.put(route, { body });
  logger.info('Done.');
}

main().catch((err) => {
  logger.error(
    `Failed to register slash commands: ${(err as Error).message}`,
    'Check that DISCORD_TOKEN and DISCORD_CLIENT_ID in .env are correct and that the token has not been regenerated.',
  );
  process.exit(1);
});
