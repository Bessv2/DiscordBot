import { describe, expect, it } from 'vitest';
import {
  LOGIN_TTL_MS,
  SESSION_TTL_MS,
  createLoginToken,
  getSession,
  readCookie,
  redeemLoginToken,
  safeEqual,
} from '../src/dashboard/auth';
import { PAGES, ValidationContext, getPage, parseField } from '../src/dashboard/fields';
import { esc, featurePage, overviewPage } from '../src/dashboard/render';
import { isModuleId } from '../src/lib/modules';

describe('dashboard sign-in', () => {
  it('a login token works once and starts a session for that user and server', () => {
    const t = createLoginToken('u1', 'g1', 1_000);
    const s = redeemLoginToken(t, 2_000);
    expect(s).toMatchObject({ userId: 'u1', guildId: 'g1' });
    expect(s!.csrf).toHaveLength(43);
    expect(redeemLoginToken(t, 2_000)).toBeNull();
    expect(getSession(s!.id, 3_000)?.userId).toBe('u1');
  });

  it('expired login tokens and sessions are refused', () => {
    const t = createLoginToken('u1', 'g1', 0);
    expect(redeemLoginToken(t, LOGIN_TTL_MS + 1)).toBeNull();
    const s = redeemLoginToken(createLoginToken('u1', 'g1', 0), 0)!;
    expect(getSession(s.id, SESSION_TTL_MS + 1)).toBeNull();
    expect(getSession(s.id, 0)).toBeNull(); // gone for good once expired
  });

  it('unknown tokens and session IDs get nothing', () => {
    expect(redeemLoginToken('nope')).toBeNull();
    expect(getSession(undefined)).toBeNull();
    expect(getSession('nope')).toBeNull();
  });

  it('compares CSRF tokens safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abd', 'abc')).toBe(false);
    expect(safeEqual('ab', 'abc')).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
  });

  it('reads a cookie by name', () => {
    expect(readCookie('a=1; dash_sid=xyz; b=2', 'dash_sid')).toBe('xyz');
    expect(readCookie(undefined, 'dash_sid')).toBeUndefined();
    expect(readCookie('dash_sidx=1', 'dash_sid')).toBeUndefined();
  });
});

const ctx: ValidationContext = {
  textChannelIds: new Set(['c1', 'c2']),
  voiceChannelIds: new Set(['v1']),
  roleIds: new Set(['r1', 'r2']),
};
const field = (page: string, key: string) => getPage(page)!.fields.find((f) => f.key === key)!;

describe('dashboard fields', () => {
  it('every page with a switch names a real module, and keys are unique per page', () => {
    for (const p of PAGES) {
      if (p.moduleId) expect(isModuleId(p.moduleId)).toBe(true);
      const keys = p.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('only accepts channels and roles that are on the server, of the right kind', () => {
    const modlog = field('modlog', 'modLogChannelId');
    expect(parseField(modlog, 'c1', ctx)).toEqual({ ok: true, value: 'c1' });
    expect(parseField(modlog, '', ctx)).toEqual({ ok: true, value: null });
    expect(parseField(modlog, 'v1', ctx).ok).toBe(false);
    expect(parseField(modlog, '123', ctx).ok).toBe(false);
    expect(parseField(field('tempvoice', 'tempVoiceHubId'), 'v1', ctx)).toEqual({
      ok: true,
      value: 'v1',
    });
    expect(parseField(field('tickets', 'ticketStaffRoleId'), 'r9', ctx).ok).toBe(false);
  });

  it('role lists are capped and stored as JSON', () => {
    const join = field('joinroles', 'joinRoleIds');
    expect(parseField(join, ['r1', 'r2', 'r1'], ctx)).toEqual({ ok: true, value: '["r1","r2"]' });
    expect(parseField(join, undefined, ctx)).toEqual({ ok: true, value: '[]' });
    expect(parseField(join, ['r1', 'bad'], ctx).ok).toBe(false);
    expect(parseField(field('permissions', 'perm_admin'), 'r2', ctx)).toEqual({
      ok: true,
      value: ['r2'],
    });
  });

  it('numbers must be whole and in the same range as /setup, and are scaled', () => {
    const interval = field('automod', 'spamIntervalMs');
    expect(parseField(interval, '5', ctx)).toEqual({ ok: true, value: 5000 });
    expect(parseField(interval, '0', ctx).ok).toBe(false);
    expect(parseField(interval, '121', ctx).ok).toBe(false);
    expect(parseField(interval, '2.5', ctx).ok).toBe(false);
    expect(parseField(interval, '-3', ctx).ok).toBe(false);
    expect(parseField(interval, '', ctx).ok).toBe(false);
    expect(parseField(field('automod', 'contentRetainDays'), '366', ctx).ok).toBe(false);
  });

  it('checkboxes, text, words and log events', () => {
    expect(parseField(field('automod', 'inviteFilterOn'), 'on', ctx)).toEqual({
      ok: true,
      value: true,
    });
    expect(parseField(field('automod', 'inviteFilterOn'), undefined, ctx)).toEqual({
      ok: true,
      value: false,
    });
    const prefix = field('prefix', 'prefix');
    expect(parseField(prefix, ' ? ', ctx)).toEqual({ ok: true, value: '?' });
    expect(parseField(prefix, 'a b', ctx).ok).toBe(false);
    expect(parseField(prefix, '', ctx).ok).toBe(false);
    expect(parseField(field('automod', 'bannedWords'), 'Foo\nbar, foo\n\n', ctx)).toEqual({
      ok: true,
      value: '["foo","bar"]',
    });
    // Ticked boxes are the events to log; what's stored is the opt-out list.
    const r = parseField(field('serverlog', 'serverLogEvents'), ['messages', 'bans'], ctx);
    expect(r.ok).toBe(true);
    const events = JSON.parse((r as { value: string }).value) as string[];
    expect(events).not.toContain('messages');
    expect(events).not.toContain('bans');
    expect(events).toContain('voice');
  });
});

describe('dashboard pages', () => {
  const shell = { guildName: '<script>alert(1)</script>', guildIconUrl: null, csrf: 'tok"en' };

  it('escapes everything that comes from Discord or members', () => {
    expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    const html = featurePage(
      shell,
      getPage('welcome')!,
      { welcomeMessage: '</textarea><script>x</script>', welcomeChannelId: 'c1' },
      {
        textChannels: [{ id: 'c1', name: '"><img src=x onerror=alert(1)>' }],
        voiceChannels: [],
        roles: [],
      },
      true,
      [],
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;/textarea&gt;&lt;script&gt;');
    expect(html).toContain('value="tok&quot;en"');
    expect(html).toContain('<option value="c1" selected>');
  });

  it('every form carries the CSRF token', () => {
    const html = overviewPage(
      shell,
      [
        {
          id: 'xp',
          name: 'Levels',
          emoji: '📈',
          group: 'Games & fun',
          state: 'on',
          detail: 'posts in <#123>',
        },
      ],
      new Map([['xp', true]]),
      new Set(['xp']),
    );
    const forms = html.match(/<form[^>]*method="post"/g) ?? [];
    const tokens = html.match(/name="csrf" value="tok&quot;en"/g) ?? [];
    expect(forms.length).toBeGreaterThan(1);
    expect(tokens.length).toBe(forms.length);
    expect(html).toContain('posts in (set)');
    expect(html).not.toContain('<#123>');
  });
});
