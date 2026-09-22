import { Client } from 'discord.js';
import { ready } from '../events/ready';
import { interactionCreate } from '../events/interactionCreate';
import { messageCreate } from '../events/messageCreate';

export function loadEvents(client: Client): void {
  client.once('ready', ready);
  client.on('interactionCreate', interactionCreate);
  client.on('messageCreate', messageCreate);
}
