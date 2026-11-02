// Runs add-ons: the slow scheduler tick checks each one when it's due, and
// the dashboard's webhook route hands incoming messages to handleHook.
// Every failure is stored on the add-on (shown in the dashboard and
// /addons list) instead of crashing or spamming the log.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Addon } from '@prisma/client';
import { ChannelType, Client, EmbedBuilder, MessageCreateOptions } from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { guildIdsWithModuleOff, isModuleEnabledForGuild } from '../lib/modules';
import {
  AddonKind,
  CHECK_EVERY_MIN,
  EPIC_URL,
  FeedItem,
  FreeGame,
  HookMessage,
  MAX_ADDONS_PER_SERVER,
  isAddonKind,
  parseEpicFree,
  parseFeed,
  parseServerTarget,
  parseState,
  pickNew,
  steamNewsUrl,
} from './parse';
import { checkUrl, safeGetText } from './safeFetch';

const COLORS: Record<AddonKind, number> = {
  rss: 0xf26522,
  steam_news: 0x1b2838,
  epic_free: 0x2a2a2a,
  server_watch: 0x2ecc71,
  webhook: 0x5865f2,
};

/** Checks what an admin typed for an add-on's target, and returns it in stored form. */
export function normalizeTarget(
  kind: AddonKind,
  raw: string,
): { ok: true; target: string } | { ok: false; error: string } {
  const v = raw.trim();
  switch (kind) {
    case 'rss': {
      const problem = checkUrl(v);
      return problem ? { ok: false, error: problem } : { ok: true, target: v };
    }
    case 'steam_news': {
      const id = /(?:app\/)?(\d{1,10})/.exec(v)?.[1];
      return id
        ? { ok: true, target: id }
        : { ok: false, error: "Enter the Steam app ID, the number in the game's store address." };
    }
    case 'server_watch':
      return parseServerTarget(v)
        ? { ok: true, target: v }
        : {
            ok: false,
            error: 'Enter game|host or game|host|port, e.g. minecraft|play.example.com|25565.',
          };
    case 'epic_free':
    case 'webhook':
      return { ok: true, target: '' };
  }
}

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

export interface NewAddon {
  guildId: string;
  kind: string;
  name: string;
  channelId: string;
  target: string;
  mentionRoleId: string | null;
  createdBy: string;
}

/** Validates and saves a new add-on. For webhooks, `secret` is returned once and never stored. */
export async function createAddon(
  input: NewAddon,
): Promise<{ ok: true; addon: Addon; secret?: string } | { ok: false; error: string }> {
  if (!isAddonKind(input.kind)) return { ok: false, error: 'Unknown add-on type.' };
  const count = await prisma.addon.count({ where: { guildId: input.guildId } });
  if (count >= MAX_ADDONS_PER_SERVER)
    return {
      ok: false,
      error: `A server can have up to ${MAX_ADDONS_PER_SERVER} add-ons. Remove one first.`,
    };
  const t = normalizeTarget(input.kind, input.target);
  if (!t.ok) return t;
  const name = input.name.trim().slice(0, 80) || defaultName(input.kind, t.target);
  const secret = input.kind === 'webhook' ? randomBytes(24).toString('base64url') : undefined;
  await prisma.guildConfig.upsert({
    where: { id: input.guildId },
    update: {},
    create: { id: input.guildId },
  });
  const addon = await prisma.addon.create({
    data: {
      guildId: input.guildId,
      kind: input.kind,
      name,
      channelId: input.channelId,
      target: t.target,
      mentionRoleId: input.mentionRoleId,
      secretHash: secret ? hashSecret(secret) : null,
      createdBy: input.createdBy,
    },
  });
  return { ok: true, addon, secret };
}

function defaultName(kind: AddonKind, target: string): string {
  switch (kind) {
    case 'rss':
      try {
        return new URL(target).hostname.replace(/^www\./, '');
      } catch {
        return 'Feed';
      }
    case 'steam_news':
      return `Steam app ${target}`;
    case 'epic_free':
      return 'Epic free games';
    case 'server_watch':
      return parseServerTarget(target)?.host ?? 'Game server';
    case 'webhook':
      return 'Webhook';
  }
}

async function send(client: Client, addon: Addon, options: MessageCreateOptions): Promise<void> {
  const channel = await client.channels.fetch(addon.channelId).catch(() => null);
  if (
    !channel ||
    (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
  ) {
    throw new Error("its channel is gone or isn't a text channel; pick another one");
  }
  const role = addon.mentionRoleId;
  await channel.send({
    ...options,
    content: role
      ? `<@&${role}>${options.content ? ` ${options.content}` : ''}`.slice(0, 2000)
      : options.content,
    // Only the role the admin picked can be pinged; text from feeds and
    // webhooks never pings anyone.
    allowedMentions: { parse: [], roles: role ? [role] : [] },
  });
}

function feedEmbed(addon: Addon, item: FeedItem): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(COLORS[addon.kind as AddonKind] ?? 0x5865f2)
    .setTitle(item.title.slice(0, 256))
    .setFooter({ text: addon.name.slice(0, 100) });
  if (item.link) e.setURL(item.link);
  if (item.summary) e.setDescription(item.summary);
  if (item.image) e.setImage(item.image);
  if (item.published) e.setTimestamp(item.published);
  return e;
}

function gameEmbed(game: FreeGame): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(COLORS.epic_free)
    .setTitle(`🎁 Free on Epic: ${game.title}`.slice(0, 256))
    .setURL(game.url)
    .setDescription(
      [
        game.description,
        game.endsAt ? `Free until <t:${Math.floor(game.endsAt.getTime() / 1000)}:f>.` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  if (game.image) e.setImage(game.image);
  return e;
}

/** One check of one add-on. Returns a short summary, or throws with a readable message. */
export async function runAddon(client: Client, addon: Addon): Promise<string> {
  const state = parseState(addon.state);
  const firstRun = addon.lastCheckedAt === null;
  let summary = 'nothing new';
  switch (addon.kind as AddonKind) {
    case 'rss':
    case 'steam_news': {
      const url = addon.kind === 'rss' ? addon.target : steamNewsUrl(addon.target);
      const items = parseFeed(
        await safeGetText(
          url,
          'application/rss+xml, application/atom+xml, application/xml, text/xml',
        ),
      );
      const { post, seen } = pickNew(items, state.seen, firstRun);
      for (const item of post) await send(client, addon, { embeds: [feedEmbed(addon, item)] });
      await saveState(addon, { ...state, seen });
      summary = firstRun
        ? `connected: ${items.length} existing item(s) skipped, new ones will be posted`
        : `${post.length} new item(s) posted`;
      break;
    }
    case 'epic_free': {
      const games = parseEpicFree(JSON.parse(await safeGetText(EPIC_URL, 'application/json')));
      // Unlike feeds, post what's free right now the first time too: that's
      // what someone adding this wants to see.
      const { post, seen } = pickNew(games, state.seen, false);
      for (const g of post) await send(client, addon, { embeds: [gameEmbed(g)] });
      await saveState(addon, { ...state, seen });
      summary = `${post.length} free game(s) posted`;
      break;
    }
    case 'server_watch': {
      const t = parseServerTarget(addon.target);
      if (!t) throw new Error('its server address is invalid');
      const { GameDig } = await import('gamedig');
      let online = false;
      let players = 0;
      let max = 0;
      let name = addon.name;
      try {
        const s = await GameDig.query({
          type: t.game,
          host: t.host,
          ...(t.port ? { port: t.port } : {}),
          maxRetries: 1,
          socketTimeout: 3000,
          attemptTimeout: 10000,
        });
        online = true;
        players = s.numplayers ?? s.players.length;
        max = s.maxplayers;
        name = s.name || name;
      } catch {
        online = false;
      }
      // Two failed checks in a row before calling it offline, so one dropped
      // packet doesn't post "offline" then "back online" five minutes later.
      const fails = online ? 0 : (state.fails ?? 0) + 1;
      const wasOnline = state.online;
      let nowOnline = wasOnline;
      if (online) nowOnline = true;
      else if (fails >= 2 || wasOnline === undefined) nowOnline = false;
      if (!firstRun && wasOnline !== undefined && nowOnline !== wasOnline) {
        await send(client, addon, {
          embeds: [
            new EmbedBuilder()
              .setColor(nowOnline ? 0x2ecc71 : 0xe74c3c)
              .setTitle(nowOnline ? `🟢 ${name} is online` : `🔴 ${addon.name} is offline`)
              .setDescription(
                nowOnline
                  ? `${players}/${max} players`
                  : "It hasn't answered for two checks in a row.",
              )
              .setFooter({ text: `${t.game} · ${t.host}${t.port ? `:${t.port}` : ''}` })
              .setTimestamp(new Date()),
          ],
        });
        summary = nowOnline ? 'came online (posted)' : 'went offline (posted)';
      } else summary = nowOnline ? `online, ${players}/${max} players` : 'offline';
      await saveState(addon, { ...state, online: nowOnline, players, fails });
      break;
    }
    case 'webhook':
      summary = 'webhooks post when an app sends to them';
      break;
  }
  return summary;
}

async function saveState(addon: Addon, state: Record<string, unknown>): Promise<void> {
  await prisma.addon.update({ where: { id: addon.id }, data: { state: JSON.stringify(state) } });
}

/** Run one add-on now and record the outcome (used by the scheduler and the Test buttons). */
export async function checkAddonNow(
  client: Client,
  addon: Addon,
): Promise<{ ok: boolean; message: string }> {
  try {
    const message = await runAddon(client, addon);
    await prisma.addon.update({
      where: { id: addon.id },
      data: { lastCheckedAt: new Date(), lastError: null },
    });
    return { ok: true, message };
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    await prisma.addon
      .update({ where: { id: addon.id }, data: { lastCheckedAt: new Date(), lastError: message } })
      .catch(() => undefined);
    logger.debug(`Add-on ${addon.id} (${addon.kind}) failed: ${message}`);
    return { ok: false, message };
  }
}

let running = false;

/** Slow-tick job: check every enabled add-on that's due, in servers that have add-ons switched on. */
export async function checkAddons(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    const off = await guildIdsWithModuleOff('addons');
    const all = await prisma.addon.findMany({
      where: { enabled: true, kind: { not: 'webhook' } },
      orderBy: { lastCheckedAt: 'asc' },
      take: 200,
    });
    const now = Date.now();
    for (const a of all) {
      if (off.has(a.guildId) || !client.guilds.cache.has(a.guildId)) continue;
      const every = CHECK_EVERY_MIN[a.kind as Exclude<AddonKind, 'webhook'>] ?? 15;
      // A little slack so a 5-minute check isn't pushed to 10 by tick timing.
      if (a.lastCheckedAt && now - a.lastCheckedAt.getTime() < every * 60_000 - 30_000) continue;
      await checkAddonNow(client, a);
    }
  } finally {
    running = false;
  }
}

const hookHits = new Map<number, number[]>();
const HOOK_LIMIT_PER_MIN = 30;

/** Incoming webhook. Returns an HTTP status and a short message for the sender. */
export async function handleHook(
  client: Client,
  id: number,
  secret: string,
  msg: HookMessage | string,
): Promise<{ status: number; message: string }> {
  const addon = Number.isInteger(id) ? await prisma.addon.findUnique({ where: { id } }) : null;
  const ok =
    addon?.kind === 'webhook' &&
    addon.secretHash !== null &&
    timingSafeEqual(Buffer.from(hashSecret(secret)), Buffer.from(addon.secretHash));
  if (!addon || !ok) return { status: 404, message: 'unknown webhook' };
  if (!addon.enabled || !(await isModuleEnabledForGuild(addon.guildId, 'addons')))
    return { status: 403, message: 'this webhook is switched off' };
  if (typeof msg === 'string') return { status: 400, message: msg };
  const now = Date.now();
  const hits = (hookHits.get(id) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= HOOK_LIMIT_PER_MIN)
    return { status: 429, message: `slow down: at most ${HOOK_LIMIT_PER_MIN} messages a minute` };
  hits.push(now);
  hookHits.set(id, hits);
  try {
    const embeds = msg.embeds?.map((e) => ({
      ...e,
      footer: e.footer ?? { text: msg.username ?? addon.name },
    }));
    await send(client, addon, { content: msg.content, embeds: embeds as never });
    await prisma.addon.update({
      where: { id },
      data: { lastCheckedAt: new Date(), lastError: null },
    });
    return { status: 204, message: '' };
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    await prisma.addon
      .update({ where: { id }, data: { lastError: message } })
      .catch(() => undefined);
    return { status: 502, message: `Discord refused the message: ${message}` };
  }
}

/** A plain description of what an add-on watches, for lists. */
export function describeTarget(a: Addon): string {
  switch (a.kind as AddonKind) {
    case 'rss':
      return a.target;
    case 'steam_news':
      return `Steam app ${a.target}`;
    case 'epic_free':
      return 'Epic Games Store giveaways';
    case 'server_watch':
      return a.target.replace(/\|/g, ' · ');
    case 'webhook':
      return 'incoming messages from other apps';
    default:
      return a.target;
  }
}
