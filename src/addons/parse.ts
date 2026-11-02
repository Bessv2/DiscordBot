// Pure parsing for add-ons, no network or Discord, so it's unit tested:
// RSS/Atom feeds, Epic's free-games list, which items are new, and the body
// of an incoming webhook.
import { XMLParser } from 'fast-xml-parser';

export type AddonKind = 'rss' | 'steam_news' | 'epic_free' | 'server_watch' | 'webhook';

export const ADDON_KINDS: {
  kind: AddonKind;
  label: string;
  emoji: string;
  help: string;
  target?: string;
}[] = [
  {
    kind: 'rss',
    label: 'RSS / Atom feed',
    emoji: '📰',
    help: 'Posts new items from any news feed: game patch notes, blogs, subreddits (add .rss to the address), YouTube channels (youtube.com/feeds/videos.xml?channel_id=...).',
    target: 'Feed address (https://...)',
  },
  {
    kind: 'steam_news',
    label: 'Steam game news',
    emoji: '🎮',
    help: "Posts a Steam game's news and patch notes. Use the number in the game's store address, e.g. 730 for Counter-Strike 2.",
    target: 'Steam app ID (a number)',
  },
  {
    kind: 'epic_free',
    label: 'Epic free games',
    emoji: '🎁',
    help: 'Posts the games the Epic Games Store is giving away, once each, when they become free.',
  },
  {
    kind: 'server_watch',
    label: 'Game server up/down',
    emoji: '🖥️',
    help: 'Checks a game server every 5 minutes and posts when it goes offline or comes back. Uses the same game names as /gameserver.',
    target: 'game|host|port, e.g. minecraft|play.example.com|25565 (port optional)',
  },
  {
    kind: 'webhook',
    label: 'Incoming webhook',
    emoji: '🔗',
    help: 'A private address other apps and game-server plugins send messages to; the bot posts them. It accepts the same format as a Discord webhook, so anything that can "post to a Discord webhook" works. Needs the web dashboard to be reachable by the sending app.',
  },
];

export const MAX_ADDONS_PER_SERVER = 25;
export const MAX_POSTS_PER_CHECK = 3;
const MAX_SEEN = 300;

export function isAddonKind(v: string): v is AddonKind {
  return ADDON_KINDS.some((k) => k.kind === v);
}

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  published: Date | null;
  summary: string;
  image: string | null;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Feeds are untrusted; keep entity expansion to the standard ones.
  processEntities: true,
  htmlEntities: true,
});

const arr = <T>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>))
    return text((v as Record<string, unknown>)['#text']);
  return '';
}

/** Strips tags and collapses whitespace, for a short plain-text summary. */
export function plain(html: string, max = 300): string {
  const t = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function date(v: unknown): Date | null {
  const d = new Date(text(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeLink(v: string): string {
  return /^https?:\/\//i.test(v) ? v : '';
}

/** Reads RSS 2.0, RSS 1.0 (RDF) and Atom. Returns newest first as the feed lists them. Throws if it isn't a feed. */
export function parseFeed(body: string): FeedItem[] {
  let doc: Record<string, any>;
  try {
    doc = xml.parse(body) as Record<string, any>;
  } catch {
    throw new Error("that address doesn't return a valid RSS or Atom feed");
  }
  const rss = doc.rss?.channel ?? doc['rdf:RDF'];
  if (rss) {
    const items = arr(rss.item ?? doc['rdf:RDF']?.item);
    return items.map((it: Record<string, any>) => {
      const link = safeLink(text(it.link));
      const enclosure = arr(it.enclosure).find((e: Record<string, any>) =>
        /^image\//.test(e['@_type'] ?? ''),
      );
      return {
        id: text(it.guid) || link || text(it.title),
        title: plain(text(it.title), 256) || '(untitled)',
        link,
        published: date(it.pubDate ?? it['dc:date']),
        summary: plain(text(it.description ?? it['content:encoded'])),
        image: enclosure ? safeLink(enclosure['@_url'] ?? '') || null : null,
      };
    });
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map((e: Record<string, any>) => {
      const links = arr(e.link);
      const alt =
        links.find((l: Record<string, any>) => !l['@_rel'] || l['@_rel'] === 'alternate') ??
        links[0];
      const link = safeLink(typeof alt === 'string' ? alt : (alt?.['@_href'] ?? ''));
      const thumb = e['media:group']?.['media:thumbnail']?.['@_url'];
      return {
        id: text(e.id) || link || text(e.title),
        title: plain(text(e.title), 256) || '(untitled)',
        link,
        published: date(e.published ?? e.updated),
        summary: plain(text(e.summary ?? e.content ?? e['media:group']?.['media:description'])),
        image: thumb ? safeLink(thumb) || null : null,
      };
    });
  }
  throw new Error("that address doesn't return a valid RSS or Atom feed");
}

export function steamNewsUrl(appId: string): string {
  return `https://store.steampowered.com/feeds/news/app/${encodeURIComponent(appId)}/?l=english`;
}

export const EPIC_URL =
  'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US';

export interface FreeGame {
  id: string;
  title: string;
  url: string;
  endsAt: Date | null;
  image: string | null;
  description: string;
}

/** The games that are free right now (100% off), from Epic's promotions JSON. */
export function parseEpicFree(json: unknown, now = new Date()): FreeGame[] {
  const elements = (json as any)?.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements))
    throw new Error("Epic's free-games list came back in an unexpected format");
  const out: FreeGame[] = [];
  for (const el of elements) {
    const offers = arr(el?.promotions?.promotionalOffers).flatMap((p: any) =>
      arr(p?.promotionalOffers),
    );
    const current = offers.find((o: any) => {
      const start = new Date(o?.startDate);
      const end = new Date(o?.endDate);
      return o?.discountSetting?.discountPercentage === 0 && start <= now && now < end;
    });
    if (!current) continue;
    const slug =
      el.productSlug ||
      el.offerMappings?.[0]?.pageSlug ||
      el.catalogNs?.mappings?.[0]?.pageSlug ||
      el.urlSlug;
    const img =
      arr(el.keyImages).find((k: any) => k?.type === 'OfferImageWide') ?? arr(el.keyImages)[0];
    out.push({
      id: `${el.id}:${current.startDate}`,
      title: String(el.title ?? 'A free game'),
      url: slug
        ? `https://store.epicgames.com/p/${String(slug).replace(/\/home$/, '')}`
        : 'https://store.epicgames.com/free-games',
      endsAt: new Date(current.endDate),
      image: img?.url && /^https:\/\//.test(img.url) ? img.url : null,
      description: plain(String(el.description ?? ''), 200),
    });
  }
  return out;
}

/**
 * Which items haven't been posted yet. On the very first check nothing is
 * posted (`firstRun`), so adding a feed doesn't flood the channel with its
 * whole history; at most MAX_POSTS_PER_CHECK go out per check, oldest first.
 */
export function pickNew<T extends { id: string }>(
  items: T[],
  seen: string[],
  firstRun: boolean,
): { post: T[]; seen: string[] } {
  const known = new Set(seen);
  const fresh = items.filter((i) => i.id && !known.has(i.id));
  const nextSeen = [...fresh.map((i) => i.id), ...seen].slice(0, MAX_SEEN);
  if (firstRun) return { post: [], seen: nextSeen };
  return { post: fresh.slice(0, MAX_POSTS_PER_CHECK).reverse(), seen: nextSeen };
}

export interface ServerTarget {
  game: string;
  host: string;
  port?: number;
}

export function parseServerTarget(raw: string): ServerTarget | null {
  const [game, host, port, ...rest] = raw.split('|').map((s) => s.trim());
  if (
    rest.length ||
    !game ||
    !host ||
    !/^[a-z0-9_-]{1,40}$/i.test(game) ||
    !/^[a-z0-9.-]{1,253}$/i.test(host)
  )
    return null;
  if (port === undefined || port === '') return { game: game.toLowerCase(), host };
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return { game: game.toLowerCase(), host, port: n };
}

export interface HookMessage {
  content?: string;
  embeds?: Record<string, unknown>[];
  username?: string;
}

/**
 * Turns an incoming webhook body into a message. Accepts Discord's webhook
 * format ({content, embeds, username}) or plain text. Returns an error
 * string if there's nothing usable.
 */
export function parseHookBody(body: unknown, contentType: string): HookMessage | string {
  if (typeof body === 'string' || /^text\//.test(contentType)) {
    const t = String(body ?? '').trim();
    if (!t) return 'empty message';
    return { content: t.slice(0, 2000) };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return 'expected JSON like {"content": "..."}';
  const b = body as Record<string, unknown>;
  const content = typeof b.content === 'string' ? b.content.trim().slice(0, 2000) : undefined;
  const embeds = Array.isArray(b.embeds)
    ? b.embeds
        .filter(
          (e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e),
        )
        .slice(0, 10)
    : undefined;
  const username = typeof b.username === 'string' ? b.username.trim().slice(0, 80) : undefined;
  if (!content && !embeds?.length) return 'expected "content" text or "embeds"';
  return {
    content: content || undefined,
    embeds: embeds?.length ? embeds : undefined,
    username: username || undefined,
  };
}

export function parseState(json: string | null | undefined): {
  seen: string[];
  online?: boolean;
  players?: number;
  fails?: number;
} {
  try {
    const s = JSON.parse(json ?? '{}') as Record<string, unknown>;
    return {
      seen: Array.isArray(s.seen) ? s.seen.filter((x): x is string => typeof x === 'string') : [],
      online: typeof s.online === 'boolean' ? s.online : undefined,
      players: typeof s.players === 'number' ? s.players : undefined,
      fails: typeof s.fails === 'number' ? s.fails : undefined,
    };
  } catch {
    return { seen: [] };
  }
}

/** Minutes between checks for each kind. */
export const CHECK_EVERY_MIN: Record<Exclude<AddonKind, 'webhook'>, number> = {
  rss: 15,
  steam_news: 30,
  epic_free: 360,
  server_watch: 5,
};
