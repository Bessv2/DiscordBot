// End-to-end feature check: the real bot code (built into dist/) and a real
// SQLite database, with only discord.js's network layer replaced by a fake
// Discord that records every API call. Drives every command, /setup screen,
// button and background job the way Discord would.
//
// Usage: npm run build && npm run test:e2e   (add -- --music for the music path)
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..', '..');
const HERE = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-e2e-'));
const MUSIC = process.argv.includes('--music');

// ── fresh database ────────────────────────────────────────────────────────
const dbFile = path.join(HERE, `e2e${MUSIC ? '-music' : ''}.db`);
for (const f of [dbFile, `${dbFile}-journal`]) fs.rmSync(f, { force: true });
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.CHECKPOINT_DISABLE = '1';
execSync('npx prisma migrate deploy', { cwd: ROOT, env: process.env, stdio: 'ignore' });
process.env.DISCORD_TOKEN = 'fake.token.value';
process.env.DISCORD_CLIENT_ID = '';
process.env.ENABLE_MESSAGE_CONTENT = 'true';
process.env.ENABLE_GUILD_MEMBERS = 'true';
process.env.ENABLE_PRESENCE = 'false';
process.env.ENABLE_PREFIX_COMMANDS = 'true';
process.env.ENABLE_MUSIC = MUSIC ? 'true' : 'false';
process.env.ENABLE_DASHBOARD = 'true';
process.env.LOG_LEVEL = 'info';
// The command-sync hash lives in data/; point it away from the real one.
const realHash = path.join(ROOT, 'data', '.commands-hash');
const hashBackup = fs.existsSync(realHash) ? fs.readFileSync(realHash) : null;
fs.rmSync(realHash, { force: true });

// ── capture the bot's log ─────────────────────────────────────────────────
const logBuf = [];
const origErr = console.error.bind(console);
const origLog = console.log.bind(console);
console.error = (...a) => logBuf.push(a.join(' '));
console.log = (...a) => logBuf.push(a.join(' '));
const out = (...a) => origLog(...a);

const { FakeDiscord, IDS, USERS, memberRaw, computeMemberPerms, snow, roles } = require('./fakeDiscord.cjs');
const djs = require(`${ROOT}/node_modules/discord.js`);
const { client } = require(`${ROOT}/dist/discord/client`);
const { loadCommands } = require(`${ROOT}/dist/discord/commandHandler`);
const { loadEvents } = require(`${ROOT}/dist/discord/eventHandler`);
const { prisma } = require(`${ROOT}/dist/lib/db`);
const { syncCommandsIfChanged } = require(`${ROOT}/dist/discord/commandSync`);
const { ready } = require(`${ROOT}/dist/events/ready`);
const { guildMemberAdd } = require(`${ROOT}/dist/events/guildMemberAdd`);
const { checkDueReminders } = require(`${ROOT}/dist/reminders/scheduler`);
const { checkExpiredMutes } = require(`${ROOT}/dist/lib/muteActions`);
const { checkBirthdays } = require(`${ROOT}/dist/birthdays/jobs`);
const { checkStreamNotifications } = require(`${ROOT}/dist/streaming/jobs`);
const { setModuleOn } = require(`${ROOT}/dist/lib/modules`);
const { checkMusicTools } = require(`${ROOT}/dist/music/check`);

const fake = new FakeDiscord();
fake.install(client);
loadCommands(client);
loadEvents(client);

// ── results ───────────────────────────────────────────────────────────────
const results = [];
let section = '';
function check(name, ok, detail = '') {
  results.push({ section, name, ok: Boolean(ok), detail });
  out(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n         ↳ ${detail}` : ''}`);
}
function heading(t) {
  section = t;
  out(`\n■ ${t}`);
}
function takeLog() {
  const lines = logBuf.splice(0);
  return lines;
}
const badLog = (lines) => lines.filter((l) => /\[ERROR\]|threw|TypeError|ReferenceError|Unhandled/.test(l));

// ── interaction builders ──────────────────────────────────────────────────
const invokerOf = new Map();
fake.metaFor = (iid) => ({ id: iid, type: 2, user: USERS[invokerOf.get(iid) ?? IDS.admin], authorizing_integration_owners: {} });
const APP_PERMS = roles.find((r) => r.id === IDS.rBot).permissions;

const opt = {
  str: (name, value) => ({ type: 3, name, value }),
  int: (name, value) => ({ type: 4, name, value }),
  bool: (name, value) => ({ type: 5, name, value }),
  user: (name, id) => ({ type: 6, name, value: id, _resolve: { users: { [id]: USERS[id] }, members: { [id]: (({ user, ...m }) => ({ ...m, permissions: computeMemberPerms(id) }))(memberRaw(id)) } } }),
  chan: (name, id, type = 0) => ({ type: 7, name, value: id, _resolve: { channels: { [id]: { id, type, name: fake.guild.channels.cache.get(id)?.name ?? 'x', permissions: APP_PERMS } } } }),
  role: (name, id) => ({ type: 8, name, value: id, _resolve: { roles: { [id]: roles.find((r) => r.id === id) } } }),
  file: (name, url, body) => {
    const id = snow();
    fake.attachments.set(url, body);
    return { type: 11, name, value: id, _resolve: { attachments: { [id]: { id, filename: 'q.json', size: Buffer.byteLength(body), url, proxy_url: url, content_type: 'application/json' } } } };
  },
};

function mergeResolved(options) {
  const resolved = {};
  for (const o of options) for (const [k, v] of Object.entries(o._resolve ?? {})) resolved[k] = { ...(resolved[k] ?? {}), ...v };
  return { clean: options.map(({ _resolve, ...o }) => o), resolved };
}

function baseRaw(type, userId, channelId, extra = {}) {
  const id = snow();
  invokerOf.set(id, userId);
  const ch = fake.guild.channels.cache.get(channelId);
  return {
    id,
    token: `tok-${id}`,
    type,
    application_id: IDS.bot,
    guild_id: IDS.guild,
    channel_id: channelId,
    channel: { id: channelId, type: ch?.type ?? 0, name: ch?.name ?? 'general', guild_id: IDS.guild, permissions: APP_PERMS },
    member: { ...memberRaw(userId), permissions: computeMemberPerms(userId) },
    app_permissions: APP_PERMS,
    locale: 'en-US',
    guild_locale: 'en-US',
    version: 1,
    entitlements: [],
    authorizing_integration_owners: { 0: IDS.guild },
    context: 0,
    ...extra,
  };
}

async function dispatch(raw) {
  const mark = fake.calls.length;
  client.actions.InteractionCreate.handle(raw);
  await fake.settle();
  const calls = fake.callsSince(mark);
  const replies = calls.filter((c) => ['callback', 'editReply', 'followUp'].includes(c.kind));
  const text = replies.map((c) => describe(c.body?.data ?? c.body)).join(' | ');
  return { raw, calls, replies, text, log: takeLog(), original: fake.originals?.get(raw.token) };
}

function describe(d) {
  if (!d) return '(ack)';
  const parts = [];
  if (d.content) parts.push(d.content);
  for (const e of d.embeds ?? []) parts.push(`[embed ${e.title ?? ''} ${e.description ?? ''} ${(e.fields ?? []).map((f) => `${f.name}: ${f.value}`).join('; ')}]`);
  if (d.poll) parts.push(`[poll ${d.poll.question?.text} ${(d.poll.answers ?? []).map((a) => a.poll_media?.text ?? a.text).join('/')}]`);
  if (d.components?.length) parts.push(`[${d.components.length} row(s)]`);
  if (d.custom_id && d.title) parts.push(`[modal ${d.title}]`);
  return parts.join(' ') || '(empty)';
}

function cmd(name, { sub, options = [], user = IDS.admin, channel = IDS.general } = {}) {
  const { clean, resolved } = mergeResolved(options);
  const raw = baseRaw(2, user, channel, {
    data: { id: snow(), name, type: 1, options: sub ? [{ type: 1, name: sub, options: clean }] : clean, resolved, guild_id: IDS.guild },
  });
  return dispatch(raw);
}

/** A click on a message the bot sent. componentType: 2 button, 3 string select, 6 role select, 8 channel select. */
function click(message, customId, { user = IDS.admin, componentType = 2, values, resolved, dm = false } = {}) {
  const raw = baseRaw(3, user, message.channel_id, {
    message,
    data: { custom_id: customId, component_type: componentType, ...(values ? { values } : {}), ...(resolved ? { resolved } : {}) },
  });
  if (dm) dmify(raw, user);
  return dispatch(raw);
}

function submitModal(customId, fields, { user = IDS.admin, message, dm = false } = {}) {
  const raw = baseRaw(5, user, message?.channel_id ?? IDS.general, {
    ...(message ? { message } : {}),
    data: { custom_id: customId, components: Object.entries(fields).map(([id, value]) => ({ type: 1, components: [{ type: 4, custom_id: id, value }] })) },
  });
  if (dm) dmify(raw, user);
  return dispatch(raw);
}

function dmify(raw, user) {
  delete raw.guild_id;
  delete raw.member;
  raw.user = USERS[user];
  raw.channel_id = `77${user.slice(2)}`;
  raw.channel = { id: raw.channel_id, type: 1, recipients: [USERS[user]] };
  raw.context = 1;
  raw.authorizing_integration_owners = { 0: IDS.guild };
}

const sent = (r, channelId) => r.calls.filter((c) => c.kind === 'send' && (!channelId || c.channelId === channelId));
const has = (r, kind) => r.calls.some((c) => c.kind === kind);
const noErrors = (r) => badLog(r.log).length === 0;
const errText = (r) => badLog(r.log).join(' / ').slice(0, 400);
const gc = () => prisma.guildConfig.findUnique({ where: { id: IDS.guild } });
const flattenComponents = (m) => (m?.components ?? []).flatMap((row) => row.components ?? []);

// Message events
function userMessage(userId, content, channelId = IDS.general) {
  const id = snow();
  const raw = {
    id, channel_id: channelId, guild_id: IDS.guild, author: USERS[userId], member: memberRaw(userId), content,
    embeds: [], attachments: [], mentions: [], mention_roles: [], mention_everyone: false, pinned: false, tts: false, type: 0, flags: 0,
    timestamp: new Date().toISOString(), edited_timestamp: null, components: [],
  };
  fake.messages.set(id, raw);
  return raw;
}
async function emitMessage(raw) {
  const mark = fake.calls.length;
  client.actions.MessageCreate.handle(raw);
  await fake.settle();
  return { calls: fake.callsSince(mark), log: takeLog() };
}

// ════════════════════════════════════════════════════════════════════════
(async () => {
  heading('Startup');
  {
    checkMusicTools();
    const mark = fake.calls.length;
    ready(client);
    await fake.settle(400);
    const log = takeLog();
    const set = fake.callsSince(mark).find((c) => c.kind === 'commandsSet');
    check('ready logs an invite link with bot + applications.commands scopes', log.some((l) => /oauth2\/authorize\?client_id=.*scope=bot\+applications\.commands/.test(l)), log.join(' | '));
    const { commands: ALL_COMMANDS } = require(`${ROOT}/dist/commands`);
    check(`registers all slash commands on first start (${set?.body?.length})`, set && set.body.length === ALL_COMMANDS.length, set ? `${set.body.length} of ${ALL_COMMANDS.length}` : 'no PUT /commands');
    const again = fake.calls.length;
    await syncCommandsIfChanged(client);
    await fake.settle();
    check('skips re-registering when nothing changed', !fake.callsSince(again).some((c) => c.kind === 'commandsSet'));
    check('no errors at startup', badLog(log).length === 0, badLog(log).join(' / '));
    if (MUSIC) check('music tools check runs and reports', log.some((l) => /Music is on|not installed/.test(l)), log.filter((l) => /usic/.test(l)).join(' | '));
  }

  heading('Permission gate & module switch');
  {
    let r = await cmd('kick', { user: IDS.user, options: [opt.user('user', IDS.target)] });
    check('regular member cannot /kick', /permission/i.test(r.text) && !has(r, 'kick'), r.text);
    r = await cmd('roll', { user: IDS.user, options: [opt.str('notation', '2d6+1')] });
    check('/roll works for everyone', /\d/.test(r.text) && noErrors(r), r.text + errText(r));
    await setModuleOn(IDS.guild, 'fun', false);
    r = await cmd('roll', { user: IDS.user, options: [opt.str('notation', '1d20')] });
    check('switching "Dice & fun" off blocks /roll with a clear message', /turned off/i.test(r.text) && /\/setup/.test(r.text), r.text);
    r = await cmd('roll', { user: IDS.admin, options: [opt.str('notation', '1d20')] });
    check('...for admins too', /turned off/i.test(r.text), r.text);
    r = await cmd('warn', { user: IDS.mod, options: [opt.user('user', IDS.target), opt.str('reason', 'gate test')] });
    check('core moderation is never blocked by module switches', !/turned off/i.test(r.text), r.text);
    await setModuleOn(IDS.guild, 'fun', true);
    r = await cmd('8ball', { user: IDS.user, options: [opt.str('question', 'will it work?')] });
    check('switching it back on restores /8ball', !/turned off/i.test(r.text) && r.replies.length > 0, r.text);
    await prisma.case.deleteMany({});
  }

  heading('/setup feature map');
  let setupMsg;
  {
    let r = await cmd('setup', { user: IDS.admin });
    setupMsg = r.original;
    const d = r.replies[0]?.body?.data;
    const fields = d?.embeds?.[0]?.fields ?? [];
    const menus = flattenComponents(setupMsg).filter((c) => c.custom_id?.startsWith('setup:nav:open'));
    const optionCount = menus.reduce((n, m) => n + m.options.length, 0);
    check('opens on the feature map (ephemeral)', /feature map/i.test(d?.embeds?.[0]?.title ?? '') && (d?.flags & 64) === 64, describe(d));
    const names = fields.map((f) => f.name).join(', ');
    check('map has Moderation / Community / Games sections', /Moderation/.test(names) && /Community/.test(names) && /Games/.test(names), names);
    const { MODULES: ALL_MODULES } = require(`${ROOT}/dist/lib/modules`);
    check(`3 group menus list every feature (${optionCount})`, menus.length === 3 && optionCount === ALL_MODULES.length + 3 && menus.every((m) => m.options.length <= 25), `${menus.length} menus, ${optionCount} options`);
    check('every feature line is shown on the map (none cut off)', fields.map((f) => f.value).join('\n').split('\n').length === ALL_MODULES.length + 3, `${fields.length} fields`);
    check('first run shows the welcome + Skip for now', /Welcome!/.test(d?.embeds?.[0]?.description ?? '') && flattenComponents(setupMsg).some((c) => /Skip for now/.test(c.label ?? '')));
    check('map flags the missing mod-log channel', /⚠️ 📋 \*\*Mod-log channel\*\*/.test(fields[0].value), fields[0].value.slice(0, 200));

    r = await click(setupMsg, 'setup:nav:open', { user: IDS.user, componentType: 3, values: ['modlog'] });
    check('someone else clicking gets told it is not theirs', /Only the person who ran/.test(r.text), r.text);

    // Quick start: modlog → automod → permissions
    r = await click(setupMsg, 'setup:nav:quick');
    check('Quick start opens step 1: mod-log', /Mod-log channel/.test(r.text) && /step 1 of 3/.test(JSON.stringify(r.replies[0]?.body)), r.text.slice(0, 200));
    r = await click(setupMsg, 'setup:modlog:channel', { componentType: 8, values: [IDS.modlog], resolved: { channels: { [IDS.modlog]: { id: IDS.modlog, type: 0, name: 'mod-log', permissions: APP_PERMS } } } });
    check('picking a channel saves it', (await gc()).modLogChannelId === IDS.modlog && /Mod-log set/.test(r.text), r.text.slice(0, 200));
    r = await click(setupMsg, 'setup:nav:next');
    check('Next goes to step 2: auto-mod', /Auto-mod/.test(r.text) && /step 2 of 3/.test(JSON.stringify(r.replies[0]?.body)), r.text.slice(0, 120));
    r = await click(setupMsg, 'setup:automod:toggle');
    check('auto-mod on/off button works', (await gc()).automodEnabled === true, r.text.slice(0, 120));
    // Form: the button opens a modal; then submit it
    const limitsClick = baseRaw(3, IDS.admin, setupMsg.channel_id, { message: setupMsg, data: { custom_id: 'setup:automod:limits', component_type: 2 } });
    const pClick = dispatch(limitsClick);
    const opened = await pClick;
    check('"Change limits…" opens a form', opened.replies.some((c) => c.body?.type === 9), opened.text);
    r = await submitModal(`setup_form:${limitsClick.id}`, { spam: '7', seconds: '4', mentions: '999' }, { message: setupMsg });
    const g1 = await gc();
    check('form saves valid numbers and keeps the old value for out-of-range ones', g1.spamMessageLimit === 7 && g1.spamIntervalMs === 4000 && g1.mentionSpamLimit === 5 && /Kept the old value/.test(r.text), `${g1.spamMessageLimit}/${g1.spamIntervalMs}/${g1.mentionSpamLimit} ${r.text.slice(0, 160)}`);
    r = await click(setupMsg, 'setup:nav:next');
    check('Next goes to step 3: permissions', /Who can moderate/.test(r.text), r.text.slice(0, 120));
    r = await click(setupMsg, 'setup:permissions:mod', { componentType: 6, values: [IDS.rMod], resolved: { roles: { [IDS.rMod]: roles.find((x) => x.id === IDS.rMod) } } });
    const pr = await prisma.permissionRole.findMany({ where: { guildId: IDS.guild } });
    check('picking moderation roles saves them', pr.length === 1 && pr[0].roleId === IDS.rMod && pr[0].scope === 'moderation', JSON.stringify(pr));
    r = await click(setupMsg, 'setup:nav:next');
    check('finishing quick start returns to the map with a note', /Essentials done/.test(r.text), r.text.slice(0, 160));

    // Every feature panel opens without errors, and has a Skip button
    const ids = flattenComponents(setupMsg).filter((c) => c.custom_id?.startsWith('setup:nav:open')).flatMap((m) => m.options.map((o) => o.value));
    const broken = [];
    const noSkip = [];
    for (const id of ids) {
      r = await click(setupMsg, 'setup:nav:open', { componentType: 3, values: [id] });
      if (!noErrors(r) || !r.replies.length || /went wrong/.test(r.text)) broken.push(`${id}: ${errText(r) || r.text.slice(0, 80)}`);
      const comps = (r.replies[0]?.body?.data?.components ?? []).flatMap((row) => row.components);
      if (!comps.some((c) => c.custom_id === 'setup:nav:next' && /Skip/.test(c.label))) noSkip.push(id);
      if (comps.length && (r.replies[0].body.data.components.length > 5)) broken.push(`${id}: more than 5 rows`);
      await click(setupMsg, 'setup:nav:map');
    }
    check(`all ${ids.length} feature screens open without errors`, broken.length === 0, broken.join(' || '));
    check('every feature screen has a Skip button', noSkip.length === 0, noSkip.join(', '));

    // Toggle every module from its screen and check the database follows
    const { MODULES, isModuleOn } = require(`${ROOT}/dist/lib/modules`);
    const wrong = [];
    for (const m of MODULES) {
      await click(setupMsg, 'setup:nav:open', { componentType: 3, values: [m.id] });
      const before = isModuleOn(await gc(), m.id);
      await click(setupMsg, `setup:${m.id}:toggle`);
      const after = isModuleOn(await gc(), m.id);
      if (after === before) wrong.push(m.id);
      await click(setupMsg, `setup:${m.id}:toggle`); // back
      if (isModuleOn(await gc(), m.id) !== before) wrong.push(`${m.id} (toggle back)`);
      await click(setupMsg, 'setup:nav:map');
    }
    check(`on/off works for all ${MODULES.length} modules`, wrong.length === 0, wrong.join(', '));

    // Per-feature mapping: XP role reward via role picker + level form
    await click(setupMsg, 'setup:nav:open', { componentType: 3, values: ['xp'] });
    let rc = baseRaw(3, IDS.admin, setupMsg.channel_id, { message: setupMsg, data: { custom_id: 'setup:xp:reward', component_type: 6, values: [IDS.rHigh], resolved: { roles: { [IDS.rHigh]: roles.find((x) => x.id === IDS.rHigh) } } } });
    r = await dispatch(rc);
    check('XP reward refuses a role above the bot', /above my highest role|above or equal/.test(r.text), r.text.slice(0, 200));
    rc = baseRaw(3, IDS.admin, setupMsg.channel_id, { message: setupMsg, data: { custom_id: 'setup:xp:reward', component_type: 6, values: [IDS.rReward], resolved: { roles: { [IDS.rReward]: roles.find((x) => x.id === IDS.rReward) } } } });
    r = await dispatch(rc);
    check('XP reward: picking an allowed role asks for the level', r.replies.some((c) => c.body?.type === 9));
    r = await submitModal(`setup_form:${rc.id}`, { level: '5' }, { message: setupMsg });
    const rewards = await prisma.levelRoleReward.findMany({});
    check('XP reward saved: level 5 → Regular', rewards.length === 1 && rewards[0].level === 5 && rewards[0].roleId === IDS.rReward, JSON.stringify(rewards) + r.text.slice(0, 120));
    await click(setupMsg, 'setup:nav:map');

    // Welcome channel mapping turns welcomes on
    await click(setupMsg, 'setup:nav:open', { componentType: 3, values: ['welcome'] });
    await click(setupMsg, 'setup:welcome:channel', { componentType: 8, values: [IDS.welcome], resolved: { channels: { [IDS.welcome]: { id: IDS.welcome, type: 0, name: 'welcome', permissions: APP_PERMS } } } });
    const gw = await gc();
    check('welcome channel picker saves the channel and turns welcomes on', gw.welcomeChannelId === IDS.welcome && gw.welcomeEnabled);
    await click(setupMsg, 'setup:nav:map');

    // Starboard channel, birthdays role, music DJ, maps form
    await click(setupMsg, 'setup:nav:open', { componentType: 3, values: ['starboard'] });
    await click(setupMsg, 'setup:starboard:channel', { componentType: 8, values: [IDS.stars], resolved: { channels: { [IDS.stars]: { id: IDS.stars, type: 0, name: 'starboard', permissions: APP_PERMS } } } });
    check('starboard channel picker saves', (await gc()).starboardChannelId === IDS.stars);
    await click(setupMsg, 'setup:nav:map');
    await click(setupMsg, 'setup:nav:open', { componentType: 3, values: ['birthdays'] });
    r = await click(setupMsg, 'setup:birthdays:role', { componentType: 6, values: [IDS.rReward], resolved: { roles: { [IDS.rReward]: roles.find((x) => x.id === IDS.rReward) } } });
    check('birthday role picker saves an assignable role', (await gc()).birthdayRoleId === IDS.rReward, r.text.slice(0, 120));
    await click(setupMsg, 'setup:birthdays:channel', { componentType: 8, values: [IDS.general], resolved: { channels: { [IDS.general]: { id: IDS.general, type: 0, name: 'general', permissions: APP_PERMS } } } });
    await click(setupMsg, 'setup:nav:map');
    await click(setupMsg, 'setup:nav:open', { componentType: 3, values: ['music'] });
    await click(setupMsg, 'setup:music:dj', { componentType: 6, values: [IDS.rMod], resolved: { roles: { [IDS.rMod]: roles.find((x) => x.id === IDS.rMod) } } });
    check('music DJ role picker saves', (await gc()).musicDjRoleId === IDS.rMod);
    await click(setupMsg, 'setup:music:nodj');
    check('"No DJ role" clears it', (await gc()).musicDjRoleId === null);
    await click(setupMsg, 'setup:nav:map');
    await click(setupMsg, 'setup:nav:open', { componentType: 3, values: ['maps'] });
    rc = baseRaw(3, IDS.admin, setupMsg.channel_id, { message: setupMsg, data: { custom_id: 'setup:maps:add', component_type: 2 } });
    await dispatch(rc);
    r = await submitModal(`setup_form:${rc.id}`, { game: 'Valorant', maps: 'Ascent, Bind, Haven\nSplit, ascent' }, { message: setupMsg });
    const pool = await prisma.mapPool.findMany({ where: { game: 'valorant' } });
    check('map form adds a deduplicated pool', pool.length === 4, `${pool.length} maps; ${r.text.slice(0, 120)}`);
    await click(setupMsg, 'setup:nav:map');

    r = await click(setupMsg, 'setup:nav:open', { componentType: 3, values: ['modlog'] });
    r = await click(setupMsg, 'setup:nav:next');
    check('Skip on a feature screen returns to the map unchanged', /feature map/i.test(r.text));
    r = await click(setupMsg, 'setup:nav:done');
    check('Done saves and shows a summary', (await gc()).setupCompleted === true && /Setup saved/.test(r.text), r.text.slice(0, 200));
    r = await cmd('setup', { user: IDS.user });
    check('regular members cannot open /setup', /permission/i.test(r.text), r.text);
    takeLog();
  }

  heading('Moderation');
  let warnCaseDm;
  {
    let r = await cmd('warn', { user: IDS.mod, options: [opt.user('user', IDS.target), opt.str('reason', 'spamming memes')] });
    const c1 = await prisma.case.findFirst({ where: { type: 'warn' } });
    check('/warn replies and creates a case', c1 && /warn/i.test(r.text), r.text.slice(0, 160) + errText(r) + JSON.stringify(c1));
    check('/warn posts to the mod-log channel', sent(r, IDS.modlog).length === 1);
    check('/warn DMs the member with an Appeal button', r.calls.some((c) => c.kind === 'send' && c.channelId?.startsWith('77') && JSON.stringify(c.body).includes('appeal_open')));
    warnCaseDm = r.calls.find((c) => c.kind === 'send' && c.channelId?.startsWith('77'));
    r = await cmd('timeout', { user: IDS.mod, options: [opt.user('user', IDS.target), opt.str('duration', '10m'), opt.str('reason', 'cool off')] });
    check('/timeout sets communication_disabled_until', r.calls.some((c) => c.kind === 'timeout' && c.body.communication_disabled_until), r.text + errText(r));
    r = await cmd('timeout', { user: IDS.mod, options: [opt.user('user', IDS.target), opt.str('duration', 'banana')] });
    check('/timeout rejects a bad duration', !has(r, 'timeout') && r.replies.length > 0, r.text);
    r = await cmd('mute', { user: IDS.mod, options: [opt.user('user', IDS.target), opt.str('duration', '1h'), opt.str('reason', 'muted')] });
    const mute = await prisma.mute.findFirst({});
    check('/mute creates the Muted role, adds it, stores expiry', has(r, 'roleCreate') && has(r, 'roleAdd') && mute?.expiresAt, r.text + errText(r));
    r = await cmd('unmute', { user: IDS.mod, options: [opt.user('user', IDS.target)] });
    check('/unmute removes the role', has(r, 'roleRemove'), r.text + errText(r));
    r = await cmd('unmute', { user: IDS.mod, options: [opt.user('user', IDS.mod)] });
    check('cannot unmute yourself', !has(r, 'roleRemove'), r.text);
    r = await cmd('kick', { user: IDS.mod, options: [opt.user('user', IDS.target), opt.str('reason', 'bye')] });
    check('/kick kicks and logs', has(r, 'kick') && sent(r, IDS.modlog).length >= 1, r.text + errText(r));
    r = await cmd('ban', { user: IDS.mod, options: [opt.user('user', IDS.target), opt.str('reason', 'gone'), opt.int('delete_message_days', 1)] });
    check('/ban bans and logs', has(r, 'ban'), r.text + errText(r));
    r = await cmd('kick', { user: IDS.mod, options: [opt.user('user', IDS.owner)] });
    check('cannot kick the server owner', !has(r, 'kick') && /owner/i.test(r.text), r.text);
    r = await cmd('kick', { user: IDS.mod, options: [opt.user('user', IDS.admin)] });
    check('cannot kick someone with a higher role', !has(r, 'kick'), r.text);
    r = await cmd('cases', { user: IDS.mod, options: [opt.user('user', IDS.target)] });
    check('/cases lists the history', /warn/i.test(r.text) && /kick/i.test(r.text) && /ban/i.test(r.text), r.text.slice(0, 300));
    r = await cmd('cases', { user: IDS.mod, options: [opt.user('user', IDS.target), opt.int('case_number', 1)] });
    check('/cases case_number shows one case', /spamming memes/.test(r.text), r.text.slice(0, 200));
    const counts = await prisma.case.groupBy({ by: ['type'], _count: true });
    check('cases recorded for warn/timeout/mute/unmute/kick/ban', counts.length >= 6, JSON.stringify(counts));
  }

  heading('Appeals');
  {
    const c1 = await prisma.case.findFirst({ where: { type: 'warn' } });
    const dmMsg = fake.messages.get([...fake.messages.values()].find((m) => m.channel_id?.startsWith('77') && JSON.stringify(m.components).includes('appeal_open'))?.id);
    const btn = flattenComponents(dmMsg).find((c) => c.custom_id?.startsWith('appeal_open'));
    let r = await click(dmMsg, btn.custom_id, { user: IDS.target, dm: true });
    check('Appeal button in DM opens the appeal form', r.replies.some((c) => c.body?.type === 9), r.text);
    r = await submitModal(`appeal_submit:${c1.id}`, { appeal_message: 'It was a joke, sorry' }, { user: IDS.target, dm: true });
    const ap = await prisma.appeal.findFirst({});
    check('submitting stores the appeal and posts it for staff', ap && sent(r, IDS.modlog).length + sent(r, IDS.appeals).length >= 1, r.text + errText(r));
    const staffMsg = fake.messages.get([...fake.messages.values()].reverse().find((m) => JSON.stringify(m.components ?? []).includes('appeal_accept'))?.id);
    r = await click(staffMsg, `appeal_accept:${ap.id}`, { user: IDS.target });
    check('the appealing member cannot accept their own appeal', (await prisma.appeal.findFirst({})).status === 'pending', r.text);
    r = await click(staffMsg, `appeal_accept:${ap.id}`, { user: IDS.mod });
    check('a moderator can accept it', (await prisma.appeal.findFirst({})).status === 'accepted', r.text + errText(r));
  }

  heading('Utility');
  {
    let r = await cmd('userinfo', { user: IDS.user, options: [opt.user('user', IDS.mod)] });
    check('/userinfo', r.replies.length && noErrors(r), r.text.slice(0, 120) + errText(r));
    r = await cmd('serverinfo', { user: IDS.user });
    check('/serverinfo', /Test Server/.test(r.text) && noErrors(r), r.text.slice(0, 120) + errText(r));
    r = await cmd('remind', { user: IDS.user, options: [opt.str('time', '1m'), opt.str('message', 'stretch')] });
    const rem = await prisma.reminder.findFirst({});
    check('/remind stores a reminder', rem && /stretch/.test(rem.message), r.text);
    await prisma.reminder.updateMany({ data: { remindAt: new Date(Date.now() - 1000) } });
    const mark = fake.calls.length;
    await checkDueReminders(client);
    await fake.settle();
    check('scheduler delivers the reminder', fake.callsSince(mark).some((c) => c.kind === 'send' && /stretch/.test(JSON.stringify(c.body))));
    r = await cmd('poll', { user: IDS.user, options: [opt.str('question', 'Pizza or tacos?'), opt.str('options', 'Pizza, Tacos')] });
    check('/poll posts and adds 2 reactions', r.calls.filter((c) => c.kind === 'react').length === 2 && (await prisma.poll.count()) === 1, r.text + errText(r));
    r = await cmd('poll', { user: IDS.user, options: [opt.str('question', 'x'), opt.str('options', 'only one')] });
    check('/poll rejects a single option', /between 2 and 5/.test(r.text), r.text);
  }

  heading('/config & /lockdown');
  {
    let r = await cmd('config', { sub: 'view' });
    check('/config view', r.replies.length && noErrors(r), errText(r));
    r = await cmd('config', { sub: 'wordfilter', options: [opt.bool('enabled', true), opt.str('words', 'badword, worse')] });
    check('/config wordfilter saves words', JSON.parse((await gc()).bannedWords).includes('badword'), r.text);
    r = await cmd('config', { sub: 'antiraid', options: [opt.bool('enabled', true), opt.int('join_threshold', 3), opt.int('interval_seconds', 60), opt.bool('auto_lockdown', true)] });
    check('/config antiraid', (await gc()).raidJoinThreshold === 3, r.text);
    r = await cmd('config', { sub: 'channel-override', options: [opt.chan('channel', IDS.stars), opt.bool('exempt_spam', true)] });
    check('/config channel-override', (await prisma.channelAutomodOverride.count()) === 1, r.text + errText(r));
    r = await cmd('config', { sub: 'appeal-channel', options: [opt.chan('channel', IDS.appeals)] });
    check('/config appeal-channel', (await gc()).appealChannelId === IDS.appeals, r.text);
    r = await cmd('config', { sub: 'permissions', options: [opt.str('scope', 'admin'), opt.role('role', IDS.rAdmin), opt.str('action', 'add')] });
    check('/config permissions add', (await prisma.permissionRole.count({ where: { scope: 'admin' } })) === 1, r.text);
    r = await cmd('lockdown', { options: [opt.str('state', 'on')] });
    check('/lockdown on raises verification level', has(r, 'guildEdit') && (await gc()).lockdownActive, r.text + errText(r));
    r = await cmd('lockdown', { options: [opt.str('state', 'off')] });
    check('/lockdown off restores it', !(await gc()).lockdownActive, r.text + errText(r));
  }

  heading('Auto-mod & XP (message events)');
  {
    await prisma.guildConfig.update({ where: { id: IDS.guild }, data: { automodEnabled: true, inviteFilterOn: true, wordFilterOn: true, spamMessageLimit: 3, spamIntervalMs: 5000, xpEnabled: true, xpCooldownSec: 0 } });
    let e = await emitMessage(userMessage(IDS.user, 'join my server discord.gg/abc123'));
    check('invite link is deleted and logged', e.calls.some((c) => c.kind === 'delete') && e.calls.some((c) => c.kind === 'send' && c.channelId === IDS.modlog), e.log.join(' | ').slice(0, 300));
    e = await emitMessage(userMessage(IDS.user, 'that is a badword right there'));
    check('banned word is deleted', e.calls.some((c) => c.kind === 'delete'));
    e = await emitMessage(userMessage(IDS.mod, 'mods can say badword when quoting rules'));
    check('moderators are never filtered', !e.calls.some((c) => c.kind === 'delete'));
    for (let i = 0; i < 2; i++) await emitMessage(userMessage(IDS.user2, `hi ${i}`));
    e = await emitMessage(userMessage(IDS.user2, 'hi 3'));
    check('flooding (3 in 5s) is caught', e.calls.some((c) => c.kind === 'delete'), e.log.join(' | ').slice(0, 200));
    e = await emitMessage(userMessage(IDS.user2, 'hi 4', IDS.stars));
    check('per-channel spam exemption is respected', !e.calls.some((c) => c.kind === 'delete'));
    const xp = await prisma.userXp.findFirst({ where: { userId: IDS.user2 } });
    check('normal messages earn XP', xp && xp.xp > 0, JSON.stringify(xp));
    let r = await cmd('rank', { user: IDS.user2 });
    check('/rank', /level|xp/i.test(r.text) && noErrors(r), r.text.slice(0, 120) + errText(r));
    r = await cmd('leaderboard', { user: IDS.user2, options: [opt.str('type', 'xp')] });
    check('/leaderboard xp', r.replies.length && noErrors(r), r.text.slice(0, 120));
    await prisma.guildConfig.update({ where: { id: IDS.guild }, data: { automodEnabled: false } });
    takeLog();
  }

  heading('Community features');
  {
    let r = await cmd('tag', { sub: 'create', user: IDS.user, options: [opt.str('name', 'rules'), opt.str('content', 'Be nice. @everyone read this')] });
    check('/tag create', (await prisma.tag.count()) === 1, r.text);
    r = await cmd('tag', { sub: 'show', user: IDS.user2, options: [opt.str('name', 'rules')] });
    check('/tag show (never pings @everyone)', /Be nice/.test(r.text) && !r.replies.some((c) => (c.body?.data?.allowed_mentions?.parse ?? []).includes('everyone')), r.text);
    r = await cmd('tag', { sub: 'edit', user: IDS.user2, options: [opt.str('name', 'rules'), opt.str('content', 'hacked')] });
    check("cannot edit someone else's tag", !/hacked/.test((await prisma.tag.findFirst({})).content), r.text);
    r = await cmd('tag', { sub: 'list', user: IDS.user });
    check('/tag list', /rules/.test(r.text), r.text);
    r = await cmd('tag', { sub: 'delete', user: IDS.user, options: [opt.str('name', 'rules')] });
    check('/tag delete', (await prisma.tag.count()) === 0, r.text);
    r = await cmd('quote', { sub: 'add', user: IDS.user, options: [opt.str('content', 'It works on my machine'), opt.user('author', IDS.user2)] });
    r = await cmd('quote', { sub: 'random', user: IDS.user });
    check('/quote add + random', /my machine/.test(r.text), r.text);
    const q = await prisma.quote.findFirst({});
    r = await cmd('quote', { sub: 'delete', user: IDS.user2, options: [opt.int('id', q.id)] });
    check('only the adder or a mod can delete a quote', (await prisma.quote.count()) === 1, r.text);
    r = await cmd('quote', { sub: 'list', user: IDS.user });
    check('/quote list', /#\d/.test(r.text), r.text);

    // Reaction roles
    const target = fake.msg(IDS.general, { content: 'React for roles' });
    r = await cmd('reactionrole', { sub: 'create', options: [opt.str('message_id', target.id), opt.chan('channel', IDS.general), opt.str('emoji', '🎮'), opt.role('role', IDS.rReward)] });
    check('/reactionrole create reacts on the message', (await prisma.reactionRole.count()) === 1 && has(r, 'react'), r.text + errText(r));
    r = await cmd('reactionrole', { sub: 'create', options: [opt.str('message_id', target.id), opt.chan('channel', IDS.general), opt.str('emoji', '👑'), opt.role('role', IDS.rHigh)] });
    check('/reactionrole refuses a role above the bot', (await prisma.reactionRole.count()) === 1, r.text);
    let mark = fake.calls.length;
    client.actions.MessageReactionAdd.handle({ user_id: IDS.user2, channel_id: IDS.general, message_id: target.id, guild_id: IDS.guild, emoji: { name: '🎮', id: null }, member: memberRaw(IDS.user2), type: 0, burst: false });
    await fake.settle();
    check('reacting gives the role', fake.callsSince(mark).some((c) => c.kind === 'roleAdd' && c.route.endsWith(IDS.rReward)), fake.callsSince(mark).map((c) => `${c.method} ${c.route}`).join(', ') + badLog(takeLog()).join(' '));
    await setModuleOn(IDS.guild, 'reactionroles', false);
    mark = fake.calls.length;
    client.actions.MessageReactionAdd.handle({ user_id: IDS.user, channel_id: IDS.general, message_id: target.id, guild_id: IDS.guild, emoji: { name: '🎮', id: null }, member: memberRaw(IDS.user), type: 0, burst: false });
    await fake.settle();
    check('...but not while Reaction roles is switched off', !fake.callsSince(mark).some((c) => c.kind === 'roleAdd'));
    await setModuleOn(IDS.guild, 'reactionroles', true);
    r = await cmd('reactionrole', { sub: 'list' });
    check('/reactionrole list', /🎮/.test(r.text), r.text);
    r = await cmd('reactionrole', { sub: 'remove', options: [opt.str('message_id', target.id), opt.str('emoji', '🎮')] });
    check('/reactionrole remove', (await prisma.reactionRole.count()) === 0, r.text);

    // Starboard
    r = await cmd('starboard', { sub: 'config', options: [opt.chan('channel', IDS.stars), opt.str('emoji', '⭐'), opt.int('threshold', 1)] });
    const starred = fake.msg(IDS.general, { content: 'legendary post' }, { author: USERS[IDS.user], reactions: [{ emoji: { id: null, name: '⭐' }, count: 1, me: false, count_details: { burst: 0, normal: 1 }, burst_colors: [], me_burst: false }] });
    mark = fake.calls.length;
    client.actions.MessageReactionAdd.handle({ user_id: IDS.user2, channel_id: IDS.general, message_id: starred.id, guild_id: IDS.guild, emoji: { name: '⭐', id: null }, member: memberRaw(IDS.user2), type: 0, burst: false });
    await fake.settle();
    check('a starred message is reposted to the starboard', fake.callsSince(mark).some((c) => c.kind === 'send' && c.channelId === IDS.stars), fake.callsSince(mark).map((c) => `${c.method} ${c.route}`).join(', ') + badLog(takeLog()).join(' '));

    // Welcome
    r = await cmd('welcome', { sub: 'set', options: [opt.bool('enabled', true), opt.chan('channel', IDS.welcome), opt.str('message', 'Hi {user}, welcome to {server}! (#{membercount})')] });
    r = await cmd('welcome', { sub: 'test' });
    check('/welcome test renders the template', /welcome to Test Server/.test(r.text), r.text);
    const newcomer = '900000000000000099';
    USERS[newcomer] = { id: newcomer, username: 'newbie', global_name: 'newbie', discriminator: '0', avatar: null, bot: false };
    require('./fakeDiscord.cjs').memberRoles[newcomer] = [];
    const member = fake.guild.members._add(memberRaw(newcomer));
    mark = fake.calls.length;
    await guildMemberAdd(member);
    await fake.settle();
    check('a new member is welcomed in the welcome channel', fake.callsSince(mark).some((c) => c.kind === 'send' && c.channelId === IDS.welcome && /newbie|<@/.test(JSON.stringify(c.body))), badLog(takeLog()).join(' '));
    r = await cmd('welcome', { sub: 'goodbye-set', options: [opt.chan('channel', IDS.welcome), opt.str('message', 'Bye {user}')] });
    check('/welcome goodbye-set', (await gc()).goodbyeMessage === 'Bye {user}', r.text);

    // Birthdays
    const now = new Date();
    r = await cmd('birthday', { sub: 'set', user: IDS.user2, options: [opt.int('month', now.getUTCMonth() + 1), opt.int('day', now.getUTCDate())] });
    check('/birthday set', (await prisma.birthday.count()) === 1, r.text);
    r = await cmd('birthday', { sub: 'set', user: IDS.user2, options: [opt.int('month', 2), opt.int('day', 31)] });
    check('/birthday rejects Feb 31', (await prisma.birthday.findFirst({})).month === now.getUTCMonth() + 1, r.text);
    r = await cmd('birthday', { sub: 'today' });
    check('/birthday today', /ben_buddy|<@/.test(r.text), r.text);
    mark = fake.calls.length;
    await checkBirthdays(client);
    await fake.settle();
    check('birthday job announces and gives the birthday role', fake.callsSince(mark).some((c) => c.kind === 'send' && /birthday/i.test(JSON.stringify(c.body))) && fake.callsSince(mark).some((c) => c.kind === 'roleAdd'), badLog(takeLog()).join(' '));
    r = await cmd('birthday', { sub: 'remove', user: IDS.user2 });
    check('/birthday remove', (await prisma.birthday.count()) === 0, r.text);

    // Economy
    await prisma.guildConfig.update({ where: { id: IDS.guild }, data: { economyEnabled: true, economyDailyAmount: 100 } });
    r = await cmd('economy', { sub: 'daily', user: IDS.user });
    r = await cmd('economy', { sub: 'daily', user: IDS.user });
    const w = await prisma.wallet.findFirst({ where: { userId: IDS.user } });
    check('/economy daily pays once per day', w.balance === 100, `${w.balance} ${r.text}`);
    r = await cmd('economy', { sub: 'slots', user: IDS.user, options: [opt.int('bet', 10)] });
    check('/economy slots', /[💎⭐🍒🍋🔔]/u.test(r.text) && noErrors(r), r.text.slice(0, 120) + errText(r));
    r = await cmd('economy', { sub: 'slots', user: IDS.user, options: [opt.int('bet', 1000000)] });
    check("slots refuses a bet you can't afford", /enough|balance|don't have/i.test(r.text), r.text);
    r = await cmd('economy', { sub: 'give', user: IDS.admin, options: [opt.user('user', IDS.user2), opt.int('amount', 50)] });
    check('/economy give (mod)', (await prisma.wallet.findFirst({ where: { userId: IDS.user2 } }))?.balance === 50, r.text);
    r = await cmd('economy', { sub: 'give', user: IDS.user, options: [opt.user('user', IDS.user), opt.int('amount', 5000)] });
    check('members cannot mint credits', (await prisma.wallet.findFirst({ where: { userId: IDS.user } })).balance < 5000, r.text);
    r = await cmd('economy', { sub: 'balance', user: IDS.user2 });
    check('/economy balance', /50/.test(r.text), r.text);
    r = await cmd('leaderboard', { options: [opt.str('type', 'economy')] });
    check('/leaderboard economy', r.replies.length && noErrors(r), r.text.slice(0, 120));
  }

  heading('Games & fun');
  {
    let r = await cmd('roll', { user: IDS.user, options: [opt.str('notation', '4d6-2')] });
    check('/roll 4d6-2', /\d/.test(r.text), r.text);
    r = await cmd('roll', { user: IDS.user, options: [opt.str('notation', '9999d9999')] });
    check('/roll refuses absurd dice', !/\d{5,}/.test(r.text), r.text);
    r = await cmd('coinflip', { user: IDS.user });
    check('/coinflip', /heads|tails/i.test(r.text), r.text);

    // Trivia import + a real 1-round game
    const qs = JSON.stringify([{ question: 'What is 2+2?', choices: ['3', '4'], correctIndex: 1 }]);
    r = await cmd('trivia', { sub: 'import', options: [opt.file('file', 'https://cdn.discordapp.com/attachments/1/2/q.json', qs)] });
    check('/trivia import', (await prisma.triviaQuestion.count()) === 1 && /Imported 1/.test(r.text), r.text + errText(r));
    r = await cmd('trivia', { sub: 'import', options: [opt.file('file', 'https://cdn.discordapp.com/attachments/1/2/bad.json', '[{"question":"x","choices":["a"],"correctIndex":3}]')] });
    check('/trivia import rejects invalid questions', /Could not parse/.test(r.text), r.text);
    await prisma.guildConfig.update({ where: { id: IDS.guild }, data: { economyEnabled: false } });
    const startMark = fake.calls.length;
    const pStart = cmd('trivia', { sub: 'start', user: IDS.user, options: [opt.int('rounds', 1)] });
    await new Promise((res) => setTimeout(res, 800));
    const qMsgCall = fake.callsSince(startMark).find((c) => c.kind === 'send' && JSON.stringify(c.body).includes('trivia_answer'));
    check('/trivia start posts a question with answer buttons', Boolean(qMsgCall));
    r = await cmd('trivia', { sub: 'start', user: IDS.user2 });
    check('only one trivia game per channel', /already running/.test(r.text), r.text);
    out('    (waiting 20s for the trivia round to end…)');
    await new Promise((res) => setTimeout(res, 21_000));
    await fake.settle();
    const after = fake.callsSince(startMark);
    check('round ends with the answer and a results post', after.some((c) => c.kind === 'send' && /Trivia ended|Trivia results|Correct/.test(JSON.stringify(c.body))), after.filter((c) => c.kind === 'send').map((c) => describe(c.body)).join(' | ').slice(0, 300));
    await pStart;
    takeLog();

    // LFG with buttons
    r = await cmd('lfg', { user: IDS.user, options: [opt.str('game', 'Valheim'), opt.int('size', 2)] });
    const lfgMsg = r.original;
    const join = flattenComponents(lfgMsg).find((c) => c.custom_id?.startsWith('lfg_join'));
    check('/lfg posts with Join/Leave/Close buttons', Boolean(join), r.text);
    r = await click(lfgMsg, join.custom_id, { user: IDS.user2 });
    const post = await prisma.lfgPost.findFirst({});
    check('joining fills the group and closes it', post.status !== 'open', `${post.status} ${r.text}` + errText(r));
    r = await click(lfgMsg, join.custom_id.replace('lfg_join', 'lfg_close'), { user: IDS.user2 });
    check('only the host can close a group', /Only the host/.test(r.text), r.text);

    // Tournament
    await cmd('tournament', { sub: 'create', user: IDS.user, options: [opt.str('name', 'Friday Cup')] });
    for (const u of [IDS.user, IDS.user2, IDS.mod]) await cmd('tournament', { sub: 'join', user: u, options: [opt.str('name', 'Friday Cup')] });
    r = await cmd('tournament', { sub: 'start', user: IDS.user, options: [opt.str('name', 'Friday Cup')] });
    check('/tournament start builds a bracket (3 players, one bye)', /Round 1|bye/i.test(r.text) && noErrors(r), r.text.slice(0, 200) + errText(r));
    r = await cmd('tournament', { sub: 'view', user: IDS.user, options: [opt.str('name', 'Friday Cup')] });
    check('/tournament view', r.replies.length && noErrors(r), r.text.slice(0, 120));
    const t = await prisma.tournament.findFirst({});
    const bracket = JSON.parse(t.bracket);
    const m1 = bracket[0].find((m) => m.player2);
    r = await cmd('tournament', { sub: 'report', user: IDS.user, options: [opt.str('name', 'Friday Cup'), opt.user('winner', m1.player1)] });
    check('/tournament report advances the winner', r.replies.length && noErrors(r) && !/not in|isn't/i.test(r.text), r.text.slice(0, 200) + errText(r));

    // Maps
    r = await cmd('map', { sub: 'add', user: IDS.user, options: [opt.str('game', 'CS2'), opt.str('maps', 'Mirage, Inferno')] });
    check('/map add is moderators-only', /Only moderators/.test(r.text), r.text);
    r = await cmd('map', { sub: 'add', user: IDS.mod, options: [opt.str('game', 'CS2'), opt.str('maps', 'Mirage, Inferno, Nuke, Anubis, mirage')] });
    check('/map add (mod) dedupes', (await prisma.mapPool.count({ where: { game: 'cs2' } })) === 4, r.text);
    r = await cmd('map', { sub: 'list', user: IDS.user });
    check('/map list shows every game', /cs2/.test(r.text) && /valorant/.test(r.text), r.text);
    r = await cmd('map', { sub: 'random', user: IDS.user, options: [opt.str('game', 'cs2'), opt.int('count', 2)] });
    check('/map random picks 2 distinct maps', /1\.\*\* \w+ +\*\*2\.\*\* \w+/.test(r.text), r.text);
    r = await cmd('map', { sub: 'vote', user: IDS.user, options: [opt.str('game', 'CS2'), opt.int('choices', 3), opt.int('hours', 2)] });
    const poll = r.replies[0]?.body?.data?.poll;
    check('/map vote opens a native Discord poll with 3 maps for 2 hours', poll && poll.answers.length === 3 && poll.duration === 2, JSON.stringify(poll ?? r.text).slice(0, 200));
    r = await cmd('map', { sub: 'remove', user: IDS.mod, options: [opt.str('game', 'cs2'), opt.str('map', 'NUKE')] });
    check('/map remove (case-insensitive)', (await prisma.mapPool.count({ where: { game: 'cs2' } })) === 3, r.text);
    r = await cmd('map', { sub: 'vote', user: IDS.user, options: [opt.str('game', 'zelda')] });
    check('/map vote on an empty pool explains', /at least 2 maps/.test(r.text), r.text);

    // Game servers / stats / streams / activity roles (no API keys configured)
    r = await cmd('gameserver', { user: IDS.user, options: [opt.str('type', 'minecraft'), opt.str('host', '127.0.0.1'), opt.int('port', 1)] });
    check('/gameserver reports an unreachable server gracefully', r.replies.length && !/went wrong/.test(r.text), r.text.slice(0, 160) + errText(r));
    r = await cmd('gamestats', { sub: 'steam', user: IDS.user, options: [opt.str('username', 'gaben')] });
    check('/gamestats without a key says "not configured"', /configured|key/i.test(r.text), r.text);
    r = await cmd('streamwatch', { sub: 'add', options: [opt.str('platform', 'twitch'), opt.str('channel_name', 'somestreamer'), opt.chan('post_in', IDS.general)] });
    r = await cmd('streamwatch', { sub: 'list' });
    check('/streamwatch add + list', /somestreamer/.test(r.text), r.text);
    takeLog();
    await checkStreamNotifications(client);
    check('stream polling without keys fails closed (no crash)', badLog(takeLog()).length === 0);
    r = await cmd('streamwatch', { sub: 'remove', options: [opt.str('platform', 'twitch'), opt.str('channel_name', 'somestreamer')] });
    check('/streamwatch remove', (await prisma.streamNotification.count()) === 0, r.text);
    r = await cmd('activityrole', { sub: 'add', options: [opt.str('game_name', 'Minecraft'), opt.role('role', IDS.rReward)] });
    r = await cmd('activityrole', { sub: 'list' });
    check('/activityrole add + list', /minecraft/i.test(r.text), r.text);
    r = await cmd('activityrole', { sub: 'remove', options: [opt.str('game_name', 'Minecraft')] });
    check('/activityrole remove', (await prisma.voiceActivityRole.count()) === 0, r.text);
  }

  heading('Group jams');
  {
    let r = await cmd('jam', { user: IDS.user });
    const inv = r.calls.find((c) => c.kind === 'invite');
    check('/jam creates a Watch Together invite in your voice channel', inv && inv.body.target_type === 2 && inv.body.target_application_id === '880218394199220334' && inv.route.includes(IDS.voice), JSON.stringify(inv?.body) + r.text);
    check('/jam replies with a link button', /discord\.gg\/jamAbC123/.test(JSON.stringify(r.replies[0]?.body)), r.text);
    r = await cmd('jam', { user: IDS.user2 });
    check('/jam outside voice tells you to join one', /Join a voice channel/.test(r.text) && !r.calls.some((c) => c.kind === 'invite'), r.text);
    r = await cmd('music', { sub: 'play', user: IDS.user, options: [opt.str('query', 'lofi beats')] });
    if (!MUSIC) {
      check('/music while the host has music off explains and points to /jam', /isn't turned on/.test(r.text) && /\/jam/.test(r.text), r.text);
    } else {
      check('/music play with tools missing explains instead of crashing', r.replies.length && !/went wrong/i.test(r.text), r.text + errText(r));
      r = await cmd('music', { sub: 'play', user: IDS.user2, options: [opt.str('query', 'lofi')] });
      check('/music play outside voice', /Join a voice channel/.test(r.text), r.text);
      r = await cmd('music', { sub: 'play', user: IDS.user, options: [opt.str('query', 'http://192.168.1.1/admin')] });
      check('/music refuses non-YouTube links', /Only YouTube links/.test(r.text), r.text);
      r = await cmd('music', { sub: 'skip', user: IDS.user });
      check('/music skip with nothing playing', /Nothing's playing/.test(r.text), r.text);
    }
    await setModuleOn(IDS.guild, 'music', false);
    r = await cmd('jam', { user: IDS.user });
    check('switching Music off blocks /jam and /music', /turned off/.test(r.text), r.text);
    await setModuleOn(IDS.guild, 'music', true);
  }

  heading('Scheduler');
  {
    await prisma.mute.create({ data: { guildId: IDS.guild, userId: IDS.user2, expiresAt: new Date(Date.now() - 1000), active: true } }).catch((e) => out('   (could not seed mute: ' + e.message + ')'));
    const mark = fake.calls.length;
    await checkExpiredMutes(client);
    await fake.settle();
    check('expired mutes are lifted automatically', fake.callsSince(mark).some((c) => c.kind === 'roleRemove'), badLog(takeLog()).join(' '));
  }

  heading('Gap fixes');
  {
    // 1. Legacy ! commands can be switched on from /setup
    let r = await cmd('setup', { user: IDS.admin });
    const sm = r.original;
    await click(sm, 'setup:nav:open', { componentType: 3, values: ['prefix'] });
    r = await click(sm, 'setup:prefix:toggle');
    check('/setup → Legacy ! commands switch turns them on', (await gc()).prefixCommandsOn === true, r.text.slice(0, 120));
    const pc = baseRaw(3, IDS.admin, sm.channel_id, { message: sm, data: { custom_id: 'setup:prefix:change', component_type: 2 } });
    await dispatch(pc);
    r = await submitModal(`setup_form:${pc.id}`, { prefix: '?' }, { message: sm });
    check('prefix can be changed from /setup', (await gc()).prefix === '?', r.text.slice(0, 120));
    const before = await prisma.case.count();
    const pm = userMessage(IDS.mod, `?warn <@${IDS.user2}> testing prefix`);
    pm.mentions = [USERS[IDS.user2]];
    let e = await emitMessage(pm);
    check('?warn then works and creates a case', (await prisma.case.count()) === before + 1, e.log.join(' | ').slice(0, 200));

    // 2. Message text in logs: opt-in switch + retention that really removes it
    await click(sm, 'setup:nav:map');
    await click(sm, 'setup:nav:open', { componentType: 3, values: ['automod'] });
    check('message text is off by default', (await gc()).logMessageContent === false);
    await click(sm, 'setup:automod:keeptext');
    const rc = baseRaw(3, IDS.admin, sm.channel_id, { message: sm, data: { custom_id: 'setup:automod:retain', component_type: 2 } });
    await dispatch(rc);
    await submitModal(`setup_form:${rc.id}`, { days: '7' }, { message: sm });
    const g2 = await gc();
    check('/setup → Auto-mod turns message text on and sets the days', g2.logMessageContent === true && g2.contentRetainDays === 7);
    await prisma.guildConfig.update({ where: { id: IDS.guild }, data: { automodEnabled: true, inviteFilterOn: true } });
    e = await emitMessage(userMessage(IDS.user, 'free nitro discord.gg/scam1'));
    const logged = e.calls.find((c) => c.kind === 'send' && c.channelId === IDS.modlog);
    const rowCount = await prisma.contentLogMessage.count();
    check('auto-mod log includes the text and records it for expiry', JSON.stringify(logged?.body ?? {}).includes('discord.gg/scam1') && rowCount >= 1, `rows=${rowCount}`);
    await prisma.contentLogMessage.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const mark = fake.calls.length;
    const { pruneExpiredContent } = require(`${ROOT}/dist/lib/contentRetention`);
    await pruneExpiredContent(client);
    await fake.settle();
    const edit = fake.callsSince(mark).find((c) => c.kind === 'edit');
    check('after the retention period the text is edited out of the log', edit && JSON.stringify(edit.body).includes('removed after 7 days') && !JSON.stringify(edit.body).includes('scam1'), JSON.stringify(edit?.body ?? 'no edit').slice(0, 200));
    check('...and the expiry record is cleared', (await prisma.contentLogMessage.count()) === 0);
    await prisma.guildConfig.update({ where: { id: IDS.guild }, data: { automodEnabled: false } });

    // 3. Muted role covers channels created later (including threads)
    const muteRoleId = (await gc()).muteRoleId;
    const newId = snow();
    const m2 = fake.calls.length;
    client.actions.ChannelCreate.handle({ id: newId, name: 'brand-new', type: 0, guild_id: IDS.guild, position: 9, permission_overwrites: [], nsfw: false, parent_id: null });
    await fake.settle();
    const ow = fake.callsSince(m2).find((c) => c.kind === 'overwrite' && c.route.endsWith(muteRoleId));
    const deny = ow ? BigInt(ow.body.deny) : 0n;
    const P = djs.PermissionFlagsBits;
    check('a new channel gets the Muted role overrides', ow && (deny & P.SendMessages) && (deny & P.AddReactions), JSON.stringify(ow?.body ?? 'none'));
    check('...including no posting in threads', ow && (deny & P.SendMessagesInThreads) && (deny & P.CreatePublicThreads));
    await click(sm, 'setup:nav:done');
    takeLog();
  }

  heading('Moderation essentials');
  {
    for (let n = 0; n < 4; n++) fake.msg(IDS.general, { content: `junk ${n}` }, { author: USERS[IDS.user2] });
    fake.msg(IDS.general, { content: 'keep me' }, { author: USERS[IDS.user2], pinned: true });
    let r = await cmd('purge', { user: IDS.mod, options: [opt.int('amount', 10), opt.user('user', IDS.user2)] });
    const bd = r.calls.find((c) => c.kind === 'bulkDelete');
    check('/purge bulk-deletes only that member\'s unpinned messages', bd && bd.body.messages.length === 4 + 0 || (bd && bd.body.messages.length >= 4), JSON.stringify(bd?.body ?? r.text).slice(0, 160));
    check('/purge is logged to the mod-log', sent(r, IDS.modlog).some((c) => /PURGE/.test(JSON.stringify(c.body))));
    r = await cmd('purge', { user: IDS.user, options: [opt.int('amount', 5)] });
    check('regular members cannot /purge', /permission/i.test(r.text) && !has(r, 'bulkDelete'), r.text);
    r = await cmd('slowmode', { user: IDS.mod, options: [opt.str('delay', '10s')] });
    check('/slowmode 10s sets a 10-second delay', r.calls.some((c) => c.kind === 'channelEdit' && c.body.rate_limit_per_user === 10), r.text);
    r = await cmd('slowmode', { user: IDS.mod, options: [opt.str('delay', '9h')] });
    check('/slowmode refuses more than 6h', !has(r, 'channelEdit'), r.text);
    r = await cmd('lock', { user: IDS.mod, options: [opt.str('reason', 'cooling off')] });
    const lockOw = r.calls.find((c) => c.kind === 'overwrite' && c.route.endsWith(IDS.everyone));
    check('/lock denies @everyone posting', lockOw && (BigInt(lockOw.body.deny) & djs.PermissionFlagsBits.SendMessages), JSON.stringify(lockOw?.body));
    r = await cmd('unlock', { user: IDS.mod });
    const unlockOw = r.calls.find((c) => c.kind === 'overwrite' && c.route.endsWith(IDS.everyone));
    check('/unlock lifts it', unlockOw && !(BigInt(unlockOw.body.deny ?? '0') & djs.PermissionFlagsBits.SendMessages), JSON.stringify(unlockOw?.body));
    r = await cmd('unban', { user: IDS.mod, options: [opt.user('user', IDS.target), opt.str('reason', 'second chance')] });
    check('/unban lifts the ban and records a case', has(r, 'unban') && (await prisma.case.count({ where: { type: 'unban' } })) === 1, r.text + errText(r));
    r = await cmd('unban', { user: IDS.mod, options: [opt.user('user', IDS.target)] });
    check("/unban says so when they aren't banned", /isn't banned/.test(r.text), r.text);
    r = await cmd('role', { sub: 'add', user: IDS.admin, options: [opt.user('user', IDS.user2), opt.role('role', IDS.rReward)] });
    check('/role add gives the role', r.calls.some((c) => c.kind === 'roleAdd' && c.route.endsWith(IDS.rReward)) || /already has/.test(r.text), r.text + errText(r));
    r = await cmd('role', { sub: 'add', user: IDS.admin, options: [opt.user('user', IDS.user2), opt.role('role', IDS.rHigh)] });
    check('/role refuses a role above the bot', !r.calls.some((c) => c.kind === 'roleAdd'), r.text);
    r = await cmd('role', { sub: 'add', user: IDS.mod, options: [opt.user('user', IDS.admin), opt.role('role', IDS.rReward)] });
    check('/role refuses changing someone ranked above you', !r.calls.some((c) => c.kind === 'roleAdd'), r.text);
    r = await cmd('help', { user: IDS.user });
    check('/help lists the commands that work here', /\/ticket/.test(r.text) && /\/purge/.test(r.text) && noErrors(r), r.text.slice(0, 200) + errText(r));
    r = await cmd('help', { user: IDS.user, options: [opt.str('command', 'giveaway')] });
    check('/help command:giveaway shows its subcommands', /giveaway start/.test(r.text), r.text.slice(0, 200));
    await setModuleOn(IDS.guild, 'tickets', false);
    r = await cmd('help', { user: IDS.user });
    check('/help hides switched-off features', !/\/ticket/.test(r.text));
    await setModuleOn(IDS.guild, 'tickets', true);
  }

  heading('Server logs');
  {
    let r = await cmd('setup', { user: IDS.admin });
    const sm = r.original;
    await click(sm, 'setup:nav:open', { componentType: 3, values: ['serverlog'] });
    await click(sm, 'setup:serverlog:channel', { componentType: 8, values: [IDS.stars], resolved: { channels: { [IDS.stars]: { id: IDS.stars, type: 0, name: 'starboard', permissions: APP_PERMS } } } });
    check('/setup → Server logs picks the channel', (await gc()).serverLogChannelId === IDS.stars);
    await click(sm, 'setup:serverlog:events', { componentType: 3, values: ['messages', 'members', 'memberUpdates', 'channels', 'roles', 'bans'] });
    check('switching off one kind of event (voice) is saved', JSON.parse((await gc()).serverLogEvents).join() === 'voice', (await gc()).serverLogEvents);
    await click(sm, 'setup:nav:done');
    const logged = (calls) => calls.filter((c) => c.kind === 'send' && c.channelId === IDS.stars);

    // The bot only knows a deleted message's text if it saw the message arrive.
    const del = userMessage(IDS.user2, 'this will vanish');
    await emitMessage(del);
    let mark = fake.calls.length;
    client.actions.MessageDelete.handle({ id: del.id, channel_id: IDS.general, guild_id: IDS.guild });
    await fake.settle();
    let posted = logged(fake.callsSince(mark));
    check('deleted messages are logged, with text (opted in) and an expiry record', posted.length === 1 && JSON.stringify(posted[0].body).includes('this will vanish') && (await prisma.contentLogMessage.count()) === 1, JSON.stringify(posted[0]?.body ?? 'nothing').slice(0, 200));
    await prisma.guildConfig.update({ where: { id: IDS.guild }, data: { logMessageContent: false } });
    const del2 = userMessage(IDS.user2, 'private words');
    await emitMessage(del2);
    mark = fake.calls.length;
    client.actions.MessageDelete.handle({ id: del2.id, channel_id: IDS.general, guild_id: IDS.guild });
    await fake.settle();
    posted = logged(fake.callsSince(mark));
    check('with message text off, the log has who/where but not the text', posted.length === 1 && !JSON.stringify(posted[0].body).includes('private words'), JSON.stringify(posted[0]?.body ?? 'nothing').slice(0, 200));
    await prisma.guildConfig.update({ where: { id: IDS.guild }, data: { logMessageContent: true } });

    const ed = userMessage(IDS.user2, 'old text');
    await emitMessage(ed);
    mark = fake.calls.length;
    // Like discord.js's MESSAGE_UPDATE gateway handler: the action updates the cache, the handler emits.
    const upd = client.actions.MessageUpdate.handle({ ...ed, content: 'new text', edited_timestamp: new Date().toISOString() });
    if (upd?.old) client.emit('messageUpdate', upd.old, upd.updated);
    await fake.settle();
    posted = logged(fake.callsSince(mark));
    check('edits are logged with before and after', posted.length === 1 && /old text/.test(JSON.stringify(posted[0].body)) && /new text/.test(JSON.stringify(posted[0].body)), JSON.stringify(posted[0]?.body ?? 'nothing').slice(0, 200));

    mark = fake.calls.length;
    client.actions.GuildRoleCreate.handle({ guild_id: IDS.guild, role: { id: snow(), name: 'Party', position: 1, permissions: '0', color: 0, hoist: false, managed: false, mentionable: false, flags: 0 } });
    await fake.settle();
    check('new roles are logged', logged(fake.callsSince(mark)).some((c) => /Role created/.test(JSON.stringify(c.body))));

    mark = fake.calls.length;
    client.actions.GuildBanAdd.handle({ guild_id: IDS.guild, user: USERS[IDS.user2] });
    await fake.settle();
    check('bans done outside the bot are logged', logged(fake.callsSince(mark)).some((c) => /banned/.test(JSON.stringify(c.body))));

    mark = fake.calls.length;
    client.actions.VoiceStateUpdate.handle({ guild_id: IDS.guild, user_id: IDS.user2, channel_id: IDS.voice, session_id: 's9', deaf: false, mute: false, self_deaf: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null, member: memberRaw(IDS.user2) });
    await fake.settle();
    check('a switched-off kind of event (voice) is not logged', logged(fake.callsSince(mark)).length === 0);
    client.actions.VoiceStateUpdate.handle({ guild_id: IDS.guild, user_id: IDS.user2, channel_id: null, session_id: 's9', deaf: false, mute: false, self_deaf: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null, member: memberRaw(IDS.user2) });
    await fake.settle();
    await prisma.contentLogMessage.deleteMany({});
    takeLog();
  }

  heading('Tickets');
  {
    let r = await cmd('setup', { user: IDS.admin });
    const sm = r.original;
    await click(sm, 'setup:nav:open', { componentType: 3, values: ['tickets'] });
    await click(sm, 'setup:tickets:staff', { componentType: 6, values: [IDS.rMod], resolved: { roles: { [IDS.rMod]: roles.find((x) => x.id === IDS.rMod) } } });
    await click(sm, 'setup:tickets:log', { componentType: 8, values: [IDS.modlog], resolved: { channels: { [IDS.modlog]: { id: IDS.modlog, type: 0, name: 'mod-log', permissions: APP_PERMS } } } });
    const g = await gc();
    check('/setup → Tickets saves staff role and transcript channel', g.ticketStaffRoleId === IDS.rMod && g.ticketLogChannelId === IDS.modlog);
    r = await click(sm, 'setup:tickets:post', { componentType: 8, values: [IDS.general], resolved: { channels: { [IDS.general]: { id: IDS.general, type: 0, name: 'general', permissions: APP_PERMS } } } });
    const panelCall = r.calls.find((c) => c.kind === 'send' && JSON.stringify(c.body).includes('ticket_open'));
    check('it posts the "Open a ticket" button', Boolean(panelCall), r.text.slice(0, 120));
    await click(sm, 'setup:nav:done');
    const panelMsg = [...fake.messages.values()].reverse().find((m) => JSON.stringify(m.components).includes('ticket_open'));
    r = await click(panelMsg, 'ticket_open', { user: IDS.user });
    const ticket = await prisma.ticket.findFirst({ where: { userId: IDS.user } });
    const threadMsg = r.calls.find((c) => c.kind === 'send' && c.channelId === ticket?.threadId);
    check('pressing it opens a private thread and adds the member', has(r, 'threadCreate') && r.calls.some((c) => c.kind === 'threadMemberAdd') && ticket?.status === 'open', r.text + errText(r));
    check('...and pings the staff role into it', threadMsg && (threadMsg.body.allowed_mentions?.roles ?? []).includes(IDS.rMod), JSON.stringify(threadMsg?.body?.allowed_mentions));
    r = await click(panelMsg, 'ticket_open', { user: IDS.user });
    check('one open ticket per member', /already have an open ticket/.test(r.text) && !has(r, 'threadCreate'), r.text);
    const threadRaw = fake.extraChannels.get(ticket.threadId);
    client.channels._add(threadRaw, fake.guild);
    fake.msg(ticket.threadId, { content: 'my game crashes on launch' }, { author: USERS[IDS.user] });
    const closeMsg = fake.messages.get(threadMsg ? [...fake.messages.values()].find((m) => m.channel_id === ticket.threadId && JSON.stringify(m.components).includes('ticket_close'))?.id : '');
    r = await click(closeMsg, `ticket_close:${ticket.id}`, { user: IDS.user2 });
    check('a stranger cannot close someone else\'s ticket', /Only the person/.test(r.text) && (await prisma.ticket.findFirst({ where: { id: ticket.id } })).status === 'open', r.text);
    r = await click(closeMsg, `ticket_close:${ticket.id}`, { user: IDS.user });
    const transcript = r.calls.find((c) => c.kind === 'send' && c.channelId === IDS.modlog && c.files?.length);
    check('closing saves a transcript to the transcript channel', transcript && /my game crashes/.test(transcript.files[0].text), JSON.stringify(transcript?.files?.[0]?.text ?? r.text).slice(0, 200));
    check('...and locks and archives the thread', r.calls.some((c) => c.kind === 'channelEdit' && c.body.locked === true) && r.calls.some((c) => c.kind === 'channelEdit' && c.body.archived === true));
    check('ticket is marked closed', (await prisma.ticket.findFirst({ where: { id: ticket.id } })).status === 'closed');
  }

  heading('Giveaways & suggestions');
  {
    let r = await cmd('giveaway', { sub: 'start', user: IDS.mod, options: [opt.str('prize', 'Steam key'), opt.str('duration', '10m'), opt.int('winners', 1)] });
    const gw = await prisma.giveaway.findFirst({});
    const gwMsg = fake.messages.get(gw?.messageId);
    check('/giveaway start posts it with an Enter button', gw && JSON.stringify(gwMsg?.components ?? []).includes(`giveaway_enter:${gw.id}`), r.text + errText(r));
    r = await cmd('giveaway', { sub: 'start', user: IDS.user, options: [opt.str('prize', 'x'), opt.str('duration', '10m')] });
    check('regular members cannot start giveaways', /permission/i.test(r.text));
    await click(gwMsg, `giveaway_enter:${gw.id}`, { user: IDS.user });
    await click(gwMsg, `giveaway_enter:${gw.id}`, { user: IDS.user2 });
    r = await click(gwMsg, `giveaway_enter:${gw.id}`, { user: IDS.user2 });
    check('pressing again leaves the giveaway', /left/.test(r.text) && (await prisma.giveawayEntry.count()) === 1, r.text);
    await prisma.giveaway.update({ where: { id: gw.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    let mark = fake.calls.length;
    const { checkGiveaways } = require(`${ROOT}/dist/features/giveaways`);
    await checkGiveaways(client);
    await fake.settle();
    const ann = fake.callsSince(mark).find((c) => c.kind === 'send' && /Congratulations/.test(JSON.stringify(c.body)));
    check('when time is up, the winner is drawn and announced', ann && JSON.stringify(ann.body).includes(IDS.user) && (await prisma.giveaway.findFirst({})).ended, JSON.stringify(ann?.body ?? 'none').slice(0, 160));
    check('...and the Enter button is disabled', fake.callsSince(mark).some((c) => c.kind === 'edit' && JSON.stringify(c.body).includes('"disabled":true')));
    r = await cmd('giveaway', { sub: 'reroll', user: IDS.mod, options: [opt.int('id', gw.id)] });
    check('/giveaway reroll with nobody left says so', /Nobody was left/.test(r.text), r.text);

    r = await cmd('suggest', { user: IDS.user, options: [opt.str('idea', 'Add a memes channel')] });
    check('/suggest before setup explains how to set it up', /aren't set up yet/.test(r.text), r.text);
    await prisma.guildConfig.update({ where: { id: IDS.guild }, data: { suggestionChannelId: IDS.general } });
    r = await cmd('suggest', { user: IDS.user, options: [opt.str('idea', 'Add a memes channel')] });
    const sug = await prisma.suggestion.findFirst({});
    const sugMsg = fake.messages.get(sug?.messageId);
    check('/suggest posts with vote buttons', sug && JSON.stringify(sugMsg?.components ?? []).includes(`suggestion_vote:${sug.id}:up`), r.text);
    r = await click(sugMsg, `suggestion_vote:${sug.id}:up`, { user: IDS.user2 });
    r = await click(sugMsg, `suggestion_vote:${sug.id}:down`, { user: IDS.user2 });
    check('switching a vote counts once', /👍 0 · 👎 1/.test(JSON.stringify(r.replies[0]?.body)), JSON.stringify(r.replies[0]?.body).slice(0, 200));
    r = await click(sugMsg, `suggestion_vote:${sug.id}:down`, { user: IDS.user2 });
    check('pressing your vote again removes it', /👍 0 · 👎 0/.test(JSON.stringify(r.replies[0]?.body)));
    r = await cmd('suggestion', { sub: 'approve', user: IDS.mod, options: [opt.int('id', sug.id), opt.str('note', 'Great idea')] });
    check('/suggestion approve updates it and DMs the author', (await prisma.suggestion.findFirst({})).status === 'approved' && r.calls.some((c) => c.kind === 'send' && c.channelId?.startsWith('77') && /approved/.test(JSON.stringify(c.body))), r.text + errText(r));
    r = await click(sugMsg, `suggestion_vote:${sug.id}:up`, { user: IDS.user2 });
    check('voting closes once decided', /closed/.test(r.text), r.text);
  }

  heading('Join roles, verification, auto-responders, announcements, voice rooms');
  {
    let r = await cmd('setup', { user: IDS.admin });
    const sm = r.original;
    await click(sm, 'setup:nav:open', { componentType: 3, values: ['joinroles'] });
    r = await click(sm, 'setup:joinroles:join', { componentType: 6, values: [IDS.rHigh], resolved: { roles: { [IDS.rHigh]: roles.find((x) => x.id === IDS.rHigh) } } });
    check('join roles refuse a role above the bot', (await gc()).joinRoleIds === '[]', r.text.slice(0, 160));
    await click(sm, 'setup:joinroles:join', { componentType: 6, values: [IDS.rReward], resolved: { roles: { [IDS.rReward]: roles.find((x) => x.id === IDS.rReward) } } });
    await click(sm, 'setup:joinroles:verify', { componentType: 6, values: [IDS.rMember], resolved: { roles: { [IDS.rMember]: roles.find((x) => x.id === IDS.rMember) } } });
    const g = await gc();
    check('/setup → Join roles saves the join and verified roles', JSON.parse(g.joinRoleIds)[0] === IDS.rReward && g.verifyRoleId === IDS.rMember);
    r = await click(sm, 'setup:joinroles:post', { componentType: 8, values: [IDS.welcome], resolved: { channels: { [IDS.welcome]: { id: IDS.welcome, type: 0, name: 'welcome', permissions: APP_PERMS } } } });
    check('it posts the Verify button', r.calls.some((c) => c.kind === 'send' && c.channelId === IDS.welcome && JSON.stringify(c.body).includes('"verify"')));
    await click(sm, 'setup:nav:done');
    const joiner = '900000000000000098';
    USERS[joiner] = { id: joiner, username: 'joiner', global_name: 'joiner', discriminator: '0', avatar: null, bot: false };
    require('./fakeDiscord.cjs').memberRoles[joiner] = [];
    let mark = fake.calls.length;
    await guildMemberAdd(fake.guild.members._add(memberRaw(joiner)));
    await fake.settle();
    check('new members get the join role', fake.callsSince(mark).some((c) => (c.kind === 'memberEdit' && JSON.stringify(c.body).includes(IDS.rReward)) || (c.kind === 'roleAdd' && c.route.endsWith(IDS.rReward))), fake.callsSince(mark).map((c) => `${c.method} ${c.route}`).join(', '));
    const verifyMsg = [...fake.messages.values()].reverse().find((m) => JSON.stringify(m.components).includes('"verify"'));
    r = await click(verifyMsg, 'verify', { user: joiner });
    check('pressing Verify gives the verified role', r.calls.some((c) => c.kind === 'roleAdd' && c.route.endsWith(IDS.rMember)), r.text + errText(r));

    r = await cmd('autoresponder', { sub: 'add', user: IDS.admin, options: [opt.str('trigger', 'How do I join'), opt.str('response', 'Use play.example.com')] });
    check('/autoresponder add', (await prisma.autoResponder.count()) === 1, r.text);
    let e = await emitMessage(userMessage(IDS.user2, 'hey how do i join the server?'));
    check('a matching message gets the reply', e.calls.some((c) => c.kind === 'send' && /play\.example\.com/.test(JSON.stringify(c.body))));
    e = await emitMessage(userMessage(IDS.user2, 'how do i join'));
    check('...but not again within 30 seconds in the same channel', !e.calls.some((c) => c.kind === 'send' && /play\.example\.com/.test(JSON.stringify(c.body))));
    r = await cmd('autoresponder', { sub: 'add', user: IDS.user, options: [opt.str('trigger', 'x y'), opt.str('response', 'z')] });
    check('regular members cannot add auto-responses', /permission/i.test(r.text));

    r = await cmd('announce', { sub: 'send', user: IDS.admin, options: [opt.chan('channel', IDS.general), opt.str('message', 'Game night tonight!'), opt.str('title', 'Heads up')] });
    check('/announce send posts an embed now', r.calls.some((c) => c.kind === 'send' && /Game night tonight/.test(JSON.stringify(c.body))), r.text + errText(r));
    r = await cmd('announce', { sub: 'send', user: IDS.admin, options: [opt.chan('channel', IDS.general), opt.str('message', 'Weekly rules reminder'), opt.str('in', '1m'), opt.str('repeat', 'weekly')] });
    const sched = await prisma.scheduledMessage.findFirst({});
    check('/announce with in/repeat schedules it', sched && sched.repeat === 'weekly', r.text);
    await prisma.scheduledMessage.update({ where: { id: sched.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    mark = fake.calls.length;
    const { checkAnnouncements } = require(`${ROOT}/dist/features/announcements`);
    await checkAnnouncements(client);
    await fake.settle();
    const after = await prisma.scheduledMessage.findFirst({});
    check('when due it posts, and a weekly one moves on a week', fake.callsSince(mark).some((c) => c.kind === 'send' && /Weekly rules/.test(JSON.stringify(c.body))) && after && after.nextRunAt > new Date(Date.now() + 6 * 86_400_000));
    r = await cmd('announce', { sub: 'cancel', user: IDS.admin, options: [opt.int('id', sched.id)] });
    check('/announce cancel', (await prisma.scheduledMessage.count()) === 0, r.text);

    await prisma.guildConfig.update({ where: { id: IDS.guild }, data: { tempVoiceHubId: IDS.voice } });
    mark = fake.calls.length;
    client.actions.VoiceStateUpdate.handle({ guild_id: IDS.guild, user_id: IDS.user2, channel_id: IDS.voice, session_id: 's10', deaf: false, mute: false, self_deaf: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null, member: memberRaw(IDS.user2) });
    await fake.settle();
    const created = fake.callsSince(mark).find((c) => c.kind === 'guildChannelCreate');
    const room = await prisma.tempVoiceChannel.findFirst({});
    check('joining the hub makes a voice room and moves you in', created && created.body.type === 2 && room && fake.callsSince(mark).some((c) => c.kind === 'move'), fake.callsSince(mark).map((c) => `${c.kind}`).join(','));
    if (room) {
      client.channels._add(fake.extraChannels.get(room.channelId), fake.guild);
      mark = fake.calls.length;
      client.actions.VoiceStateUpdate.handle({ guild_id: IDS.guild, user_id: IDS.user2, channel_id: room.channelId, session_id: 's10', deaf: false, mute: false, self_deaf: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null, member: memberRaw(IDS.user2) });
      await fake.settle();
      r = await cmd('voice', { sub: 'limit', user: IDS.user2, options: [opt.int('people', 4)] });
      check('/voice limit works in your own room', r.calls.some((c) => c.kind === 'channelEdit' && c.body.user_limit === 4), r.text + errText(r));
      r = await cmd('voice', { sub: 'rename', user: IDS.user, options: [opt.str('name', 'mine now')] });
      check("someone else can't change your room", !r.calls.some((c) => c.kind === 'channelEdit'), r.text);
      mark = fake.calls.length;
      client.actions.VoiceStateUpdate.handle({ guild_id: IDS.guild, user_id: IDS.user2, channel_id: null, session_id: 's10', deaf: false, mute: false, self_deaf: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null, member: memberRaw(IDS.user2) });
      await fake.settle();
      check('the room is deleted when it empties', fake.callsSince(mark).some((c) => c.kind === 'channelDelete') && (await prisma.tempVoiceChannel.count()) === 0);
    }
    takeLog();
  }

  heading('Web dashboard (over real HTTP)');
  {
    const http = require('node:http');
    const { createApp } = require(`${ROOT}/dist/dashboard/server`);
    const { createLoginToken } = require(`${ROOT}/dist/dashboard/auth`);
    const { isModuleEnabledForGuild } = require(`${ROOT}/dist/lib/modules`);
    const srv = http.createServer(createApp(client));
    await new Promise((res) => srv.listen(0, '127.0.0.1', res));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const get = (p, cookie) => fetch(base + p, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    const post = (p, cookie, form) =>
      fetch(base + p, { method: 'POST', redirect: 'manual', headers: { cookie: cookie ?? '', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
    const gcNow = () => prisma.guildConfig.findUnique({ where: { id: IDS.guild } });

    let d = await cmd('dashboard', { user: IDS.user });
    check('/dashboard is refused for regular members', /permission/i.test(d.text) && !/login\?t=/.test(d.text), d.text);
    d = await cmd('dashboard', { user: IDS.admin });
    const token = (d.text.match(/login\?t=([\w-]+)/) || [])[1];
    check('/dashboard gives an admin a private one-time link', token && JSON.stringify(d.calls).includes('"flags":64'), d.text + errText(d));

    let res = await get('/');
    check('without signing in, nothing is shown', res.status === 401);
    res = await get(`/login?t=${token}`);
    const setCookie = res.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0];
    check('the link signs you in and takes the token off the URL', res.status === 303 && res.headers.get('location') === '/' && /HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie), `${res.status} ${setCookie}`);
    res = await get(`/login?t=${token}`);
    check('the same link does not work twice', res.status === 401);

    res = await get('/', cookie);
    let html = await res.text();
    check('the feature map loads with every group', res.status === 200 && /Moderation/.test(html) && /Community/.test(html) && /Games &amp; fun/.test(html), `${res.status}`);
    check('pages are sent with a strict security policy', /default-src 'none'/.test(res.headers.get('content-security-policy') || '') && res.headers.get('x-frame-options') === 'DENY' && res.headers.get('referrer-policy') === 'no-referrer' && !res.headers.get('x-powered-by'));
    const csrf = (html.match(/name="csrf" value="([^"]+)"/) || [])[1];

    const triviaBefore = await isModuleEnabledForGuild(IDS.guild, 'trivia');
    res = await post('/toggle/trivia', cookie, { csrf: 'forged' });
    check('a form without the right CSRF token is refused', res.status === 403 && (await isModuleEnabledForGuild(IDS.guild, 'trivia')) === triviaBefore);
    res = await post('/toggle/trivia', cookie, { csrf });
    check('a feature can be switched off and on', res.status === 303 && (await isModuleEnabledForGuild(IDS.guild, 'trivia')) === !triviaBefore);
    d = await cmd('trivia', { sub: 'start', user: IDS.user });
    check('...and Discord sees the change straight away', triviaBefore ? /off/i.test(d.text) : true, d.text);
    await post('/toggle/trivia', cookie, { csrf });

    const modlogBefore = (await gcNow()).modLogChannelId;
    res = await post('/f/modlog', cookie, { csrf, modLogChannelId: '123456789012345678' });
    check('a channel that is not on the server is refused', res.status === 400 && (await gcNow()).modLogChannelId === modlogBefore && /isn&#39;t on this server/.test(await res.text()));
    res = await post('/f/automod', cookie, { csrf, spamMessageLimit: '7', spamIntervalMs: '9', mentionSpamLimit: '6', inviteFilterOn: 'on', bannedWords: 'Alpha\nbeta', logMessageContent: 'on', contentRetainDays: '14' });
    let gc = await gcNow();
    check('saving settings writes them (with seconds stored as ms)', res.status === 303 && gc.spamMessageLimit === 7 && gc.spamIntervalMs === 9000 && gc.inviteFilterOn && !gc.wordFilterOn && gc.bannedWords === '["alpha","beta"]' && gc.contentRetainDays === 14, JSON.stringify({ s: res.status, l: gc.spamMessageLimit }));
    res = await post('/f/automod', cookie, { csrf, spamMessageLimit: '999', spamIntervalMs: '9', mentionSpamLimit: '6', contentRetainDays: '14' });
    check('out-of-range numbers are refused and nothing is saved', res.status === 400 && (await gcNow()).spamMessageLimit === 7 && (await gcNow()).inviteFilterOn);

    res = await post('/f/joinroles', cookie, { csrf, joinRoleIds: IDS.rHigh, verifyRoleId: '' });
    check('a join role above your own role is refused', res.status === 400 && /above/.test(await res.text()));
    res = await post('/f/joinroles', cookie, { csrf, joinRoleIds: IDS.rMember, verifyRoleId: IDS.rReward });
    gc = await gcNow();
    check('join roles and the verified role save', res.status === 303 && gc.joinRoleIds === JSON.stringify([IDS.rMember]) && gc.verifyRoleId === IDS.rReward);

    res = await post('/f/permissions', cookie, { csrf, perm_moderation: [IDS.rMod], perm_admin: [IDS.rAdmin] });
    const permRows = await prisma.permissionRole.findMany({ where: { guildId: IDS.guild } });
    check('permission roles save', res.status === 303 && permRows.some((p) => p.scope === 'moderation' && p.roleId === IDS.rMod) && permRows.some((p) => p.scope === 'admin' && p.roleId === IDS.rAdmin));

    const xss = '</textarea><script>alert(1)</script>';
    res = await post('/f/welcome', cookie, { csrf, welcomeChannelId: IDS.welcome, welcomeMessage: xss, goodbyeChannelId: '', goodbyeMessage: 'Bye {user}' });
    html = await (await get('/f/welcome', cookie)).text();
    check('member-written text is shown escaped, never as HTML', res.status === 303 && (await gcNow()).welcomeMessage === xss && !html.includes('<script>alert') && html.includes('&lt;/textarea&gt;&lt;script&gt;'));

    html = await (await get('/cases?q=troy', cookie)).text();
    check('the case history is searchable', /troy_target/.test(html) && /<td>#\d+<\/td>/.test(html));

    const memberLink = createLoginToken(IDS.user, IDS.guild);
    const memberCookie = ((await get(`/login?t=${memberLink}`)).headers.get('set-cookie') || '').split(';')[0];
    res = await get('/', memberCookie);
    check('a session for someone without admin rights is refused and ended', res.status === 403 && (await get('/', memberCookie)).status === 401);

    res = await post('/logout', cookie, { csrf });
    check('signing out ends the session', res.status === 200 && (await get('/', cookie)).status === 401);
    await new Promise((r2) => srv.close(r2));
    takeLog();
  }

  // ── report ──────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  out(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} failed:` : '.'}`);
  for (const f of failed) out(`  ✗ [${f.section}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  const unhandled = fake.calls.filter((c) => c.kind === 'UNHANDLED');
  if (unhandled.length) out(`\n(fake Discord had no answer for: ${[...new Set(unhandled.map((c) => `${c.method} ${c.route}`))].join(', ')})`);
  fs.writeFileSync(path.join(HERE, `results${MUSIC ? '-music' : ''}.json`), JSON.stringify(results, null, 2));
  if (hashBackup) fs.writeFileSync(realHash, hashBackup);
  else fs.rmSync(realHash, { force: true });
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  origErr('HARNESS CRASH', err);
  origErr(logBuf.slice(-20).join('\n'));
  process.exit(2);
});
