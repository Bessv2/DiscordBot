import { getOrCreateGuildConfig, prisma } from './db';

// The single list of every feature the bot has, used by the /setup feature
// map and by the per-server on/off switch. Core moderation is not in here
// as a toggle: a server can always warn/kick/ban, whatever else it turns off.
//
// Two kinds of switch:
// - 'list': on unless the module ID is in GuildConfig.disabledModules.
//   Turning one off blocks its commands and skips its background work.
// - 'flag': an older per-feature boolean column that the feature already
//   checks itself (e.g. xpEnabled). The map just reads/writes that column.

export type ModuleId =
  | 'automod'
  | 'antiraid'
  | 'welcome'
  | 'xp'
  | 'economy'
  | 'starboard'
  | 'birthdays'
  | 'reactionroles'
  | 'tags'
  | 'quotes'
  | 'polls'
  | 'reminders'
  | 'fun'
  | 'trivia'
  | 'lfg'
  | 'tournaments'
  | 'maps'
  | 'gameservers'
  | 'streams'
  | 'activityroles'
  | 'music'
  | 'prefix'
  | 'serverlog'
  | 'tickets'
  | 'giveaways'
  | 'suggestions'
  | 'joinroles'
  | 'autoresponders'
  | 'announcements'
  | 'tempvoice'
  | 'addons'
  | 'bannetwork';

export type ModuleGroup = 'Moderation' | 'Community' | 'Games & fun';

export type FlagField =
  | 'automodEnabled'
  | 'antiRaidEnabled'
  | 'welcomeEnabled'
  | 'xpEnabled'
  | 'economyEnabled'
  | 'prefixCommandsOn';

export interface ModuleDef {
  id: ModuleId;
  name: string;
  emoji: string;
  group: ModuleGroup;
  /** One line: why a server would turn this on. */
  blurb: string;
  /** Slash commands blocked while a 'list' module is off. */
  commands: string[];
  toggle: { kind: 'list' } | { kind: 'flag'; field: FlagField };
  /** On by default for a server that has never touched it? */
  defaultOn: boolean;
}

export const MODULES: ModuleDef[] = [
  {
    id: 'automod',
    name: 'Auto-mod',
    emoji: '🛡️',
    group: 'Moderation',
    blurb: 'Catch floods, invite links, banned words and mass mentions automatically.',
    commands: [],
    toggle: { kind: 'flag', field: 'automodEnabled' },
    defaultOn: false,
  },
  {
    id: 'antiraid',
    name: 'Anti-raid',
    emoji: '🚨',
    group: 'Moderation',
    blurb: 'Spot a sudden wave of joins and optionally lock the server down.',
    commands: [],
    toggle: { kind: 'flag', field: 'antiRaidEnabled' },
    defaultOn: false,
  },
  {
    id: 'serverlog',
    name: 'Server logs',
    emoji: '📜',
    group: 'Moderation',
    blurb: 'A channel recording edits, deletions, joins, leaves, voice, role and channel changes.',
    commands: [],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'prefix',
    name: 'Legacy ! commands',
    emoji: '❗',
    group: 'Moderation',
    blurb: 'Old-style !warn, !kick, !ban and !cases for mods who prefer typing them.',
    commands: [],
    toggle: { kind: 'flag', field: 'prefixCommandsOn' },
    defaultOn: false,
  },
  {
    id: 'welcome',
    name: 'Welcome & goodbye',
    emoji: '👋',
    group: 'Community',
    blurb: 'Greet new members and note when someone leaves.',
    commands: [],
    toggle: { kind: 'flag', field: 'welcomeEnabled' },
    defaultOn: false,
  },
  {
    id: 'xp',
    name: 'Levels & XP',
    emoji: '📈',
    group: 'Community',
    blurb: 'Members earn XP for chatting and unlock roles as they level up.',
    commands: [],
    toggle: { kind: 'flag', field: 'xpEnabled' },
    defaultOn: false,
  },
  {
    id: 'economy',
    name: 'Economy',
    emoji: '💰',
    group: 'Community',
    blurb: 'Server credits, a daily bonus, slots and a leaderboard.',
    commands: [],
    toggle: { kind: 'flag', field: 'economyEnabled' },
    defaultOn: false,
  },
  {
    id: 'starboard',
    name: 'Starboard',
    emoji: '⭐',
    group: 'Community',
    blurb: 'Messages that get enough ⭐ reactions are reposted to a highlights channel.',
    commands: ['starboard'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'birthdays',
    name: 'Birthdays',
    emoji: '🎂',
    group: 'Community',
    blurb: 'Members save their birthday; the bot announces it and can give a role for the day.',
    commands: ['birthday'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'reactionroles',
    name: 'Reaction roles',
    emoji: '🎭',
    group: 'Community',
    blurb: 'Members pick their own roles by reacting to a message.',
    commands: ['reactionrole'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'tags',
    name: 'Custom commands (tags)',
    emoji: '🏷️',
    group: 'Community',
    blurb: 'Saved replies anyone can call up, like rules or FAQ answers.',
    commands: ['tag'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'quotes',
    name: 'Quote book',
    emoji: '💬',
    group: 'Community',
    blurb: 'Save memorable lines and pull up a random one.',
    commands: ['quote'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'polls',
    name: 'Polls',
    emoji: '📊',
    group: 'Community',
    blurb: 'Quick reaction polls.',
    commands: ['poll'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'reminders',
    name: 'Reminders',
    emoji: '⏰',
    group: 'Community',
    blurb: 'Members can ask the bot to remind them about something later.',
    commands: ['remind'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'tickets',
    name: 'Support tickets',
    emoji: '🎫',
    group: 'Community',
    blurb:
      'Members open a private thread with your staff from a button; closed tickets are saved as transcripts.',
    commands: ['ticket'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'suggestions',
    name: 'Suggestions',
    emoji: '💡',
    group: 'Community',
    blurb: 'Members post ideas, everyone votes, and staff approve or deny them.',
    commands: ['suggest', 'suggestion'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'giveaways',
    name: 'Giveaways',
    emoji: '🎉',
    group: 'Community',
    blurb: 'Enter-with-a-button giveaways that draw winners by themselves when time is up.',
    commands: ['giveaway'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'joinroles',
    name: 'Join roles & verification',
    emoji: '✅',
    group: 'Community',
    blurb: 'Give everyone a role when they join, or only once they press a Verify button.',
    commands: [],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'autoresponders',
    name: 'Auto-responders',
    emoji: '🤖',
    group: 'Community',
    blurb: 'The bot answers by itself when someone says a trigger phrase, like "how do I join".',
    commands: ['autoresponder'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'announcements',
    name: 'Announcements',
    emoji: '📣',
    group: 'Community',
    blurb: 'Post a styled announcement now, later, or every day or week.',
    commands: ['announce'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'tempvoice',
    name: 'Join-to-create voice',
    emoji: '🔊',
    group: 'Community',
    blurb: 'Joining one voice channel gives you your own room, deleted when everyone leaves.',
    commands: ['voice'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'music',
    name: 'Music & watch parties',
    emoji: '🎵',
    group: 'Games & fun',
    blurb: 'Watch YouTube together in voice, or have the bot play music and playlists.',
    commands: ['jam', 'music'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'fun',
    name: 'Dice & fun',
    emoji: '🎲',
    group: 'Games & fun',
    blurb: 'Dice rolls for tabletop games, coin flips and the magic 8-ball.',
    commands: ['roll', 'coinflip', '8ball'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'trivia',
    name: 'Trivia',
    emoji: '❓',
    group: 'Games & fun',
    blurb: 'Quiz rounds in a channel, with your own questions if you like.',
    commands: ['trivia'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'lfg',
    name: 'Looking for group',
    emoji: '🙋',
    group: 'Games & fun',
    blurb: 'Post a group for a game and let people join with a button.',
    commands: ['lfg'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'tournaments',
    name: 'Tournaments',
    emoji: '🏆',
    group: 'Games & fun',
    blurb: 'Simple brackets for game nights.',
    commands: ['tournament'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'maps',
    name: 'Game-night maps',
    emoji: '🗺️',
    group: 'Games & fun',
    blurb: 'Keep a map list per game, pick one at random, or let everyone vote.',
    commands: ['map'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'gameservers',
    name: 'Game servers & stats',
    emoji: '🖥️',
    group: 'Games & fun',
    blurb: 'Check if your game server is up, and look up Steam/LoL profiles.',
    commands: ['gameserver', 'gamestats'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'streams',
    name: 'Stream alerts',
    emoji: '📺',
    group: 'Games & fun',
    blurb: 'Post when a Twitch or YouTube channel goes live.',
    commands: ['streamwatch'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'activityroles',
    name: 'Now-playing roles',
    emoji: '🕹️',
    group: 'Games & fun',
    blurb: 'Give members a role while they are playing a certain game.',
    commands: ['activityrole'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'addons',
    name: 'Add-ons',
    emoji: '🧩',
    group: 'Community',
    blurb: 'Post from other places: news feeds, Steam game news, Epic free games, game servers going up or down, and other apps via webhooks.',
    commands: ['addons'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
  {
    id: 'bannetwork',
    name: 'Ban sharing',
    emoji: '🔗',
    group: 'Moderation',
    blurb: 'Share bans with other servers you trust that use this same bot: an alert with a "Ban here too" button, or an automatic ban.',
    commands: ['bannetwork'],
    toggle: { kind: 'list' },
    defaultOn: true,
  },
];

const BY_ID = new Map(MODULES.map((m) => [m.id, m]));
const BY_COMMAND = new Map(MODULES.flatMap((m) => m.commands.map((c) => [c, m] as const)));

export function getModule(id: ModuleId): ModuleDef {
  return BY_ID.get(id)!;
}

export function isModuleId(value: string): value is ModuleId {
  return BY_ID.has(value as ModuleId);
}

export function moduleForCommand(commandName: string): ModuleDef | undefined {
  return BY_COMMAND.get(commandName);
}

/** Tolerates a hand-edited or corrupt column: anything unreadable counts as "nothing disabled". */
export function parseDisabledModules(json: string | null | undefined): Set<string> {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

type ConfigLike = { disabledModules: string } & Record<FlagField, boolean>;

export function isModuleOn(config: ConfigLike, id: ModuleId): boolean {
  const def = getModule(id);
  if (def.toggle.kind === 'flag') return config[def.toggle.field];
  return !parseDisabledModules(config.disabledModules).has(id);
}

/**
 * Pure check used by interactionCreate: is this slash command blocked
 * because its module is switched off in this server? Commands that belong
 * to no 'list' module are never blocked here.
 */
export function blockingModule(commandName: string, disabledModulesJson: string): ModuleDef | null {
  const def = moduleForCommand(commandName);
  if (!def || def.toggle.kind !== 'list') return null;
  return parseDisabledModules(disabledModulesJson).has(def.id) ? def : null;
}

/** For background jobs/events: true unless the server switched this module off. */
export async function isModuleEnabledForGuild(guildId: string, id: ModuleId): Promise<boolean> {
  const config = await prisma.guildConfig.findUnique({ where: { id: guildId } });
  if (!config) return getModule(id).defaultOn;
  return isModuleOn(config, id);
}

/** For jobs that sweep every server at once: which servers switched this 'list' module off. */
export async function guildIdsWithModuleOff(id: ModuleId): Promise<Set<string>> {
  // A substring match on the JSON column narrows it down in SQL; the
  // parse afterwards makes sure it's a real entry, not part of another ID.
  const rows = await prisma.guildConfig.findMany({
    where: { disabledModules: { contains: `"${id}"` } },
    select: { id: true, disabledModules: true },
  });
  return new Set(
    rows.filter((r) => parseDisabledModules(r.disabledModules).has(id)).map((r) => r.id),
  );
}

export async function setModuleOn(guildId: string, id: ModuleId, on: boolean): Promise<void> {
  const def = getModule(id);
  // Works for a server the bot has never stored settings for yet.
  const config = await getOrCreateGuildConfig(guildId);
  if (def.toggle.kind === 'flag') {
    await prisma.guildConfig.update({ where: { id: guildId }, data: { [def.toggle.field]: on } });
    return;
  }
  const disabled = parseDisabledModules(config.disabledModules);
  if (on) disabled.delete(id);
  else disabled.add(id);
  await prisma.guildConfig.update({
    where: { id: guildId },
    data: { disabledModules: JSON.stringify([...disabled].sort()) },
  });
}
