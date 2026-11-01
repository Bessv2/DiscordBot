// A fake Discord for driving the real bot code end to end. Only the
// network layer is replaced: the real discord.js client, structures,
// collectors and permission maths all run. Every REST call the bot makes is
// recorded and answered with a plausible Discord response.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const djs = require(`${ROOT}/node_modules/discord.js`);
const { PermissionFlagsBits: P } = djs;

// Snowflakes carry their creation time, and discord.js reads it from them
// (e.g. message age for /purge), so fake IDs are minted from the real clock.
let seq = 0n;
const DISCORD_EPOCH = 1420070400000n;
const snow = () => String(((BigInt(Date.now()) - DISCORD_EPOCH) << 22n) | (++seq & 0x3fffffn));

const IDS = {
  guild: '900000000000000001',
  bot: '900000000000000002',
  owner: '900000000000000003',
  admin: '900000000000000004',
  mod: '900000000000000005',
  user: '900000000000000006',
  target: '900000000000000007',
  user2: '900000000000000008',
  // roles
  everyone: '900000000000000001',
  rMember: '900000000000000011',
  rMod: '900000000000000012',
  rAdmin: '900000000000000013',
  rBot: '900000000000000014',
  rHigh: '900000000000000015', // above the bot: must be refused for auto-assign
  rReward: '900000000000000016',
  // channels
  general: '900000000000000021',
  modlog: '900000000000000022',
  voice: '900000000000000023',
  stars: '900000000000000024',
  welcome: '900000000000000025',
  appeals: '900000000000000026',
};

const perm = (...bits) => String(bits.reduce((a, b) => a | b, 0n));
const BOT_PERMS = perm(
  P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.AddReactions, P.ManageMessages,
  P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageRoles, P.ManageChannels, P.CreateInstantInvite,
  P.SendPolls, P.Connect, P.Speak, P.ManageGuild,
);
const roles = [
  { id: IDS.everyone, name: '@everyone', position: 0, permissions: perm(P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AddReactions, P.Connect, P.Speak, P.UseApplicationCommands) },
  { id: IDS.rMember, name: 'Member', position: 1, permissions: '0' },
  { id: IDS.rReward, name: 'Regular', position: 2, permissions: '0' },
  { id: IDS.rMod, name: 'Mods', position: 3, permissions: perm(P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageMessages) },
  { id: IDS.rAdmin, name: 'Admins', position: 4, permissions: perm(P.Administrator) },
  { id: IDS.rBot, name: 'Bot', position: 5, permissions: BOT_PERMS, managed: true, tags: { bot_id: IDS.bot } },
  { id: IDS.rHigh, name: 'Owners Club', position: 6, permissions: '0' },
].map((r) => ({ color: 0, hoist: false, managed: false, mentionable: false, flags: 0, ...r }));

const user = (id, username, bot = false) => ({ id, username, global_name: username, discriminator: '0', avatar: null, bot });
const USERS = {
  [IDS.bot]: user(IDS.bot, 'ModBot', true),
  [IDS.owner]: user(IDS.owner, 'owner'),
  [IDS.admin]: user(IDS.admin, 'alice_admin'),
  [IDS.mod]: user(IDS.mod, 'mo_mod'),
  [IDS.user]: user(IDS.user, 'uma_user'),
  [IDS.target]: user(IDS.target, 'troy_target'),
  [IDS.user2]: user(IDS.user2, 'ben_buddy'),
};
const memberRoles = {
  [IDS.bot]: [IDS.rBot],
  [IDS.owner]: [],
  [IDS.admin]: [IDS.rAdmin],
  [IDS.mod]: [IDS.rMod],
  [IDS.user]: [IDS.rMember],
  [IDS.target]: [IDS.rMember],
  [IDS.user2]: [IDS.rMember],
};
const memberRaw = (id) => ({ user: USERS[id], roles: [...memberRoles[id]], joined_at: '2026-01-01T00:00:00.000Z', deaf: false, mute: false, flags: 0, nick: null, communication_disabled_until: null });
const chan = (id, name, type = 0, extra = {}) => ({ id, name, type, guild_id: IDS.guild, position: 0, permission_overwrites: [], nsfw: false, parent_id: null, ...extra });

function computeMemberPerms(id, channelId) {
  if (id === IDS.owner) return perm(P.Administrator);
  const r = [IDS.everyone, ...memberRoles[id]].map((rid) => roles.find((x) => x.id === rid));
  let bits = r.reduce((a, x) => a | BigInt(x.permissions), 0n);
  if (bits & P.Administrator) return String(bits | 0xffffffffffffn);
  return String(bits);
}

class FakeDiscord {
  constructor() {
    this.calls = [];
    this.messages = new Map(); // id -> raw message
    this.pending = 0;
    this.lastActivity = Date.now();
    this.dmChannels = new Map();
    this.attachments = new Map(); // url -> body
    this.extraChannels = new Map(); // threads and channels the bot created
    this.bans = new Map(); // userId -> reason
  }

  install(client) {
    this.client = client;
    client.rest.request = (opts) => this.handle(opts);
    // Attachment downloads (trivia import) go through global fetch.
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      if (this.attachments.has(String(url))) {
        return new Response(this.attachments.get(String(url)), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return realFetch(url, init);
    };
    client.user = new djs.ClientUser(client, USERS[IDS.bot]);
    client.application = new djs.ClientApplication(client, { id: IDS.bot, name: 'ModBot', flags: 0 });
    client.guilds._add({
      id: IDS.guild,
      name: 'Test Server',
      owner_id: IDS.owner,
      icon: null,
      features: [],
      roles,
      emojis: [],
      stickers: [],
      channels: [
        chan(IDS.general, 'general'),
        chan(IDS.modlog, 'mod-log'),
        chan(IDS.stars, 'starboard'),
        chan(IDS.welcome, 'welcome'),
        chan(IDS.appeals, 'appeals'),
        chan(IDS.voice, 'Voice Lounge', 2, { bitrate: 64000, user_limit: 0 }),
      ],
      members: Object.keys(USERS).map(memberRaw),
      voice_states: [
        { user_id: IDS.admin, channel_id: IDS.voice, session_id: 's1', deaf: false, mute: false, self_deaf: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null },
        { user_id: IDS.user, channel_id: IDS.voice, session_id: 's2', deaf: false, mute: false, self_deaf: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null },
      ],
      member_count: 7,
      verification_level: 1,
      premium_tier: 0,
      preferred_locale: 'en-US',
      system_channel_flags: 0,
      nsfw_level: 0,
      mfa_level: 0,
      explicit_content_filter: 0,
      default_message_notifications: 0,
      afk_timeout: 300,
      large: false,
      unavailable: false,
      joined_at: '2026-01-01T00:00:00.000Z',
    });
  }

  get guild() {
    return this.client.guilds.cache.get(IDS.guild);
  }

  record(method, route, body) {
    const c = { method, route, body };
    this.calls.push(c);
    return c;
  }

  callsSince(mark) {
    return this.calls.slice(mark);
  }

  msg(channelId, body, extra = {}) {
    const id = snow();
    const m = {
      id,
      channel_id: channelId,
      guild_id: this.dmChannels.has(channelId) ? undefined : IDS.guild,
      author: USERS[IDS.bot],
      content: body?.content ?? '',
      embeds: body?.embeds ?? [],
      components: body?.components ?? [],
      attachments: [],
      mentions: [],
      mention_roles: [],
      mention_everyone: false,
      pinned: false,
      tts: false,
      type: 0,
      flags: body?.flags ?? 0,
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      reactions: [],
      ...(body?.poll ? { poll: { ...body.poll, expiry: new Date(Date.now() + 3600e3).toISOString(), results: { is_finalized: false, answer_counts: [] }, answers: body.poll.answers.map((a, i) => ({ answer_id: i + 1, poll_media: a.poll_media ?? a })) } } : {}),
      ...extra,
    };
    this.messages.set(id, m);
    return m;
  }

  async handle(opts) {
    this.pending++;
    this.lastActivity = Date.now();
    try {
      // Real Discord only ever sees JSON, so normalise bodies the same way
      // (e.g. PermissionsBitField → "0") and decode the route like a URL.
      const body = opts.body === undefined ? undefined : JSON.parse(JSON.stringify(opts.body));
      return await this.route(opts.method, decodeURIComponent(opts.fullRoute), body, opts);
    } finally {
      this.pending--;
      this.lastActivity = Date.now();
    }
  }

  async route(method, route, body, opts) {
    const c = this.record(method, route, body);
    if (opts.files?.length) c.files = opts.files.map((f) => ({ name: f.name, size: f.data?.length ?? 0, text: Buffer.isBuffer(f.data) ? f.data.toString('utf8') : String(f.data) }));
    let m;
    // interaction callback
    if ((m = route.match(/^\/interactions\/(\d+)\/([^/]+)\/callback$/))) {
      c.kind = 'callback';
      c.interactionId = m[1];
      const data = body?.data;
      if (body?.type === 4 || body?.type === 7 || body?.type === 5 || body?.type === 6) {
        // reply/update/defer: remember the "original" message per token
        const orig = this.msg(IDS.general, { ...(data ?? {}), flags: data?.flags ?? 0 }, { interaction_metadata: this.metaFor?.(m[1]) });
        this.originals = this.originals ?? new Map();
        if (body.type === 4 || body.type === 5 || !this.originals.has(m[2])) this.originals.set(m[2], orig);
        else Object.assign(this.originals.get(m[2]), data ?? {});
      }
      return opts.query?.get?.('with_response') === 'true' ? { interaction: { id: m[1], type: 2 }, resource: { type: body.type, message: this.originals?.get(m[2]) } } : undefined;
    }
    if ((m = route.match(/^\/webhooks\/(\d+)\/([^/]+)\/messages\/@original$/))) {
      c.kind = method === 'GET' ? 'fetchReply' : 'editReply';
      const orig = this.originals?.get(m[2]) ?? this.msg(IDS.general, {});
      if (method === 'PATCH') Object.assign(orig, body ?? {});
      return orig;
    }
    if ((m = route.match(/^\/webhooks\/(\d+)\/([^/]+)$/)) && method === 'POST') {
      c.kind = 'followUp';
      return this.msg(IDS.general, body);
    }
    if ((m = route.match(/^\/channels\/(\d+)\/messages\/bulk-delete$/)) && method === 'POST') {
      c.kind = 'bulkDelete';
      return undefined;
    }
    if ((m = route.match(/^\/channels\/(\d+)\/messages$/)) && method === 'GET') {
      const limit = Number(opts.query?.get?.('limit') ?? 50);
      return [...this.messages.values()].filter((x) => x.channel_id === m[1]).sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)).slice(0, limit);
    }
    if ((m = route.match(/^\/channels\/(\d+)\/threads$/)) && method === 'POST') {
      c.kind = 'threadCreate';
      const t = { id: snow(), type: body.type ?? 12, guild_id: IDS.guild, parent_id: m[1], name: body.name, owner_id: IDS.bot, member_count: 1, message_count: 0, rate_limit_per_user: 0,
        thread_metadata: { archived: false, locked: false, auto_archive_duration: 1440, archive_timestamp: new Date().toISOString(), invitable: body.invitable ?? false } };
      this.extraChannels.set(t.id, t);
      return t;
    }
    if ((m = route.match(/^\/channels\/(\d+)\/thread-members\/(\d+)$/))) {
      c.kind = method === 'PUT' ? 'threadMemberAdd' : 'threadMemberRemove';
      return undefined;
    }
    if ((m = route.match(/^\/channels\/(\d+)$/)) && method === 'PATCH') {
      c.kind = 'channelEdit';
      const existing = this.extraChannels.get(m[1]);
      if (existing) {
        if (body.archived !== undefined || body.locked !== undefined) Object.assign(existing.thread_metadata, { ...(body.archived !== undefined ? { archived: body.archived } : {}), ...(body.locked !== undefined ? { locked: body.locked } : {}) });
        Object.assign(existing, { ...body, thread_metadata: existing.thread_metadata });
        return existing;
      }
      const ch = this.guild.channels.cache.get(m[1]);
      return { ...chan(m[1], ch?.name ?? 'x', ch?.type ?? 0), ...body };
    }
    if ((m = route.match(/^\/channels\/(\d+)$/)) && method === 'DELETE') {
      c.kind = 'channelDelete';
      const ch = this.extraChannels.get(m[1]) ?? chan(m[1], 'x', 2);
      this.extraChannels.delete(m[1]);
      return ch;
    }
    if ((m = route.match(/^\/guilds\/(\d+)\/channels$/)) && method === 'POST') {
      c.kind = 'guildChannelCreate';
      const ch = chan(snow(), body.name, body.type ?? 0, { parent_id: body.parent_id ?? null, permission_overwrites: body.permission_overwrites ?? [], bitrate: 64000, user_limit: 0 });
      this.extraChannels.set(ch.id, ch);
      return ch;
    }
    if ((m = route.match(/^\/channels\/(\d+)\/messages$/)) && method === 'POST') {
      c.kind = 'send';
      c.channelId = m[1];
      return this.msg(m[1], body);
    }
    if ((m = route.match(/^\/channels\/(\d+)\/messages\/(\d+)$/))) {
      if (method === 'GET') {
        const found = this.messages.get(m[2]);
        if (!found) throw new djs.DiscordAPIError({ code: 10008, message: 'Unknown Message' }, 10008, 404, 'GET', route, {});
        return found;
      }
      if (method === 'PATCH') {
        c.kind = 'edit';
        const found = this.messages.get(m[2]) ?? this.msg(m[1], {});
        Object.assign(found, body ?? {});
        return found;
      }
      if (method === 'DELETE') {
        c.kind = 'delete';
        return undefined;
      }
    }
    if (route.match(/^\/channels\/\d+\/messages\/\d+\/reactions\//)) {
      c.kind = 'react';
      return undefined;
    }
    if ((m = route.match(/^\/channels\/(\d+)\/invites$/)) && method === 'POST') {
      c.kind = 'invite';
      const code = 'jamAbC123';
      return {
        code,
        type: 0,
        channel: { id: m[1], name: 'Voice Lounge', type: 2 },
        guild: { id: IDS.guild, name: 'Test Server' },
        target_type: body.target_type,
        target_application: { id: body.target_application_id, name: 'Watch Together' },
        max_age: body.max_age,
        uses: 0,
        max_uses: 0,
        temporary: false,
        created_at: new Date().toISOString(),
        inviter: USERS[IDS.bot],
      };
    }
    if ((m = route.match(/^\/channels\/(\d+)\/permissions\/(\d+)$/))) {
      c.kind = 'overwrite';
      return undefined;
    }
    if ((m = route.match(/^\/channels\/(\d+)$/)) && method === 'GET') {
      if (this.extraChannels.has(m[1])) return this.extraChannels.get(m[1]);
      const ch = this.guild.channels.cache.get(m[1]);
      if (!ch) throw new djs.DiscordAPIError({ code: 10003, message: 'Unknown Channel' }, 10003, 404, 'GET', route, {});
      return { ...chan(ch.id, ch.name, ch.type) };
    }
    if (route === '/users/@me/channels' && method === 'POST') {
      c.kind = 'openDM';
      const id = `77${body.recipient_id.slice(2)}`;
      this.dmChannels.set(id, body.recipient_id);
      return { id, type: 1, recipients: [USERS[body.recipient_id]], last_message_id: null };
    }
    if ((m = route.match(/^\/users\/(\d+)$/))) {
      return USERS[m[1]] ?? user(m[1], `user${m[1].slice(-3)}`);
    }
    if ((m = route.match(/^\/guilds\/(\d+)\/members\/(\d+)\/roles\/(\d+)$/))) {
      c.kind = method === 'PUT' ? 'roleAdd' : 'roleRemove';
      const list = memberRoles[m[2]];
      if (list) {
        if (method === 'PUT' && !list.includes(m[3])) list.push(m[3]);
        if (method === 'DELETE') memberRoles[m[2]] = list.filter((r) => r !== m[3]);
      }
      return undefined;
    }
    if ((m = route.match(/^\/guilds\/(\d+)\/members\/(\d+)$/))) {
      if (method === 'GET') {
        if (!USERS[m[2]]) throw new djs.DiscordAPIError({ code: 10007, message: 'Unknown Member' }, 10007, 404, 'GET', route, {});
        return memberRaw(m[2]);
      }
      if (method === 'DELETE') {
        c.kind = 'kick';
        return undefined;
      }
      if (method === 'PATCH') {
        c.kind = body?.communication_disabled_until !== undefined ? 'timeout' : body?.channel_id !== undefined ? 'move' : 'memberEdit';
        return { ...memberRaw(m[2]), ...body };
      }
    }
    if ((m = route.match(/^\/guilds\/(\d+)\/members$/)) && method === 'GET') {
      return Object.keys(USERS).map(memberRaw);
    }
    if ((m = route.match(/^\/guilds\/(\d+)\/channels$/)) && method === 'GET') {
      return [...this.guild.channels.cache.values()].map((ch) => chan(ch.id, ch.name, ch.type));
    }
    if ((m = route.match(/^\/guilds\/(\d+)\/bans\/(\d+)$/))) {
      if (method === 'GET') {
        if (!this.bans.has(m[2])) throw new djs.DiscordAPIError({ code: 10026, message: 'Unknown Ban' }, 10026, 404, 'GET', route, {});
        return { user: USERS[m[2]], reason: this.bans.get(m[2]) };
      }
      c.kind = method === 'PUT' ? 'ban' : 'unban';
      if (method === 'PUT') this.bans.set(m[2], opts.reason ?? null);
      else this.bans.delete(m[2]);
      return undefined;
    }
    if ((m = route.match(/^\/guilds\/(\d+)\/roles$/))) {
      if (method === 'POST') {
        c.kind = 'roleCreate';
        const r = { id: snow(), name: body.name, position: 1, permissions: String(body.permissions ?? '0'), color: 0, hoist: false, managed: false, mentionable: false, flags: 0 };
        roles.push(r);
        return r;
      }
      return roles;
    }
    if ((m = route.match(/^\/guilds\/(\d+)\/roles\/(\d+)$/)) && method === 'GET') {
      return roles.find((r) => r.id === m[2]);
    }
    if ((m = route.match(/^\/guilds\/(\d+)$/))) {
      if (method === 'PATCH') {
        c.kind = 'guildEdit';
        return { ...this.guildRaw(), ...body };
      }
      return this.guildRaw();
    }
    if ((m = route.match(/^\/applications\/(\d+)\/commands$/)) && method === 'PUT') {
      c.kind = 'commandsSet';
      return body.map((b, i) => ({ ...b, id: String(5000 + i), application_id: IDS.bot, version: '1', type: 1 }));
    }
    if ((m = route.match(/^\/applications\/(\d+)\/guilds\/(\d+)\/commands$/)) && method === 'PUT') {
      c.kind = 'commandsSet';
      return body.map((b, i) => ({ ...b, id: String(6000 + i), application_id: IDS.bot, guild_id: m[2], version: '1', type: 1 }));
    }
    c.kind = 'UNHANDLED';
    console.log(`   [fake discord] unhandled route ${method} ${route}`);
    return {};
  }

  guildRaw() {
    return { id: IDS.guild, name: 'Test Server', owner_id: IDS.owner, roles, emojis: [], features: [], verification_level: this.guild?.verificationLevel ?? 1 };
  }

  /** Waits until the bot has made no REST call for `quietMs`. */
  async settle(quietMs = 150, maxMs = 8000) {
    const start = Date.now();
    // Count from now, so a dispatch always gets at least quietMs to start working.
    this.lastActivity = Math.max(this.lastActivity, start);
    await new Promise((r) => setTimeout(r, 20));
    while (Date.now() - start < maxMs) {
      if (this.pending === 0 && Date.now() - this.lastActivity >= quietMs) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

module.exports = { FakeDiscord, IDS, USERS, memberRaw, memberRoles, computeMemberPerms, snow, chan, roles, perm };
