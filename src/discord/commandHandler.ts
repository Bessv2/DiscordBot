import { Client, Collection } from 'discord.js';
import { Command } from '../commands/types';
import { commands } from '../commands';

export function loadCommands(client: Client & { commands: Collection<string, Command> }): void {
  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }
}
