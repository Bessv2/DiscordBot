// The opt-in web dashboard (ENABLE_DASHBOARD=true): the same settings as
// /setup, in a browser. It runs inside the bot process, so it shares the
// bot's database and Discord connection and costs a few MB when idle.
//
// Security model, for a host deciding whether to expose it:
// - Sign-in is a one-time link from /dashboard (see auth.ts); no passwords.
// - Every request re-checks, live against Discord, that the person is
//   still an admin of that one server. Losing the role ends the session.
// - Every form carries a CSRF token; the cookie is HttpOnly + SameSite=Lax
//   (+ Secure when DASHBOARD_URL is https).
// - Pages are plain HTML with no scripts, a strict Content-Security-Policy,
//   and every Discord- or member-supplied string escaped.
// - Channel and role IDs are checked against the server's real ones, so a
//   hand-made form can't point the bot elsewhere.
import http from 'node:http';
import express, { NextFunction, Request, Response } from 'express';
import { ChannelType, Client, Guild, GuildMember, PermissionFlagsBits } from 'discord.js';
import { config } from '../config';
import { getOrCreateGuildConfig, prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { getModule, isModuleId, isModuleOn, setModuleOn } from '../lib/modules';
import { getConfiguredRoleIds, memberHasPermission, setPermissionRoles } from '../lib/permissions';
import { checkRoleAssignable } from '../lib/moderationGuard';
import { parseStringList } from '../lib/jsonList';
import { featureStatuses } from '../setup/status';
import { hostFacts } from '../setup/hostFacts';
import {
  Session,
  destroySession,
  getSession,
  readCookie,
  redeemLoginToken,
  safeEqual,
  sweep,
  SESSION_TTL_MS,
} from './auth';
import { PAGES, getPage, parseField, ValidationContext } from './fields';
import { dashboardUrl } from './url';
import { FormOptions, Shell, casesPage, featurePage, messagePage, overviewPage } from './render';
import { ApiStatus, addonsPage } from './addonsPage';
import { ADDON_KINDS, parseHookBody } from '../addons/parse';
import { checkAddonNow, createAddon, handleHook } from '../addons/runner';
import { syncNativeAutomod } from '../automod/native';
import { postModLogNote } from '../lib/modlog';
import { casesToCsv, casesToJson, exportFileName } from '../lib/caseExport';
import { ListsData, listsPage } from './listsPage';
import { MAX_RESPONDERS, invalidateResponders } from '../features/autoResponders';

const COOKIE = 'dash_sid';

const secureCookie = () => dashboardUrl().startsWith('https://');

interface Ctx {
  session: Session;
  guild: Guild;
  member: GuildMember;
}

type Body = Record<string, string | string[] | undefined>;

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.set({
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; img-src https://cdn.discordapp.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // The sign-in link carries a token in its URL; never pass it on.
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  next();
}

function sessionCookie(value: string, maxAgeSec: number): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secureCookie() ? '; Secure' : ''}`;
}

function textChannels(guild: Guild) {
  return [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .sort((a, b) => ('position' in a && 'position' in b ? a.position - b.position : 0));
}

function voiceChannels(guild: Guild) {
  return [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildVoice)
    .sort((a, b) => ('position' in a && 'position' in b ? a.position - b.position : 0));
}

function pickableRoles(guild: Guild) {
  return [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position);
}

function shellFor(ctx: Ctx): Shell {
  return {
    guildName: ctx.guild.name,
    guildIconUrl: ctx.guild.iconURL({ size: 64 }),
    csrf: ctx.session.csrf,
  };
}

export function createApp(client: Client): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(securityHeaders);
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  const fail = (res: Response, status: number, title: string, text: string) =>
    res.status(status).type('html').send(messagePage(title, text));

  // Every change made here is also posted to the mod-log, so the server's
  // other moderators see it the same as a command.
  const note = (ctx: Ctx, change: string) =>
    postModLogNote(ctx.guild, {
      title: '⚙️ Changed on the web dashboard',
      moderator: ctx.member.user,
      fields: [{ name: 'Change', value: change }],
    }).catch(() => undefined);

  app.get('/login', (req, res) => {
    const t = typeof req.query.t === 'string' ? req.query.t : '';
    const session = t ? redeemLoginToken(t) : null;
    if (!session) {
      fail(
        res,
        401,
        'Link expired',
        'This sign-in link has expired or was already used. Run /dashboard in Discord for a new one.',
      );
      return;
    }
    res.set('Set-Cookie', sessionCookie(session.id, Math.floor(SESSION_TTL_MS / 1000)));
    // Off the URL straight away, so the token isn't left in history.
    res.redirect(303, '/');
  });

  app.post('/logout', (req, res) => {
    const id = readCookie(req.headers.cookie, COOKIE);
    const session = getSession(id);
    if (session && safeEqual((req.body as Body)?.csrf as string | undefined, session.csrf))
      destroySession(id);
    res.set('Set-Cookie', sessionCookie('', 0));
    fail(res, 200, 'Signed out', 'You are signed out. Run /dashboard in Discord to sign in again.');
  });

  // Incoming add-on webhooks. Authenticated by the secret in the address,
  // not a session, so they sit before the sign-in check. The raw body is
  // read as text (max 64 kB) and parsed here, so a malformed body gets a
  // short plain answer rather than an HTML error page.
  app.post(
    '/hooks/:id/:secret',
    express.text({ type: () => true, limit: '64kb' }),
    async (req, res) => {
      const type = String(req.headers['content-type'] ?? '');
      let body: unknown = typeof req.body === 'string' ? req.body : '';
      if (/json/i.test(type)) {
        try {
          body = JSON.parse(body as string);
        } catch {
          res.status(400).type('text').send('invalid JSON');
          return;
        }
      }
      const result = await handleHook(
        client,
        Number(req.params.id),
        String(req.params.secret),
        parseHookBody(body, /json/i.test(type) ? 'application/json' : type || 'text/plain'),
      );
      res.status(result.status).type('text').send(result.message);
    },
  );

  // Everything below needs a live session and current admin rights.
  app.use(async (req, res, next) => {
    const id = readCookie(req.headers.cookie, COOKIE);
    const session = getSession(id);
    if (!session) {
      fail(res, 401, 'Not signed in', 'Run /dashboard in Discord to get a sign-in link.');
      return;
    }
    const guild = client.guilds.cache.get(session.guildId);
    // Fetched fresh each time, so a removed admin role counts immediately.
    // Only "not a member" ends the session; a Discord hiccup just asks to retry.
    let member: GuildMember | null = null;
    if (guild) {
      try {
        member = await guild.members.fetch({ user: session.userId, force: true });
      } catch (err) {
        if ((err as { code?: number }).code !== 10007) {
          fail(
            res,
            503,
            'Discord is busy',
            "The bot couldn't reach Discord just now. Try again in a moment.",
          );
          return;
        }
      }
    }
    if (
      !guild ||
      !member ||
      !(await memberHasPermission(member, 'admin', PermissionFlagsBits.ManageGuild))
    ) {
      destroySession(id);
      fail(
        res,
        403,
        'No access',
        "You're no longer an admin of that server (or the bot left it), so you've been signed out.",
      );
      return;
    }
    if (
      req.method === 'POST' &&
      !safeEqual((req.body as Body)?.csrf as string | undefined, session.csrf)
    ) {
      fail(
        res,
        403,
        'Form expired',
        'That form came from an old page. Go back, reload, and try again.',
      );
      return;
    }
    res.locals.ctx = { session, guild, member } satisfies Ctx;
    next();
  });

  app.get('/', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const gc = await getOrCreateGuildConfig(ctx.guild.id);
    const statuses = featureStatuses(gc, await hostFacts(ctx.guild.id));
    const toggles = new Map<string, boolean>();
    for (const s of statuses) if (isModuleId(s.id)) toggles.set(s.id, isModuleOn(gc, s.id));
    let notice: string | undefined;
    const changed =
      typeof req.query.on === 'string'
        ? req.query.on
        : typeof req.query.off === 'string'
          ? req.query.off
          : '';
    if (changed && isModuleId(changed))
      notice = `${getModule(changed).name} is now ${req.query.on ? 'on' : 'off'}.`;
    const mentionName = (kind: '#' | '@&', id: string) =>
      kind === '#'
        ? `#${ctx.guild.channels.cache.get(id)?.name ?? 'deleted-channel'}`
        : `@${ctx.guild.roles.cache.get(id)?.name ?? 'deleted-role'}`;
    res
      .type('html')
      .send(
        overviewPage(
          shellFor(ctx),
          statuses,
          toggles,
          new Set([...PAGES.map((p) => p.id), 'addons']),
          notice,
          mentionName,
        ),
      );
  });

  app.post('/toggle/:id', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const id = req.params.id as string;
    if (!isModuleId(id)) {
      fail(res, 404, 'Not found', "There's no feature with that name.");
      return;
    }
    const gc = await getOrCreateGuildConfig(ctx.guild.id);
    const on = !isModuleOn(gc, id);
    await setModuleOn(ctx.guild.id, id, on);
    if (id === 'automod') await syncNativeAutomod(ctx.guild).catch(() => undefined);
    void note(ctx, `Turned **${getModule(id).name}** ${on ? 'on' : 'off'}.`);
    logger.info(
      `Dashboard: ${ctx.member.user.tag} turned ${id} ${on ? 'on' : 'off'} in ${ctx.guild.id}`,
    );
    const back =
      typeof req.query.back === 'string' && getPage(req.query.back) ? req.query.back : null;
    res.redirect(303, back ? `/f/${back}?saved=1` : `/?${on ? 'on' : 'off'}=${id}`);
  });

  const formOptions = (guild: Guild): FormOptions => ({
    textChannels: textChannels(guild).map((c) => ({ id: c.id, name: c.name })),
    voiceChannels: voiceChannels(guild).map((c) => ({ id: c.id, name: c.name })),
    roles: pickableRoles(guild).map((r) => ({ id: r.id, name: r.name })),
  });

  async function currentValues(guildId: string, pageId: string): Promise<Record<string, unknown>> {
    const page = getPage(pageId)!;
    const gc = (await getOrCreateGuildConfig(guildId)) as unknown as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    for (const f of page.fields) {
      if (f.kind === 'permroles') values[f.key] = await getConfiguredRoleIds(guildId, f.scope);
      else if (f.kind === 'roles' || f.kind === 'words' || f.kind === 'events')
        values[f.key] = parseStringList(gc[f.key] as string);
      else values[f.key] = gc[f.key];
    }
    return values;
  }

  function hostNotes(pageId: string): string[] {
    const notes: string[] = [];
    const mc = config.ENABLE_MESSAGE_CONTENT;
    const gm = config.ENABLE_GUILD_MEMBERS;
    if (pageId === 'automod' && !mc)
      notes.push(
        'The invite filter, word filter and mention-spam check need Message Content (ENABLE_MESSAGE_CONTENT).',
      );
    if ((pageId === 'antiraid' || pageId === 'welcome' || pageId === 'joinroles') && !gm)
      notes.push('Needs Server Members (ENABLE_GUILD_MEMBERS) to see people join.');
    if (pageId === 'serverlog') {
      if (!gm)
        notes.push(
          'Joins, leaves, nickname and role changes need Server Members (ENABLE_GUILD_MEMBERS).',
        );
      if (!mc)
        notes.push(
          'Edits and the text of deleted messages need Message Content (ENABLE_MESSAGE_CONTENT).',
        );
    }
    if (pageId === 'prefix' && (!config.ENABLE_PREFIX_COMMANDS || !mc))
      notes.push('Needs ENABLE_PREFIX_COMMANDS=true and Message Content (ENABLE_MESSAGE_CONTENT).');
    if (pageId === 'music' && !config.ENABLE_MUSIC)
      notes.push(
        '/jam works now; the /music player also needs ENABLE_MUSIC=true and the music image.',
      );
    return notes;
  }

  async function renderFeature(
    ctx: Ctx,
    pageId: string,
    notice?: string,
    errors?: string[],
  ): Promise<string> {
    const page = getPage(pageId)!;
    const gc = await getOrCreateGuildConfig(ctx.guild.id);
    const moduleOn = page.moduleId ? isModuleOn(gc, page.moduleId) : undefined;
    return featurePage(
      shellFor(ctx),
      page,
      await currentValues(ctx.guild.id, pageId),
      formOptions(ctx.guild),
      moduleOn,
      hostNotes(pageId),
      notice,
      errors,
    );
  }

  app.get('/f/:id', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const id = req.params.id as string;
    if (!getPage(id)) {
      fail(res, 404, 'Not found', "There's no settings page with that name.");
      return;
    }
    res.type('html').send(await renderFeature(ctx, id, req.query.saved ? 'Saved.' : undefined));
  });

  app.post('/f/:id', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const page = getPage(req.params.id as string);
    if (!page) {
      fail(res, 404, 'Not found', "There's no settings page with that name.");
      return;
    }
    const body = req.body as Body;
    const vctx: ValidationContext = {
      textChannelIds: new Set(textChannels(ctx.guild).map((c) => c.id)),
      voiceChannelIds: new Set(voiceChannels(ctx.guild).map((c) => c.id)),
      roleIds: new Set(pickableRoles(ctx.guild).map((r) => r.id)),
    };
    const before = await currentValues(ctx.guild.id, page.id);
    const data: Record<string, unknown> = {};
    const perms: { scope: 'moderation' | 'admin'; ids: string[] }[] = [];
    const errors: string[] = [];

    for (const f of page.fields) {
      const r = parseField(f, body[f.key], vctx);
      if (!r.ok) {
        errors.push(r.error);
        continue;
      }
      if (f.kind === 'permroles') {
        perms.push({ scope: f.scope, ids: r.value as string[] });
        continue;
      }
      // Roles the bot hands out must be below both the bot's and the
      // editor's highest role, as in /setup. Unchanged picks aren't re-checked.
      if ((f.kind === 'role' || f.kind === 'roles') && f.assignable) {
        const old = new Set(f.kind === 'role' ? [before[f.key]] : (before[f.key] as string[]));
        const picked =
          f.kind === 'role'
            ? r.value
              ? [r.value as string]
              : []
            : (JSON.parse(r.value as string) as string[]);
        for (const roleId of picked.filter((x) => !old.has(x))) {
          const role = ctx.guild.roles.cache.get(roleId)!;
          const check = await checkRoleAssignable(ctx.guild, ctx.member, role);
          if (!check.allowed) errors.push(`${f.label}: @${role.name}: ${check.reason}`);
        }
      }
      data[f.key] = r.value;
    }

    if (errors.length) {
      res
        .status(400)
        .type('html')
        .send(await renderFeature(ctx, page.id, undefined, errors));
      return;
    }
    if (
      typeof data.xpMinPerMsg === 'number' &&
      typeof data.xpMaxPerMsg === 'number' &&
      data.xpMaxPerMsg < data.xpMinPerMsg
    ) {
      [data.xpMinPerMsg, data.xpMaxPerMsg] = [data.xpMaxPerMsg, data.xpMinPerMsg];
    }
    await getOrCreateGuildConfig(ctx.guild.id);
    if (Object.keys(data).length)
      await prisma.guildConfig.update({ where: { id: ctx.guild.id }, data });
    for (const p of perms) await setPermissionRoles(ctx.guild.id, p.scope, p.ids);
    logger.info(`Dashboard: ${ctx.member.user.tag} saved ${page.id} settings in ${ctx.guild.id}`);
    void note(ctx, `Saved the **${page.title}** settings.`);
    if (page.id === 'automod' || page.id === 'permissions') {
      const err = await syncNativeAutomod(ctx.guild, page.id === 'automod').catch(
        (e: Error) => e.message,
      );
      if (err) {
        res
          .type('html')
          .send(
            await renderFeature(ctx, page.id, undefined, [
              `Saved, but: ${err.replace(/\*\*/g, '')}`,
            ]),
          );
        return;
      }
    }
    res.redirect(303, `/f/${page.id}?saved=1`);
  });

  const apiStatuses = (): ApiStatus[] => [
    {
      name: 'Twitch',
      configured: Boolean(config.TWITCH_CLIENT_ID && config.TWITCH_CLIENT_SECRET),
      powers: 'Live alerts for Twitch streamers (/streamwatch).',
      env: 'TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET',
      getKey: 'Free at dev.twitch.tv/console/apps.',
    },
    {
      name: 'YouTube',
      configured: Boolean(config.YOUTUBE_API_KEY),
      powers:
        'Live alerts for YouTube channels (/streamwatch). New uploads work without a key: add the channel as an RSS add-on.',
      env: 'YOUTUBE_API_KEY',
      getKey: 'Free at console.cloud.google.com (YouTube Data API v3).',
    },
    {
      name: 'Steam',
      configured: Boolean(config.STEAM_API_KEY),
      powers: 'Player profiles and stats (/gamestats steam). Steam game news works without a key.',
      env: 'STEAM_API_KEY',
      getKey: 'Free at steamcommunity.com/dev/apikey.',
    },
    {
      name: 'Riot Games',
      configured: Boolean(config.RIOT_API_KEY),
      powers: 'League of Legends lookups (/gamestats lol).',
      env: 'RIOT_API_KEY',
      getKey: 'At developer.riotgames.com.',
    },
  ];

  async function renderAddons(
    ctx: Ctx,
    extra: {
      notice?: string;
      error?: string;
      newHook?: { id: number; name: string; url: string };
    } = {},
  ): Promise<string> {
    const gc = await getOrCreateGuildConfig(ctx.guild.id);
    const rows = await prisma.addon.findMany({
      where: { guildId: ctx.guild.id },
      orderBy: { id: 'asc' },
    });
    return addonsPage(
      shellFor(ctx),
      rows.map((a) => ({
        ...a,
        channelName: ctx.guild.channels.cache.get(a.channelId)?.name ?? 'deleted-channel',
      })),
      textChannels(ctx.guild).map((c) => ({ id: c.id, name: c.name })),
      pickableRoles(ctx.guild).map((r) => ({ id: r.id, name: r.name })),
      apiStatuses(),
      { moduleOn: isModuleOn(gc, 'addons'), ...extra },
    );
  }

  app.get('/addons', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const notice =
      typeof req.query.done === 'string'
        ? (
            { removed: 'Removed.', paused: 'Paused.', resumed: 'Resumed.' } as Record<
              string,
              string
            >
          )[req.query.done]
        : undefined;
    res.type('html').send(await renderAddons(ctx, { notice }));
  });

  app.post('/addons', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const body = req.body as Body;
    const one = (k: string) => {
      const v = body[k];
      return (Array.isArray(v) ? v[v.length - 1] : v)?.trim() ?? '';
    };
    const kind = one('kind');
    const channelId = one('channelId');
    const roleId = one('mentionRoleId');
    let error: string | undefined;
    if (!ADDON_KINDS.some((k) => k.kind === kind)) error = 'Pick a type.';
    else if (!textChannels(ctx.guild).some((c) => c.id === channelId))
      error = "That channel isn't on this server.";
    else if (roleId && !pickableRoles(ctx.guild).some((r) => r.id === roleId))
      error = "That role isn't on this server.";
    else if (ADDON_KINDS.find((k) => k.kind === kind)?.target && !one('target'))
      error = `This type needs a target: ${ADDON_KINDS.find((k) => k.kind === kind)?.target}.`;
    if (error) {
      res
        .status(400)
        .type('html')
        .send(await renderAddons(ctx, { error }));
      return;
    }
    const created = await createAddon({
      guildId: ctx.guild.id,
      kind,
      name: one('name'),
      channelId,
      target: one('target'),
      mentionRoleId: roleId || null,
      createdBy: ctx.member.id,
    });
    if (!created.ok) {
      res
        .status(400)
        .type('html')
        .send(await renderAddons(ctx, { error: created.error }));
      return;
    }
    logger.info(
      `Dashboard: ${ctx.member.user.tag} added add-on #${created.addon.id} (${kind}) in ${ctx.guild.id}`,
    );
    void note(ctx, `Added add-on **#${created.addon.id} ${created.addon.name}** (${kind}).`);
    if (created.secret) {
      // Shown once, on this response only; it isn't stored, so it can't be shown again.
      res.type('html').send(
        await renderAddons(ctx, {
          newHook: {
            id: created.addon.id,
            name: created.addon.name,
            url: `${dashboardUrl()}/hooks/${created.addon.id}/${created.secret}`,
          },
        }),
      );
      return;
    }
    const check = await checkAddonNow(client, created.addon);
    res.type('html').send(
      await renderAddons(
        ctx,
        check.ok
          ? { notice: `Added "${created.addon.name}": ${check.message}.` }
          : {
              error: `Added "${created.addon.name}", but the first check failed: ${check.message}`,
            },
      ),
    );
  });

  app.post('/addons/:id/:action', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const addon = await prisma.addon.findFirst({
      where: { id: Number(req.params.id) || -1, guildId: ctx.guild.id },
    });
    const action = String(req.params.action);
    if (!addon || !['test', 'toggle', 'delete'].includes(action)) {
      fail(res, 404, 'Not found', "There's no such add-on on this server.");
      return;
    }
    if (action === 'delete') {
      await prisma.addon.delete({ where: { id: addon.id } });
      logger.info(
        `Dashboard: ${ctx.member.user.tag} removed add-on #${addon.id} in ${ctx.guild.id}`,
      );
      void note(ctx, `Removed add-on **#${addon.id} ${addon.name}**.`);
      res.redirect(303, '/addons?done=removed');
      return;
    }
    if (action === 'toggle') {
      await prisma.addon.update({ where: { id: addon.id }, data: { enabled: !addon.enabled } });
      void note(
        ctx,
        `${addon.enabled ? 'Paused' : 'Resumed'} add-on **#${addon.id} ${addon.name}**.`,
      );
      res.redirect(303, `/addons?done=${addon.enabled ? 'paused' : 'resumed'}`);
      return;
    }
    const check = await checkAddonNow(client, addon);
    res
      .type('html')
      .send(
        await renderAddons(
          ctx,
          check.ok
            ? { notice: `"${addon.name}": ${check.message}.` }
            : { error: `"${addon.name}": ${check.message}` },
        ),
      );
  });

  app.get('/cases/export.:format', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const format =
      req.params.format === 'json' ? 'json' : req.params.format === 'csv' ? 'csv' : null;
    if (!format) {
      fail(res, 404, 'Not found', 'Exports are .csv or .json.');
      return;
    }
    const cases = await prisma.case.findMany({
      where: { guildId: ctx.guild.id },
      orderBy: { caseNumber: 'asc' },
    });
    res
      .status(200)
      .type(format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8')
      .set(
        'Content-Disposition',
        `attachment; filename="${exportFileName(ctx.guild.name, format)}"`,
      )
      .send(format === 'csv' ? casesToCsv(cases) : casesToJson(ctx.guild.id, cases));
  });

  async function renderLists(
    ctx: Ctx,
    opts: { notice?: string; error?: string } = {},
  ): Promise<string> {
    const gid = ctx.guild.id;
    const [responders, tags, rewards, announcements] = await Promise.all([
      prisma.autoResponder.findMany({ where: { guildId: gid }, orderBy: { trigger: 'asc' } }),
      prisma.tag.findMany({ where: { guildId: gid }, orderBy: { name: 'asc' } }),
      prisma.levelRoleReward.findMany({ where: { guildId: gid }, orderBy: { level: 'asc' } }),
      prisma.scheduledMessage.findMany({ where: { guildId: gid }, orderBy: { nextRunAt: 'asc' } }),
    ]);
    const data: ListsData = {
      responders,
      tags,
      rewards: rewards.map((r) => ({
        id: r.id,
        level: r.level,
        roleName: ctx.guild.roles.cache.get(r.roleId)?.name ?? 'deleted-role',
      })),
      announcements: announcements.map((a) => ({
        ...a,
        channelName: ctx.guild.channels.cache.get(a.channelId)?.name ?? 'deleted-channel',
      })),
    };
    return listsPage(
      shellFor(ctx),
      data,
      pickableRoles(ctx.guild).map((r) => ({ id: r.id, name: r.name })),
      opts,
    );
  }

  const field = (req: Request, k: string): string => {
    const v = (req.body as Body)[k];
    return (Array.isArray(v) ? v[v.length - 1] : v)?.trim() ?? '';
  };

  app.get('/lists', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    res
      .type('html')
      .send(await renderLists(ctx, { notice: req.query.done === '1' ? 'Saved.' : undefined }));
  });

  app.post('/lists/:list', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const gid = ctx.guild.id;
    const bad = async (error: string) => {
      res
        .status(400)
        .type('html')
        .send(await renderLists(ctx, { error }));
    };
    await getOrCreateGuildConfig(gid);
    switch (req.params.list) {
      case 'responders': {
        const trigger = field(req, 'trigger').toLowerCase();
        const response = field(req, 'response');
        const matchType = ['contains', 'exact', 'starts'].includes(field(req, 'matchType'))
          ? field(req, 'matchType')
          : 'contains';
        if (trigger.length < 2 || trigger.length > 100)
          return bad('The trigger must be 2–100 characters.');
        if (!response || response.length > 1500) return bad('The reply must be 1–1500 characters.');
        const exists = await prisma.autoResponder.findUnique({
          where: { guildId_trigger: { guildId: gid, trigger } },
        });
        if (
          !exists &&
          (await prisma.autoResponder.count({ where: { guildId: gid } })) >= MAX_RESPONDERS
        )
          return bad(`You've hit the limit of ${MAX_RESPONDERS} auto-responses. Remove one first.`);
        await prisma.autoResponder.upsert({
          where: { guildId_trigger: { guildId: gid, trigger } },
          create: { guildId: gid, trigger, response, matchType, createdBy: ctx.member.id },
          update: { response, matchType },
        });
        invalidateResponders(gid);
        void note(ctx, `${exists ? 'Updated' : 'Added'} the auto-response for **${trigger}**.`);
        break;
      }
      case 'tags': {
        const name = field(req, 'name').toLowerCase();
        const content = field(req, 'content');
        if (!/^\S{1,32}$/.test(name)) return bad('Tag names are 1–32 characters with no spaces.');
        if (!content || content.length > 2000) return bad('Tag content must be 1–2000 characters.');
        await prisma.tag.upsert({
          where: { guildId_name: { guildId: gid, name } },
          create: { guildId: gid, name, content, createdBy: ctx.member.id },
          update: { content },
        });
        void note(ctx, `Saved the tag **${name}**.`);
        break;
      }
      case 'rewards': {
        const level = Number(field(req, 'level'));
        const role = ctx.guild.roles.cache.get(field(req, 'roleId'));
        if (!Number.isInteger(level) || level < 1 || level > 1000)
          return bad('The level must be a whole number from 1 to 1000.');
        if (!role || !pickableRoles(ctx.guild).some((r) => r.id === role.id))
          return bad("That role isn't on this server.");
        const ok = await checkRoleAssignable(ctx.guild, ctx.member, role);
        if (!ok.allowed) return bad(`@${role.name}: ${ok.reason}`);
        await prisma.levelRoleReward.upsert({
          where: { guildId_level: { guildId: gid, level } },
          create: { guildId: gid, level, roleId: role.id },
          update: { roleId: role.id },
        });
        void note(ctx, `Level ${level} now gives **@${role.name}**.`);
        break;
      }
      default:
        fail(res, 404, 'Not found', "There's no such list.");
        return;
    }
    res.redirect(303, '/lists?done=1');
  });

  app.post('/lists/:list/:id/delete', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const where = { id: Number(req.params.id) || -1, guildId: ctx.guild.id };
    let count = 0;
    switch (req.params.list) {
      case 'responders':
        count = (await prisma.autoResponder.deleteMany({ where })).count;
        invalidateResponders(ctx.guild.id);
        break;
      case 'tags':
        count = (await prisma.tag.deleteMany({ where })).count;
        break;
      case 'rewards':
        count = (await prisma.levelRoleReward.deleteMany({ where })).count;
        break;
      case 'announcements':
        count = (await prisma.scheduledMessage.deleteMany({ where })).count;
        break;
    }
    if (!count) {
      fail(res, 404, 'Not found', "That item isn't on this server (maybe it was already removed).");
      return;
    }
    void note(ctx, `Removed an item from **${req.params.list}** (id ${where.id}).`);
    res.redirect(303, '/lists?done=1');
  });

  app.get('/cases', async (req, res) => {
    const ctx = res.locals.ctx as Ctx;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const cases = await prisma.case.findMany({
      where: {
        guildId: ctx.guild.id,
        ...(q ? { OR: [{ targetId: q }, { targetTag: { contains: q } }] } : {}),
      },
      orderBy: { caseNumber: 'desc' },
      take: 100,
    });
    res.type('html').send(casesPage(shellFor(ctx), cases, q));
  });

  app.use((_req, res) => {
    fail(res, 404, 'Not found', "That page doesn't exist.");
  });

  app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') {
      fail(res, 413, 'Too much', 'That form was too large.');
      return;
    }
    logger.error(`Dashboard error: ${err.stack ?? err}`);
    fail(
      res,
      500,
      'Something went wrong',
      'The bot hit an error; the details are in its log. Nothing was changed.',
    );
  });

  return app;
}

let server: http.Server | null = null;
let sweeper: NodeJS.Timeout | null = null;

export function startDashboard(client: Client): void {
  if (!config.ENABLE_DASHBOARD || server) return;
  server = http.createServer(createApp(client));
  server.on('error', (err: NodeJS.ErrnoException) => {
    // The bot keeps running without its dashboard rather than crashing.
    logger.error(
      `The dashboard couldn't start: ${err.message}`,
      err.code === 'EADDRINUSE'
        ? `Something else is using port ${config.DASHBOARD_PORT}. Set DASHBOARD_PORT in .env to a free one, then restart.`
        : 'Check DASHBOARD_HOST and DASHBOARD_PORT in .env, then restart.',
    );
    server = null;
  });
  server.listen(config.DASHBOARD_PORT, config.DASHBOARD_HOST, () => {
    logger.info(
      `Dashboard listening on ${config.DASHBOARD_HOST}:${config.DASHBOARD_PORT}. Admins open it with /dashboard (links go to ${dashboardUrl()}).`,
    );
  });
  sweeper = setInterval(() => sweep(), 10 * 60_000);
  sweeper.unref();
}

export async function stopDashboard(): Promise<void> {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
  const s = server;
  server = null;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
}
