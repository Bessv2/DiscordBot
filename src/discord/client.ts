import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from '../config';
import { Command } from '../commands/types';

// Guilds: required for basically everything (guild/channel/role cache).
// GuildMessages: required to receive messageCreate events at all — needed
//   for rate-based spam detection, which does NOT need message content.
// MessageContent (privileged): only requested when the host has opted in
//   via ENABLE_MESSAGE_CONTENT, because it's only needed by the invite
//   filter, word filter, mention-spam detection, and legacy prefix
//   commands — all optional features. Slash commands and flood-based spam
//   detection work with zero privileged intents.
// GuildModeration is not a real gateway intent; ban/kick/timeout are done
// over the REST API and need no gateway intent at all.
const intents: GatewayIntentBits[] = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
if (config.ENABLE_MESSAGE_CONTENT) {
  intents.push(GatewayIntentBits.MessageContent);
}

export const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel],
}) as Client & { commands: Collection<string, Command> };

client.commands = new Collection<string, Command>();
