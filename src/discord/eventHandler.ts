import { Client, ClientEvents } from 'discord.js';
import { ready } from '../events/ready';
import { interactionCreate } from '../events/interactionCreate';
import { messageCreate } from '../events/messageCreate';
import { guildMemberAdd } from '../events/guildMemberAdd';
import { guildMemberRemove } from '../events/guildMemberRemove';
import { messageReactionAdd } from '../events/messageReactionAdd';
import { messageReactionRemove } from '../events/messageReactionRemove';
import { presenceUpdate } from '../events/presenceUpdate';
import { logger } from '../lib/logger';

// One failing handler (a busy SQLite file during a backup, a Discord API
// hiccup) must never take the whole bot offline — log it and keep serving.
function safe<K extends keyof ClientEvents>(name: K, handler: (...args: ClientEvents[K]) => unknown) {
  return (...args: ClientEvents[K]) => {
    Promise.resolve()
      .then(() => handler(...args))
      .catch((err) => logger.error(`"${name}" handler threw: ${(err as Error).stack ?? err}`));
  };
}

export function loadEvents(client: Client): void {
  client.once('ready', safe('ready', ready));
  client.on('interactionCreate', safe('interactionCreate', interactionCreate));
  client.on('messageCreate', safe('messageCreate', messageCreate));
  // These simply never fire if their privileged intent wasn't requested
  // (see src/discord/client.ts) — no runtime cost either way.
  client.on('guildMemberAdd', safe('guildMemberAdd', guildMemberAdd));
  client.on('guildMemberRemove', safe('guildMemberRemove', guildMemberRemove));
  client.on('messageReactionAdd', safe('messageReactionAdd', messageReactionAdd));
  client.on('messageReactionRemove', safe('messageReactionRemove', messageReactionRemove));
  client.on('presenceUpdate', safe('presenceUpdate', presenceUpdate));
  client.on('error', (err) => logger.error(`Discord client error: ${err.message}`));
}
