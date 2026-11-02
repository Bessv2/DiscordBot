import { config } from '../config';
import { getConfiguredRoleIds } from '../lib/permissions';
import { HostFacts } from './status';

/** What the bot's .env allows, plus the server's permission-role counts: the non-settings input to the feature map. */
export async function hostFacts(guildId: string): Promise<HostFacts> {
  return {
    messageContent: config.ENABLE_MESSAGE_CONTENT,
    guildMembers: config.ENABLE_GUILD_MEMBERS,
    presence: config.ENABLE_PRESENCE,
    music: config.ENABLE_MUSIC,
    twitchOrYoutube: Boolean(
      (config.TWITCH_CLIENT_ID && config.TWITCH_CLIENT_SECRET) || config.YOUTUBE_API_KEY,
    ),
    steamOrRiot: Boolean(config.STEAM_API_KEY || config.RIOT_API_KEY),
    prefixCommands: config.ENABLE_PREFIX_COMMANDS,
    aiTriage: Boolean(config.AI_TRIAGE_API_KEY && config.ENABLE_MESSAGE_CONTENT),
    modRoleCount: (await getConfiguredRoleIds(guildId, 'moderation')).length,
    adminRoleCount: (await getConfiguredRoleIds(guildId, 'admin')).length,
  };
}
