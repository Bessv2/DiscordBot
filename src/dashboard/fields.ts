// What the dashboard can edit, declared once: each feature page lists its
// fields with the same limits /setup enforces. Validation is pure (no
// Discord or database access) so it's unit tested; the server passes in the
// channel and role IDs that actually exist on the server, so a hand-crafted
// form can never point the bot at a channel or role from somewhere else.
import { ModuleId } from '../lib/modules';
import { SERVER_LOG_EVENTS } from '../serverlog/events';

export type Field =
  | { kind: 'channel'; key: string; label: string; help?: string; channelKind: 'text' | 'voice' }
  | { kind: 'role'; key: string; label: string; help?: string; assignable?: boolean }
  | { kind: 'roles'; key: string; label: string; help?: string; max: number; assignable?: boolean }
  | {
      kind: 'number';
      key: string;
      label: string;
      help?: string;
      min: number;
      max: number;
      scale?: number;
      unit?: string;
    }
  | { kind: 'bool'; key: string; label: string; help?: string }
  | {
      kind: 'text';
      key: string;
      label: string;
      help?: string;
      maxLength: number;
      multiline?: boolean;
      pattern?: RegExp;
      patternHelp?: string;
    }
  | { kind: 'words'; key: string; label: string; help?: string }
  | { kind: 'events'; key: string; label: string; help?: string }
  | { kind: 'permroles'; scope: 'moderation' | 'admin'; key: string; label: string; help?: string };

export interface FeaturePage {
  id: string;
  title: string;
  emoji: string;
  why: string;
  /** The on/off switch shown on this page, if the feature has one. */
  moduleId?: ModuleId;
  fields: Field[];
}

const keepText: Field[] = [
  {
    kind: 'bool',
    key: 'logMessageContent',
    label: 'Keep message text in logs',
    help: 'Off by default. When on, the text of caught, deleted or edited messages appears in logs until the period below.',
  },
  {
    kind: 'number',
    key: 'contentRetainDays',
    label: 'Remove message text after',
    min: 1,
    max: 365,
    unit: 'days',
  },
];

export const PAGES: FeaturePage[] = [
  {
    id: 'modlog',
    title: 'Mod-log channel',
    emoji: '📋',
    why: 'Every warn, kick, ban, timeout, mute and auto-mod catch is posted here.',
    fields: [
      { kind: 'channel', key: 'modLogChannelId', label: 'Mod-log channel', channelKind: 'text' },
    ],
  },
  {
    id: 'permissions',
    title: 'Who can moderate',
    emoji: '🔑',
    why: "By default Discord's own permissions decide. Pick roles to decide it yourself; leave empty to keep the default.",
    fields: [
      {
        kind: 'permroles',
        scope: 'moderation',
        key: 'perm_moderation',
        label: 'Moderation roles (warn, kick, ban, timeout, mute)',
      },
      {
        kind: 'permroles',
        scope: 'admin',
        key: 'perm_admin',
        label: 'Admin roles (/setup, /config, this dashboard)',
      },
    ],
  },
  {
    id: 'appeals',
    title: 'Appeals channel',
    emoji: '📨',
    why: 'Where appeals from the DM "Appeal" button go. Empty = the mod-log channel.',
    fields: [
      { kind: 'channel', key: 'appealChannelId', label: 'Appeals channel', channelKind: 'text' },
    ],
  },
  {
    id: 'automod',
    title: 'Auto-mod',
    emoji: '🛡️',
    why: 'Deletes spam as it happens and logs each catch. Moderators are never filtered.',
    moduleId: 'automod',
    fields: [
      {
        kind: 'number',
        key: 'spamMessageLimit',
        label: 'Messages before it counts as flooding',
        min: 2,
        max: 50,
      },
      {
        kind: 'number',
        key: 'spamIntervalMs',
        label: '...within',
        min: 1,
        max: 120,
        scale: 1000,
        unit: 'seconds',
      },
      {
        kind: 'number',
        key: 'mentionSpamLimit',
        label: 'Mentions in one message that count as spam',
        min: 2,
        max: 50,
      },
      { kind: 'bool', key: 'inviteFilterOn', label: 'Delete Discord invite links' },
      { kind: 'bool', key: 'wordFilterOn', label: 'Banned-word filter' },
      {
        kind: 'words',
        key: 'bannedWords',
        label: 'Banned words or phrases',
        help: 'One per line.',
      },
      {
        kind: 'bool',
        key: 'nativeAutomod',
        label: "Use Discord's AutoMod for the invite, word and mention filters",
        help: 'Discord blocks those messages before anyone sees them, and it works without Message Content. Needs the bot to have Manage Server. Flood detection stays with the bot.',
      },
      ...keepText,
    ],
  },
  {
    id: 'antiraid',
    title: 'Anti-raid',
    emoji: '🚨',
    why: 'Spots a wave of joins and warns your mods; with auto-lockdown it also raises the verification level.',
    moduleId: 'antiraid',
    fields: [
      {
        kind: 'number',
        key: 'raidJoinThreshold',
        label: 'Joins that count as a raid',
        min: 2,
        max: 500,
      },
      {
        kind: 'number',
        key: 'raidIntervalMs',
        label: '...within',
        min: 5,
        max: 3600,
        scale: 1000,
        unit: 'seconds',
      },
      { kind: 'bool', key: 'raidAutoLockdown', label: 'Lock the server down automatically' },
    ],
  },
  {
    id: 'serverlog',
    title: 'Server logs',
    emoji: '📜',
    why: 'A channel recording edits, deletions, joins, leaves, voice, role and channel changes, and bans.',
    moduleId: 'serverlog',
    fields: [
      { kind: 'channel', key: 'serverLogChannelId', label: 'Log channel', channelKind: 'text' },
      { kind: 'events', key: 'serverLogEvents', label: 'What to log' },
      ...keepText,
    ],
  },
  {
    id: 'prefix',
    title: 'Legacy ! commands',
    emoji: '❗',
    why: 'Old-style !warn, !kick, !ban and !cases (the host also has to allow them).',
    moduleId: 'prefix',
    fields: [
      {
        kind: 'text',
        key: 'prefix',
        label: 'Prefix',
        maxLength: 3,
        pattern: /^\S{1,3}$/,
        patternHelp: '1-3 characters, no spaces',
      },
    ],
  },
  {
    id: 'welcome',
    title: 'Welcome & goodbye',
    emoji: '👋',
    why: 'Greets new members and notes when someone leaves. Use {user}, {server} and {membercount}.',
    moduleId: 'welcome',
    fields: [
      { kind: 'channel', key: 'welcomeChannelId', label: 'Welcome channel', channelKind: 'text' },
      {
        kind: 'text',
        key: 'welcomeMessage',
        label: 'Welcome message',
        maxLength: 1000,
        multiline: true,
      },
      {
        kind: 'channel',
        key: 'goodbyeChannelId',
        label: 'Goodbye channel (empty = no goodbyes)',
        channelKind: 'text',
      },
      {
        kind: 'text',
        key: 'goodbyeMessage',
        label: 'Goodbye message',
        maxLength: 1000,
        multiline: true,
      },
    ],
  },
  {
    id: 'xp',
    title: 'Levels & XP',
    emoji: '📈',
    why: 'Members earn XP for chatting and level up. Role rewards are set with /xp role-reward or in /setup.',
    moduleId: 'xp',
    fields: [
      { kind: 'number', key: 'xpMinPerMsg', label: 'Least XP per message', min: 1, max: 1000 },
      { kind: 'number', key: 'xpMaxPerMsg', label: 'Most XP per message', min: 1, max: 1000 },
      {
        kind: 'number',
        key: 'xpCooldownSec',
        label: 'Time between XP gains',
        min: 0,
        max: 3600,
        unit: 'seconds',
      },
    ],
  },
  {
    id: 'economy',
    title: 'Economy',
    emoji: '💰',
    why: 'Play-money credits, a daily bonus, slots and a leaderboard.',
    moduleId: 'economy',
    fields: [
      {
        kind: 'number',
        key: 'economyDailyAmount',
        label: 'Daily bonus',
        min: 0,
        max: 1_000_000,
        unit: 'credits',
      },
      {
        kind: 'number',
        key: 'economyStartingBalance',
        label: 'Starting balance',
        min: 0,
        max: 1_000_000,
        unit: 'credits',
      },
    ],
  },
  {
    id: 'starboard',
    title: 'Starboard',
    emoji: '⭐',
    why: 'Messages with enough reactions are reposted to a highlights channel.',
    moduleId: 'starboard',
    fields: [
      {
        kind: 'channel',
        key: 'starboardChannelId',
        label: 'Starboard channel',
        channelKind: 'text',
      },
      {
        kind: 'text',
        key: 'starboardEmoji',
        label: 'Emoji',
        maxLength: 64,
        pattern: /^\S{1,64}$/,
        patternHelp: 'one emoji, no spaces',
      },
      { kind: 'number', key: 'starboardThreshold', label: 'Reactions needed', min: 1, max: 100 },
    ],
  },
  {
    id: 'birthdays',
    title: 'Birthdays',
    emoji: '🎂',
    why: 'Announces saved birthdays and can give a role for the day.',
    moduleId: 'birthdays',
    fields: [
      {
        kind: 'channel',
        key: 'birthdayChannelId',
        label: 'Announcement channel',
        channelKind: 'text',
      },
      { kind: 'role', key: 'birthdayRoleId', label: 'Birthday role (optional)', assignable: true },
    ],
  },
  {
    id: 'tickets',
    title: 'Support tickets',
    emoji: '🎫',
    why: 'Private threads between a member and staff. Post the button with /ticket panel or in /setup.',
    moduleId: 'tickets',
    fields: [
      { kind: 'role', key: 'ticketStaffRoleId', label: 'Staff role' },
      {
        kind: 'channel',
        key: 'ticketLogChannelId',
        label: 'Transcript channel (optional)',
        channelKind: 'text',
      },
    ],
  },
  {
    id: 'suggestions',
    title: 'Suggestions',
    emoji: '💡',
    why: 'Ideas posted with /suggest, voted on, approved or denied by staff.',
    moduleId: 'suggestions',
    fields: [
      {
        kind: 'channel',
        key: 'suggestionChannelId',
        label: 'Suggestions channel',
        channelKind: 'text',
      },
    ],
  },
  {
    id: 'joinroles',
    title: 'Join roles & verification',
    emoji: '✅',
    why: 'Roles given on joining, and the role the Verify button gives (post it from /setup).',
    moduleId: 'joinroles',
    fields: [
      { kind: 'roles', key: 'joinRoleIds', label: 'Join roles', max: 5, assignable: true },
      { kind: 'role', key: 'verifyRoleId', label: 'Verified role', assignable: true },
    ],
  },
  {
    id: 'tempvoice',
    title: 'Join-to-create voice',
    emoji: '🔊',
    why: 'Joining the hub channel makes you your own room.',
    moduleId: 'tempvoice',
    fields: [
      { kind: 'channel', key: 'tempVoiceHubId', label: 'Hub voice channel', channelKind: 'voice' },
    ],
  },
  {
    id: 'music',
    title: 'Music & watch parties',
    emoji: '🎵',
    why: '/jam watch parties and the /music player (if the host enabled it).',
    moduleId: 'music',
    fields: [{ kind: 'role', key: 'musicDjRoleId', label: 'DJ role (optional)' }],
  },
  {
    id: 'aitriage',
    title: 'AI triage',
    emoji: '🔎',
    why: "An AI sends messages that look harmful to a review channel with Delete and Looks fine buttons. It never acts by itself. Message text goes to Anthropic's API using the bot host's key.",
    moduleId: 'aitriage',
    fields: [{ kind: 'channel', key: 'aiTriageChannelId', label: 'Review channel (empty = the mod-log)', channelKind: 'text' }],
  },
];

export function getPage(id: string): FeaturePage | undefined {
  return PAGES.find((p) => p.id === id);
}

export interface ValidationContext {
  textChannelIds: Set<string>;
  voiceChannelIds: Set<string>;
  roleIds: Set<string>;
}

export type FieldResult = { ok: true; value: unknown } | { ok: false; error: string };

type Raw = string | string[] | undefined;
const one = (raw: Raw) => (Array.isArray(raw) ? raw[raw.length - 1] : raw) ?? '';
const many = (raw: Raw) => (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);

/**
 * Turns one submitted form value into what's stored. `value` is what goes
 * in the database column (or, for permroles, the role ID list).
 */
export function parseField(field: Field, raw: Raw, ctx: ValidationContext): FieldResult {
  switch (field.kind) {
    case 'channel': {
      const id = one(raw).trim();
      if (!id) return { ok: true, value: null };
      const valid = field.channelKind === 'voice' ? ctx.voiceChannelIds : ctx.textChannelIds;
      return valid.has(id)
        ? { ok: true, value: id }
        : { ok: false, error: `${field.label}: that channel isn't on this server.` };
    }
    case 'role': {
      const id = one(raw).trim();
      if (!id) return { ok: true, value: null };
      return ctx.roleIds.has(id)
        ? { ok: true, value: id }
        : { ok: false, error: `${field.label}: that role isn't on this server.` };
    }
    case 'roles':
    case 'permroles': {
      const ids = [...new Set(many(raw))];
      const max = field.kind === 'roles' ? field.max : 10;
      if (ids.length > max) return { ok: false, error: `${field.label}: pick at most ${max}.` };
      if (ids.some((id) => !ctx.roleIds.has(id)))
        return { ok: false, error: `${field.label}: one of those roles isn't on this server.` };
      return { ok: true, value: field.kind === 'roles' ? JSON.stringify(ids) : ids };
    }
    case 'number': {
      const text = one(raw).trim();
      if (!/^\d+$/.test(text)) return { ok: false, error: `${field.label}: enter a whole number.` };
      const n = Number(text);
      if (n < field.min || n > field.max)
        return { ok: false, error: `${field.label}: must be ${field.min}–${field.max}.` };
      return { ok: true, value: n * (field.scale ?? 1) };
    }
    case 'bool':
      return { ok: true, value: one(raw) === 'on' };
    case 'text': {
      const text = one(raw).trim();
      if (!text) return { ok: false, error: `${field.label}: can't be empty.` };
      if (text.length > field.maxLength)
        return { ok: false, error: `${field.label}: ${field.maxLength} characters at most.` };
      if (field.pattern && !field.pattern.test(text))
        return { ok: false, error: `${field.label}: ${field.patternHelp ?? 'not valid'}.` };
      return { ok: true, value: text };
    }
    case 'words': {
      const words = [
        ...new Set(
          one(raw)
            .split(/[\n,]/)
            .map((w) => w.trim().toLowerCase())
            .filter(Boolean),
        ),
      ].slice(0, 500);
      return { ok: true, value: JSON.stringify(words) };
    }
    case 'events': {
      const on = new Set(many(raw));
      const keys = SERVER_LOG_EVENTS.map((e) => e.key);
      return { ok: true, value: JSON.stringify(keys.filter((k) => !on.has(k))) };
    }
  }
}
