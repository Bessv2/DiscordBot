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
          new Set(PAGES.map((p) => p.id)),
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
    res.redirect(303, `/f/${page.id}?saved=1`);
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
