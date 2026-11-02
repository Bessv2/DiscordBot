// The dashboard's Add-ons page: what's connected, a form to add more, and
// the status of the API keys the host can set in .env.
import { ADDON_KINDS, AddonKind } from '../addons/parse';
import { Option, Shell, esc, layout } from './render';

export interface AddonRow {
  id: number;
  kind: string;
  name: string;
  channelName: string;
  target: string;
  enabled: boolean;
  lastCheckedAt: Date | null;
  lastError: string | null;
}

export interface ApiStatus {
  name: string;
  configured: boolean;
  powers: string;
  env: string;
  getKey: string;
}

const csrfInput = (shell: Shell) => `<input type="hidden" name="csrf" value="${esc(shell.csrf)}">`;

function statusOf(a: AddonRow): string {
  if (!a.enabled) return '⏸️ paused';
  if (a.lastError) return `⚠️ ${esc(a.lastError)}`;
  if (a.kind === 'webhook')
    return a.lastCheckedAt
      ? `✅ last message ${esc(a.lastCheckedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC`
      : '◽ waiting for its first message';
  return a.lastCheckedAt
    ? `✅ checked ${esc(a.lastCheckedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC`
    : '◽ not checked yet';
}

export function addonsPage(
  shell: Shell,
  addons: AddonRow[],
  channels: Option[],
  roles: Option[],
  apis: ApiStatus[],
  opts: {
    moduleOn: boolean;
    notice?: string;
    error?: string;
    newHook?: { id: number; name: string; url: string };
  },
): string {
  const kindInfo = (k: string) => ADDON_KINDS.find((x) => x.kind === (k as AddonKind));
  const banner =
    (opts.notice ? `<div class="card notice">${esc(opts.notice)}</div>` : '') +
    (opts.error
      ? `<div class="card error"><strong>Not added:</strong> ${esc(opts.error)}</div>`
      : '') +
    (opts.newHook
      ? `<div class="card notice"><strong>Webhook "${esc(opts.newHook.name)}" is ready.</strong> Send messages to this address. It's shown <strong>only now</strong>, so copy it somewhere safe; anyone who has it can post in your channel.
<p><input type="text" readonly value="${esc(opts.newHook.url)}"></p>
<p class="muted">It accepts the same JSON as a Discord webhook, e.g. <code>{"content": "Server restarted"}</code>, or plain text. Whatever sends to it must be able to reach this dashboard's address.</p></div>`
      : '') +
    (opts.moduleOn
      ? ''
      : '<div class="card error">Add-ons are switched off for this server, so nothing below is posting. Turn them on from the Features page.</div>');

  const rows = addons
    .map((a) => {
      const k = kindInfo(a.kind);
      return `<tr><td>${esc(k?.emoji ?? '')} <strong>${esc(a.name)}</strong> <span class="muted">#${a.id}</span><div class="detail">${esc(k?.label ?? a.kind)}${a.target ? ` · ${esc(a.target.replace(/\|/g, ' · '))}` : ''}</div></td>
<td class="hide-sm">#${esc(a.channelName)}</td><td><div class="detail">${statusOf(a)}</div></td>
<td style="white-space:nowrap;text-align:right">
${a.kind === 'webhook' ? '' : `<form class="inline" method="post" action="/addons/${a.id}/test">${csrfInput(shell)}<button>Check now</button></form>`}
<form class="inline" method="post" action="/addons/${a.id}/toggle">${csrfInput(shell)}<button class="${a.enabled ? 'on' : 'off'}">${a.enabled ? 'Pause' : 'Resume'}</button></form>
<form class="inline" method="post" action="/addons/${a.id}/delete">${csrfInput(shell)}<button class="on">Remove</button></form></td></tr>`;
    })
    .join('');

  const kindOptions = ADDON_KINDS.map(
    (k) => `<option value="${k.kind}">${esc(k.emoji)} ${esc(k.label)}</option>`,
  ).join('');
  const help = ADDON_KINDS.map(
    (k) =>
      `<li><strong>${esc(k.emoji)} ${esc(k.label)}:</strong> ${esc(k.help)}${k.target ? ` <em>Target: ${esc(k.target)}.</em>` : ' No target needed.'}</li>`,
  ).join('');
  const channelOptions = channels
    .map((c) => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`)
    .join('');
  const roleOptions = roles
    .map((r) => `<option value="${esc(r.id)}">@${esc(r.name)}</option>`)
    .join('');

  const apiRows = apis
    .map(
      (a) =>
        `<tr><td>${a.configured ? '✅' : '⬜'}</td><td><strong>${esc(a.name)}</strong><div class="detail">${esc(a.powers)}</div></td><td><div class="detail">${a.configured ? 'Connected.' : `Not set. The host adds <code>${esc(a.env)}</code> to <code>.env</code> and restarts the bot. ${esc(a.getKey)}`}</div></td></tr>`,
    )
    .join('');

  const body = `${banner}<h1>Add-ons</h1>
<p class="muted">Have the bot post from other places: news feeds and patch notes, Steam game news, Epic free games, your game server going up or down, and other apps through webhooks. Up to 25 per server. In Discord: <code>/addons</code>.</p>
<div class="card"><h2>Connected</h2>${addons.length ? `<table class="feat">${rows}</table>` : '<p class="muted">Nothing yet. Add one below.</p>'}</div>
<form class="card" method="post" action="/addons">${csrfInput(shell)}<h2>Add one</h2>
<label for="kind">Type</label><select id="kind" name="kind" required>${kindOptions}</select>
<label for="target">Target<span class="help">Feed address, Steam app ID, or game|host|port. Leave empty for Epic free games and webhooks.</span></label><input id="target" type="text" name="target" maxlength="500">
<label for="channelId">Post in</label><select id="channelId" name="channelId" required>${channelOptions}</select>
<label for="name">Name (optional)</label><input id="name" type="text" name="name" maxlength="80">
<label for="mentionRoleId">Ping a role with each post (optional)</label><select id="mentionRoleId" name="mentionRoleId"><option value="">(no ping)</option>${roleOptions}</select>
<div class="actions"><button class="primary">Add</button></div>
<ul class="muted" style="margin-top:16px">${help}</ul></form>
<div class="card"><h2>Connected APIs</h2><p class="muted">These need a key from the service, which only the bot's host can add (keys stay in <code>.env</code>, never in the database). Everything else on this page needs no key.</p><table class="feat">${apiRows}</table></div>`;
  return layout('Add-ons', body, shell);
}
