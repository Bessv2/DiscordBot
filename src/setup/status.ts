// Pure "what's the state of every feature?" logic behind the /setup
// feature map. No Discord or DB access, so it's unit tested directly.
import { MODULES, ModuleDef, ModuleGroup, ModuleId, isModuleOn } from '../lib/modules';

export type FeatureState = 'on' | 'off' | 'needs';

export interface FeatureStatus {
  /** A module ID, or one of the essentials that aren't modules. */
  id: ModuleId | 'modlog' | 'permissions' | 'appeals';
  name: string;
  emoji: string;
  group: ModuleGroup;
  state: FeatureState;
  /** Short note after the name, e.g. the channel it posts in or what's missing. */
  detail: string;
}

/** The parts of GuildConfig the map reads. */
export interface StatusConfig {
  modLogChannelId: string | null;
  appealChannelId: string | null;
  disabledModules: string;
  automodEnabled: boolean;
  inviteFilterOn: boolean;
  wordFilterOn: boolean;
  antiRaidEnabled: boolean;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  xpEnabled: boolean;
  economyEnabled: boolean;
  starboardChannelId: string | null;
  birthdayChannelId: string | null;
}

/** Host-level facts: what the bot's .env allows. */
export interface HostFacts {
  messageContent: boolean;
  guildMembers: boolean;
  presence: boolean;
  music: boolean;
  twitchOrYoutube: boolean;
  steamOrRiot: boolean;
  modRoleCount: number;
  adminRoleCount: number;
}

const ch = (id: string | null) => (id ? `<#${id}>` : null);

export function featureStatuses(gc: StatusConfig, host: HostFacts): FeatureStatus[] {
  const out: FeatureStatus[] = [
    {
      id: 'modlog',
      name: 'Mod-log channel',
      emoji: '📋',
      group: 'Moderation',
      state: gc.modLogChannelId ? 'on' : 'needs',
      detail: ch(gc.modLogChannelId) ?? 'not set: moderation actions have nowhere to be logged',
    },
    {
      id: 'permissions',
      name: 'Who can moderate',
      emoji: '🔑',
      group: 'Moderation',
      state: 'on',
      detail:
        host.modRoleCount || host.adminRoleCount
          ? `${host.modRoleCount} mod role(s), ${host.adminRoleCount} admin role(s)`
          : "Discord's own Kick/Ban/Manage Server permissions",
    },
    {
      id: 'appeals',
      name: 'Appeals channel',
      emoji: '📨',
      group: 'Moderation',
      state: 'on',
      detail:
        ch(gc.appealChannelId) ??
        (gc.modLogChannelId ? 'uses the mod-log channel' : 'uses the mod-log channel, once set'),
    },
  ];

  for (const m of MODULES) out.push(moduleStatus(m, gc, host));
  return out;
}

function moduleStatus(m: ModuleDef, gc: StatusConfig, host: HostFacts): FeatureStatus {
  const on = isModuleOn(gc, m.id);
  const base = { id: m.id, name: m.name, emoji: m.emoji, group: m.group };
  if (!on) return { ...base, state: 'off', detail: 'off' };

  const needs = (detail: string): FeatureStatus => ({ ...base, state: 'needs', detail });
  const fine = (detail: string): FeatureStatus => ({ ...base, state: 'on', detail });

  switch (m.id) {
    case 'automod':
      return (gc.inviteFilterOn || gc.wordFilterOn) && !host.messageContent
        ? needs(
            'flood detection works; the invite/word filters need the host to turn on Message Content',
          )
        : fine(
            [
              gc.inviteFilterOn && 'invite filter',
              gc.wordFilterOn && 'word filter',
              'flood detection',
            ]
              .filter(Boolean)
              .join(', '),
          );
    case 'antiraid':
      return host.guildMembers
        ? fine('watching joins')
        : needs('the host needs to turn on Server Members for this to see joins');
    case 'welcome':
      if (!gc.welcomeChannelId) return needs('pick a welcome channel');
      return host.guildMembers
        ? fine(ch(gc.welcomeChannelId)!)
        : needs('the host needs to turn on Server Members for this to see joins');
    case 'starboard':
      return gc.starboardChannelId
        ? fine(ch(gc.starboardChannelId)!)
        : needs('pick a starboard channel');
    case 'birthdays':
      return gc.birthdayChannelId
        ? fine(`announced in ${ch(gc.birthdayChannelId)}`)
        : fine('members can save birthdays; pick a channel to announce them');
    case 'music':
      return fine(
        host.music
          ? '`/jam` watch parties and `/music` player'
          : '`/jam` watch parties (the `/music` player is off for this bot)',
      );
    case 'streams':
      return host.twitchOrYoutube
        ? fine('add channels with `/streamwatch add`')
        : needs('the host needs to add a Twitch or YouTube key');
    case 'gameservers':
      return fine(
        host.steamOrRiot
          ? 'server status and profile lookups'
          : 'server status (profile lookups need a Steam/Riot key)',
      );
    case 'activityroles':
      return host.presence
        ? fine('set games with `/activityrole add`')
        : needs('the host needs to turn on Presence for this to see games');
    default:
      return fine('on');
  }
}

export const STATE_ICON: Record<FeatureState, string> = { on: '✅', off: '⬜', needs: '⚠️' };

/** Lines for the feature map, grouped. Kept under Discord's 1024-char field limit per group. */
export function featureMapFields(statuses: FeatureStatus[]): { name: string; value: string }[] {
  const groups: ModuleGroup[] = ['Moderation', 'Community', 'Games & fun'];
  const groupEmoji: Record<ModuleGroup, string> = {
    Moderation: '🛡️',
    Community: '🏘️',
    'Games & fun': '🎮',
  };
  return groups.map((g) => {
    const lines = statuses
      .filter((s) => s.group === g)
      .map((s) => `${STATE_ICON[s.state]} ${s.emoji} **${s.name}** — ${s.detail}`);
    let value = '';
    for (const line of lines) {
      const next = value ? `${value}\n${line}` : line;
      value = next.length > 1024 ? value : next;
    }
    return { name: `${groupEmoji[g]} ${g}`, value };
  });
}

/** Parses a number typed into a setup form; null when it's not a whole number in range. */
export function parseIntInRange(value: string, min: number, max: number): number | null {
  const text = value.trim();
  if (!/^-?\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

export function parseYesNo(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (['yes', 'y', 'true', 'on'].includes(v)) return true;
  if (['no', 'n', 'false', 'off'].includes(v)) return false;
  return null;
}
