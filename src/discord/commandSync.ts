import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'discord.js';
import { config } from '../config';
import { commands } from '../commands';
import { logger } from '../lib/logger';

// Next to bot.db, so it lives on the same persistent volume. dist/discord
// (compiled) and src/discord (tsx dev) are both two levels under the root.
const HASH_FILE = path.resolve(__dirname, '..', '..', 'data', '.commands-hash');

function readStoredHash(): string | null {
  try {
    return fs.readFileSync(HASH_FILE, 'utf8').trim();
  } catch {
    return null;
  }
}

function writeStoredHash(hash: string): void {
  try {
    fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
    fs.writeFileSync(HASH_FILE, hash);
  } catch (err) {
    // Not fatal — worst case we re-register on the next boot too.
    logger.debug(`Could not store command hash: ${(err as Error).message}`);
  }
}

/**
 * Registers slash commands with Discord on startup, so nobody has to run a
 * separate command after installing or upgrading. Skips the API call when
 * the definitions are unchanged since the last successful registration —
 * Discord rate-limits command creation, and most restarts change nothing.
 */
export async function syncCommandsIfChanged(client: Client<true>): Promise<void> {
  const body = commands.map((c) => c.data.toJSON());
  // Application ID is part of the key so swapping DISCORD_TOKEN for a
  // different bot re-registers instead of matching the old bot's hash.
  const target = `${client.application.id}:${config.DISCORD_GUILD_ID ? `guild:${config.DISCORD_GUILD_ID}` : 'global'}`;
  const hash = createHash('sha256').update(target).update(JSON.stringify(body)).digest('hex');

  if (readStoredHash() === hash) {
    logger.debug('Slash commands unchanged since last registration — skipping.');
    return;
  }

  try {
    if (config.DISCORD_GUILD_ID) {
      const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID);
      await guild.commands.set(body);
    } else {
      await client.application.commands.set(body);
    }
    writeStoredHash(hash);
    logger.info(
      `Registered ${body.length} slash commands ${config.DISCORD_GUILD_ID ? `in guild ${config.DISCORD_GUILD_ID}` : 'globally'}.` +
        (config.DISCORD_GUILD_ID
          ? ''
          : ' They can take a few minutes to show up in Discord the first time.'),
    );
  } catch (err) {
    logger.error(
      `Could not register slash commands: ${(err as Error).message}`,
      config.DISCORD_GUILD_ID
        ? 'Check that DISCORD_GUILD_ID in .env is a server the bot has been invited to, or leave it blank.'
        : 'This usually fixes itself on the next restart. If it keeps happening, check the bot token is still valid.',
    );
  }
}
