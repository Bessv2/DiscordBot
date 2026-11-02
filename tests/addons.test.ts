import { describe, expect, it } from 'vitest';
import {
  MAX_POSTS_PER_CHECK,
  parseEpicFree,
  parseFeed,
  parseHookBody,
  parseServerTarget,
  parseState,
  pickNew,
  plain,
  steamNewsUrl,
} from '../src/addons/parse';
import { checkUrl, isPrivateAddress } from '../src/addons/safeFetch';
import { normalizeTarget } from '../src/addons/runner';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Game</title>
<item><title>Patch 1.2 &amp; fixes</title><link>https://game.example/p12</link><guid>p12</guid><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate>
<description><![CDATA[<p>Big <b>changes</b><script>evil()</script></p>]]></description><enclosure url="https://cdn.example/a.png" type="image/png"/></item>
<item><title>Patch 1.1</title><link>javascript:alert(1)</link><guid>p11</guid></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<entry><id>yt:video:abc</id><title>New video</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><published>2026-11-01T12:00:00Z</published>
<media:group><media:thumbnail url="https://i.ytimg.com/vi/abc/hq.jpg"/><media:description>Hello</media:description></media:group></entry></feed>`;

describe('feeds', () => {
  it('reads RSS: text, safe links, plain summaries, images', () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'p12',
      title: 'Patch 1.2 & fixes',
      link: 'https://game.example/p12',
      image: 'https://cdn.example/a.png',
    });
    expect(items[0]!.summary).toBe('Big changes');
    expect(items[0]!.published?.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    expect(items[1]!.link).toBe(''); // javascript: links are dropped
  });

  it('reads Atom (YouTube channel feeds)', () => {
    const [item] = parseFeed(ATOM);
    expect(item).toMatchObject({
      id: 'yt:video:abc',
      title: 'New video',
      link: 'https://www.youtube.com/watch?v=abc',
      image: 'https://i.ytimg.com/vi/abc/hq.jpg',
      summary: 'Hello',
    });
  });

  it('refuses things that are not feeds', () => {
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow(/RSS or Atom/);
    expect(() => parseFeed('not xml at all {')).toThrow(/RSS or Atom/);
  });

  it('shortens long summaries', () => {
    expect(plain('x'.repeat(500), 50)).toHaveLength(50);
  });

  it('builds the Steam news feed address', () => {
    expect(steamNewsUrl('730')).toBe(
      'https://store.steampowered.com/feeds/news/app/730/?l=english',
    );
  });
});

describe('what counts as new', () => {
  const items = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  it('posts nothing on the first check, but remembers everything', () => {
    expect(pickNew(items, [], true)).toEqual({ post: [], seen: ['c', 'b', 'a'] });
  });
  it('posts only unseen items, oldest first, capped per check', () => {
    expect(pickNew(items, ['a'], false).post.map((i) => i.id)).toEqual(['b', 'c']);
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` }));
    expect(pickNew(many, ['x'], false).post).toHaveLength(MAX_POSTS_PER_CHECK);
  });
  it('reads stored state safely', () => {
    expect(parseState('garbage')).toEqual({ seen: [] });
    expect(parseState('{"seen":["a",1],"online":true,"fails":2}')).toMatchObject({
      seen: ['a'],
      online: true,
      fails: 2,
    });
  });
});

describe('Epic free games', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const json = {
    data: {
      Catalog: {
        searchStore: {
          elements: [
            {
              id: 'g1',
              title: 'Free Game',
              productSlug: 'free-game',
              description: 'Fun',
              keyImages: [{ type: 'OfferImageWide', url: 'https://cdn.epic/x.jpg' }],
              promotions: {
                promotionalOffers: [
                  {
                    promotionalOffers: [
                      {
                        startDate: '2026-10-30T15:00:00Z',
                        endDate: '2026-11-06T15:00:00Z',
                        discountSetting: { discountPercentage: 0 },
                      },
                    ],
                  },
                ],
              },
            },
            {
              id: 'g2',
              title: 'Only discounted',
              promotions: {
                promotionalOffers: [
                  {
                    promotionalOffers: [
                      {
                        startDate: '2026-10-30T15:00:00Z',
                        endDate: '2026-11-06T15:00:00Z',
                        discountSetting: { discountPercentage: 50 },
                      },
                    ],
                  },
                ],
              },
            },
            {
              id: 'g3',
              title: 'Coming soon',
              promotions: { promotionalOffers: [], upcomingPromotionalOffers: [{}] },
            },
          ],
        },
      },
    },
  };
  it('finds the games that are 100% off right now', () => {
    const games = parseEpicFree(json, now);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      id: 'g1:2026-10-30T15:00:00Z',
      title: 'Free Game',
      url: 'https://store.epicgames.com/p/free-game',
      image: 'https://cdn.epic/x.jpg',
    });
  });
  it('rejects an unexpected shape', () => {
    expect(() => parseEpicFree({})).toThrow();
  });
});

describe('targets', () => {
  it('parses game|host|port', () => {
    expect(parseServerTarget('Minecraft|play.example.com|25565')).toEqual({
      game: 'minecraft',
      host: 'play.example.com',
      port: 25565,
    });
    expect(parseServerTarget('valheim|1.2.3.4')).toEqual({ game: 'valheim', host: '1.2.3.4' });
    expect(parseServerTarget('minecraft|bad host')).toBeNull();
    expect(parseServerTarget('minecraft|h|99999')).toBeNull();
    expect(parseServerTarget('minecraft')).toBeNull();
  });
  it('normalizes what admins type', () => {
    expect(
      normalizeTarget('steam_news', 'https://store.steampowered.com/app/730/Counter_Strike_2/'),
    ).toEqual({ ok: true, target: '730' });
    expect(normalizeTarget('steam_news', 'abc').ok).toBe(false);
    expect(normalizeTarget('rss', 'https://example.com/feed').ok).toBe(true);
    expect(normalizeTarget('rss', 'ftp://example.com/feed').ok).toBe(false);
    expect(normalizeTarget('epic_free', 'ignored')).toEqual({ ok: true, target: '' });
  });
});

describe('network safety', () => {
  it('treats private, loopback, link-local and mapped addresses as private', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '::ffff:127.0.0.1',
    ])
      expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ['1.1.1.1', '93.184.216.34', '2606:4700::1111'])
      expect(isPrivateAddress(a), a).toBe(false);
  });
  it('refuses local URLs before connecting', () => {
    expect(checkUrl('http://127.0.0.1/feed')).toMatch(/private/);
    expect(checkUrl('http://[::1]/feed')).toMatch(/private/);
    expect(checkUrl('http://localhost:8080/')).toMatch(/local/);
    expect(checkUrl('http://router.local/')).toMatch(/local/);
    expect(checkUrl('https://user:pw@example.com/')).toMatch(/password/);
    expect(checkUrl('file:///etc/passwd')).toMatch(/http/);
    expect(checkUrl('https://example.com/feed.xml')).toBeNull();
  });
});

describe('incoming webhook bodies', () => {
  it('takes Discord webhook JSON or plain text', () => {
    expect(parseHookBody({ content: ' hi ', username: 'Server' }, 'application/json')).toEqual({
      content: 'hi',
      username: 'Server',
    });
    expect(parseHookBody({ embeds: [{ title: 't' }, 'junk', null] }, 'application/json')).toEqual({
      embeds: [{ title: 't' }],
    });
    expect(parseHookBody('Server restarted', 'text/plain')).toEqual({
      content: 'Server restarted',
    });
    expect(parseHookBody({ content: 'x'.repeat(3000) }, 'application/json')).toMatchObject({
      content: 'x'.repeat(2000),
    });
  });
  it('explains what is wrong with an unusable body', () => {
    expect(parseHookBody({}, 'application/json')).toMatch(/content/);
    expect(parseHookBody([1], 'application/json')).toMatch(/JSON/);
    expect(parseHookBody('', 'text/plain')).toMatch(/empty/);
  });
});
