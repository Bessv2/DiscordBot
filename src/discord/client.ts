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
// GuildVoiceStates: not privileged — lets the bot see which voice channel
//   a member is in, so /jam and /music can join theirs. Voice states are a
//   small cache (one entry per member currently in voice).
// GuildModeration: not privileged — only used to see bans and unbans done
//   outside the bot (Discord's own menu) for the server log. The bot's own
//   bans/kicks/timeouts go over the REST API and need no intent.
const intents: GatewayIntentBits[] = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildModeration,
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
  // Lots of member-written text gets echoed by the bot (tags, reminders,
  // quotes, polls, welcome templates, imported trivia). Only ever resolve
  // plain user mentions by default, so nobody can make the bot ping
  // @everyone/@here or a role on their behalf.
  allowedMentions: { parse: ['users'], repliedUser: true },
}) as Client & { commands: Collection<string, Command> };

client.commands = new Collection<string, Command>();
