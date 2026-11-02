// Optional: let Discord's own AutoMod run the invite, banned-word and
// mention-spam filters. Discord checks messages itself, so these filters
// work without the privileged Message Content intent, and they block a
// message before anyone sees it rather than deleting it afterwards.
//
// The bot owns up to three rules per server (names start with "Bot:") and
// keeps them matching the server's auto-mod settings. Flood detection stays
// in the bot: Discord has no rate-based rule.
//
// Needs the bot's role to have Manage Server (Discord's requirement for
// managing AutoMod rules). Without it, sync records the error, /setup shows
// it, and the bot's own filters keep running as before.
import { createHash } from 'node:crypto';
import {
  AutoModerationActionType,
  AutoModerationRuleCreateOptions,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  Guild,
  PermissionFlagsBits,
} from 'discord.js';
import { GuildConfig } from '@prisma/client';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { getConfiguredRoleIds } from '../lib/permissions';
import { parseStringList } from '../lib/jsonList';

export type NativeRuleKey = 'invite' | 'words' | 'mentions';

export interface NativeState {
  ids: Partial<Record<NativeRuleKey, string>>;
  hash?: string;
  error?: string | null;
}

export function parseNativeState(json: string | null | undefined): NativeState {
  try {
    const s = JSON.parse(json ?? '{}') as NativeState;
    return {
      ids: s.ids && typeof s.ids === 'object' ? s.ids : {},
      hash: s.hash,
      error: s.error ?? null,
    };
  } catch {
    return { ids: {} };
  }
}

/** Which filters Discord is enforcing for this server right now, so the bot can skip its own copy. */
export function nativeCovered(
  gc: Pick<GuildConfig, 'nativeAutomod' | 'nativeAutomodState'>,
): Set<NativeRuleKey> {
  if (!gc.nativeAutomod) return new Set();
  return new Set(Object.keys(parseNativeState(gc.nativeAutomodState).ids) as NativeRuleKey[]);
}

// Same pattern as the bot's own filter (src/automod/invite.ts), in the
// Rust regex syntax Discord uses (max 260 characters).
export const INVITE_PATTERN = '(?i)(discord\\.gg|discord(?:app)?\\.com/invite)/[a-z0-9-]+';

export interface RuleInputs {
  automodEnabled: boolean;
  nativeAutomod: boolean;
  inviteFilterOn: boolean;
  wordFilterOn: boolean;
  bannedWords: string[];
  mentionSpamLimit: number;
  modLogChannelId: string | null;
  exemptRoleIds: string[];
  exempt: Record<NativeRuleKey, string[]>;
}

/** The rules the server's settings call for. Pure, so it's unit tested. */
export function desiredRules(
  input: RuleInputs,
): Partial<Record<NativeRuleKey, AutoModerationRuleCreateOptions>> {
  if (!input.automodEnabled || !input.nativeAutomod) return {};
  const actions = (reason: string): AutoModerationRuleCreateOptions['actions'] => [
    { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: reason } },
    ...(input.modLogChannelId
      ? [
          {
            type: AutoModerationActionType.SendAlertMessage,
            metadata: { channel: input.modLogChannelId },
          },
        ]
      : []),
  ];
  const base = (key: NativeRuleKey) => ({
    eventType: AutoModerationRuleEventType.MessageSend,
    enabled: true,
    // Discord allows 20 exempt roles and 50 exempt channels per rule.
    exemptRoles: input.exemptRoleIds.slice(0, 20),
    exemptChannels: input.exempt[key].slice(0, 50),
    reason: "Kept in sync with the bot's auto-mod settings",
  });
  const out: Partial<Record<NativeRuleKey, AutoModerationRuleCreateOptions>> = {};
  if (input.inviteFilterOn) {
    out.invite = {
      ...base('invite'),
      name: 'Bot: invite links',
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: [INVITE_PATTERN] },
      actions: actions('Invite links to other servers are not allowed here.'),
    };
  }
  // Discord: at most 1000 keywords, each at most 60 characters.
  const words = input.bannedWords
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w && w.length <= 60)
    .slice(0, 1000);
  if (input.wordFilterOn && words.length) {
    out.words = {
      ...base('words'),
      name: 'Bot: banned words',
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: words },
      actions: actions('That message contains a word that is not allowed here.'),
    };
  }
  out.mentions = {
    ...base('mentions'),
    name: 'Bot: mention spam',
    triggerType: AutoModerationRuleTriggerType.MentionSpam,
    triggerMetadata: { mentionTotalLimit: Math.min(50, Math.max(1, input.mentionSpamLimit)) },
    actions: actions('Too many mentions in one message.'),
  };
  return out;
}

export function rulesHash(
  rules: Partial<Record<NativeRuleKey, AutoModerationRuleCreateOptions>>,
): string {
  return createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 16);
}

async function inputsFor(guild: Guild, gc: GuildConfig): Promise<RuleInputs> {
  const overrides = await prisma.channelAutomodOverride.findMany({ where: { guildId: guild.id } });
  const roles = [
    ...new Set([
      ...(await getConfiguredRoleIds(guild.id, 'moderation')),
      ...(await getConfiguredRoleIds(guild.id, 'admin')),
    ]),
  ];
  return {
    automodEnabled: gc.automodEnabled,
    nativeAutomod: gc.nativeAutomod,
    inviteFilterOn: gc.inviteFilterOn,
    wordFilterOn: gc.wordFilterOn,
    bannedWords: parseStringList(gc.bannedWords),
    mentionSpamLimit: gc.mentionSpamLimit,
    modLogChannelId: gc.modLogChannelId,
    exemptRoleIds: roles,
    exempt: {
      invite: overrides.filter((o) => o.exemptInvite).map((o) => o.channelId),
      words: overrides.filter((o) => o.exemptWordFilter).map((o) => o.channelId),
      mentions: overrides.filter((o) => o.exemptMentionSpam).map((o) => o.channelId),
    },
  };
}

/**
 * Makes the server's Discord AutoMod rules match its settings: creates,
 * edits or deletes the bot's rules. Cheap when nothing changed (a hash
 * check, no API calls), so it's safe to call after any settings change.
 * Returns an error message, or null when everything is in place.
 */
export async function syncNativeAutomod(guild: Guild, force = false): Promise<string | null> {
  const gc = await prisma.guildConfig.findUnique({ where: { id: guild.id } });
  if (!gc) return null;
  const state = parseNativeState(gc.nativeAutomodState);
  const want = desiredRules(await inputsFor(guild, gc));
  const hash = rulesHash(want);
  const haveIds = Object.keys(state.ids).length > 0;
  if (!force && state.hash === hash && !state.error && (haveIds || Object.keys(want).length === 0))
    return null;
  if (!haveIds && Object.keys(want).length === 0) {
    await save(guild.id, { ids: {}, hash, error: null });
    return null;
  }

  const me = await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    const error =
      "Discord's AutoMod needs the bot's role to have **Manage Server**. Until then, the bot's own filters keep working.";
    await save(guild.id, { ...state, hash: undefined, error });
    return error;
  }

  const ids: NativeState['ids'] = {};
  try {
    for (const key of ['invite', 'words', 'mentions'] as NativeRuleKey[]) {
      const rule = want[key];
      const existing = state.ids[key];
      if (!rule) {
        if (existing)
          await guild.autoModerationRules
            .delete(existing, 'Filter turned off in the bot')
            .catch(() => undefined);
        continue;
      }
      let id: string | undefined;
      if (existing) {
        id = await guild.autoModerationRules
          .edit(existing, rule)
          .then((r) => r.id)
          .catch(() => undefined); // deleted by hand in Server Settings: make it again
      }
      ids[key] = id ?? (await guild.autoModerationRules.create(rule)).id;
    }
  } catch (err) {
    const error = `Discord refused the AutoMod rule: ${(err as Error).message}`.slice(0, 300);
    logger.warn(
      `Native AutoMod sync failed in ${guild.id}: ${(err as Error).message}`,
      "Check the bot's Manage Server permission and the server's AutoMod rule limits (6 keyword rules).",
    );
    await save(guild.id, { ids: { ...state.ids, ...ids }, error });
    return error;
  }
  await save(guild.id, { ids, hash, error: null });
  return null;
}

async function save(guildId: string, state: NativeState): Promise<void> {
  await prisma.guildConfig.update({
    where: { id: guildId },
    data: { nativeAutomodState: JSON.stringify(state) },
  });
}

/** Slow-tick backstop: catch settings changed by any path (commands, dashboard, /config) within 5 minutes. */
export async function reconcileNativeAutomod(
  guilds: Map<string, Guild> | { get(id: string): Guild | undefined },
): Promise<void> {
  const rows = await prisma.guildConfig.findMany({
    where: { OR: [{ nativeAutomod: true }, { nativeAutomodState: { contains: '"ids":{"' } }] },
    select: { id: true },
  });
  for (const { id } of rows) {
    const g = guilds.get(id);
    if (g)
      await syncNativeAutomod(g).catch((err) =>
        logger.debug(`AutoMod reconcile ${id}: ${(err as Error).message}`),
      );
  }
}
