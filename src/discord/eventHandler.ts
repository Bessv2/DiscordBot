import { Client } from 'discord.js';
import { ready } from '../events/ready';
import { interactionCreate } from '../events/interactionCreate';
import { messageCreate } from '../events/messageCreate';
import { guildMemberAdd } from '../events/guildMemberAdd';
import { guildMemberRemove } from '../events/guildMemberRemove';
import { messageReactionAdd } from '../events/messageReactionAdd';
import { messageReactionRemove } from '../events/messageReactionRemove';
import { presenceUpdate } from '../events/presenceUpdate';

export function loadEvents(client: Client): void {
  client.once('ready', ready);
  client.on('interactionCreate', interactionCreate);
  client.on('messageCreate', messageCreate);
  // These simply never fire if their privileged intent wasn't requested
  // (see src/discord/client.ts) — no runtime cost either way.
  client.on('guildMemberAdd', guildMemberAdd);
  client.on('guildMemberRemove', guildMemberRemove);
  client.on('messageReactionAdd', messageReactionAdd);
  client.on('messageReactionRemove', messageReactionRemove);
  client.on('presenceUpdate', presenceUpdate);
}
