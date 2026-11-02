import { Message } from 'discord.js';
import { prisma } from '../lib/db';
import { isModuleEnabledForGuild } from '../lib/modules';

export type MatchType = 'contains' | 'exact' | 'starts';
export interface Responder {
  trigger: string;
  matchType: string;
  response: string;
}

export const MAX_RESPONDERS = 50;
const COOLDOWN_MS = 30_000; // per channel and trigger, so a trigger can't be used to spam
const CACHE_MS = 60_000;

/** Pure: which responder (if any) fires for this message text? Whole words for "contains". */
export function matchResponder(content: string, responders: Responder[]): Responder | null {
  const text = content.toLowerCase().trim();
  if (!text) return null;
  for (const r of responders) {
    const t = r.trigger;
    if (r.matchType === 'exact' && text === t) return r;
    if (r.matchType === 'starts' && text.startsWith(t)) return r;
    if (r.matchType === 'contains') {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|\\W)${escaped}($|\\W)`, 'u').test(text)) return r;
    }
  }
  return null;
}

const cache = new Map<string, { at: number; list: Responder[] }>();
const lastFired = new Map<string, number>();

export function invalidateResponders(guildId: string): void {
  cache.delete(guildId);
}

/** messageCreate (needs Message Content): reply if a trigger matches. Returns true if it replied. */
export async function runAutoResponders(message: Message<true>): Promise<boolean> {
  let entry = cache.get(message.guildId);
  if (!entry || Date.now() - entry.at > CACHE_MS) {
    entry = {
      at: Date.now(),
      list: await prisma.autoResponder.findMany({
        where: { guildId: message.guildId },
        select: { trigger: true, matchType: true, response: true },
      }),
    };
    cache.set(message.guildId, entry);
  }
  if (!entry.list.length) return false;
  const hit = matchResponder(message.content, entry.list);
  if (!hit) return false;
  if (!(await isModuleEnabledForGuild(message.guildId, 'autoresponders'))) return false;
  const key = `${message.channelId}:${hit.trigger}`;
  if (Date.now() - (lastFired.get(key) ?? 0) < COOLDOWN_MS) return false;
  lastFired.set(key, Date.now());
  await message
    .reply({ content: hit.response, allowedMentions: { parse: [], repliedUser: false } })
    .catch(() => undefined);
  return true;
}
