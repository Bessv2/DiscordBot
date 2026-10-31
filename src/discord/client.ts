import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from '../config';
import { Command } from '../commands/types';

// Guilds: required for basically everything (guild/channel/role cache).
// GuildMessages: required to receive messageCreate events at all — needed
//   for rate-based spam detection, which does NOT need message content.
// GuildMessageReactions: not privileged — needed for starboard and
//   reaction-role self-assignment, both of which only read reaction
//   add/remove events, never message content.
// MessageContent (privileged): only requested when the host has opted in
//   via ENABLE_MESSAGE_CONTENT, because it's only needed by the invite
//   filter, word filter, mention-spam detection, and legacy prefix
//   commands — all optional features. Slash commands and flood-based spam
//   detection work with zero privileged intents.
// GuildMembers (privileged): only requested via ENABLE_GUILD_MEMBERS,
//   needed for welcome/goodbye messages (guildMemberAdd/Remove don't fire
//   reliably without it) and for the birthday-role auto-removal cleanup.
// GuildPresences (privileged): only requested via ENABLE_PRESENCE, needed
//   for voice-activity role auto-assignment (reading Rich Presence game
//   activity). The single most invasive intent here — off by default.
// GuildModeration is not a real gateway intent; ban/kick/timeout are done
// over the REST API and need no gateway intent at all.
const intents: GatewayIntentBits[] = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
];
if (config.ENABLE_MESSAGE_CONTENT) {
  intents.push(GatewayIntentBits.MessageContent);
}
if (config.ENABLE_GUILD_MEMBERS) {
  intents.push(GatewayIntentBits.GuildMembers);
}
if (config.ENABLE_PRESENCE) {
  intents.push(GatewayIntentBits.GuildPresences);
}

export const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
}) as Client & { commands: Collection<string, Command> };

client.commands = new Collection<string, Command>();
