// Server-rendered HTML for the dashboard: plain forms, no JavaScript, no
// build step. Everything that comes from Discord (server, channel and role
// names) or from members is escaped, because names are user-controlled.
import { FeatureStatus, STATE_ICON } from '../setup/status';
import { SERVER_LOG_EVENTS } from '../serverlog/events';
import { Field, FeaturePage } from './fields';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
:root{--bg:#f6f7fb;--card:#fff;--text:#1f2330;--muted:#5d6475;--line:#e3e6ee;--accent:#5865f2;--ok:#1f8b4c;--bad:#c0392b;--warn:#b7791f}
@media (prefers-color-scheme:dark){:root{--bg:#16171c;--card:#1f2128;--text:#e8e9ee;--muted:#a3a8b8;--line:#30333d;--accent:#7983f5;--ok:#43b581;--bad:#f04747;--warn:#faa61a}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text)}
header{background:var(--card);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header img{width:32px;height:32px;border-radius:50%}header .name{font-weight:600}header nav{margin-left:auto;display:flex;gap:12px;align-items:center}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
main{max-width:920px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 16px}
h1{font-size:22px;margin:4px 0 12px}h2{font-size:17px;margin:0 0 10px}
.muted{color:var(--muted)}.notice{border-left:4px solid var(--ok)}.error{border-left:4px solid var(--bad)}
table{width:100%;border-collapse:collapse}td,th{padding:8px 6px;border-top:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:13px}
.feat td:first-child{width:28px}.feat .detail{color:var(--muted);font-size:13px}
button,.btn{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:8px;padding:6px 12px;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.on{color:var(--bad)}button.off{color:var(--ok)}
form.inline{display:inline}
label{display:block;font-weight:600;margin:14px 0 4px}.help{font-weight:400;color:var(--muted);font-size:13px;display:block}
input[type=text],input[type=number],select,textarea{width:100%;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}
textarea{min-height:90px}select[multiple]{min-height:140px}
.check{display:flex;gap:8px;align-items:center;font-weight:600;margin:14px 0 4px}.check input{width:18px;height:18px}
.actions{margin-top:18px;display:flex;gap:10px;flex-wrap:wrap}
@media (max-width:600px){td.hide-sm,th.hide-sm{display:none}}
`;

export interface Shell {
  guildName: string;
  guildIconUrl: string | null;
  csrf: string;
}

export function layout(title: string, body: string, shell?: Shell): string {
  const header = shell
    ? `<header>${shell.guildIconUrl ? `<img src="${esc(shell.guildIconUrl)}" alt="">` : ''}<span class="name">${esc(shell.guildName)}</span>
<nav><a href="/">Features</a><a href="/cases">Cases</a>
<form class="inline" method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(shell.csrf)}"><button>Sign out</button></form></nav></header>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Bot dashboard</title><style>${CSS}</style></head><body>${header}<main>${body}</main></body></html>`;
}

export function messagePage(title: string, text: string): string {
  return layout(title, `<div class="card"><h1>${esc(title)}</h1><p>${esc(text)}</p></div>`);
}

function banner(notice?: string, errors?: string[]): string {
  return (
    (notice ? `<div class="card notice">${esc(notice)}</div>` : '') +
    (errors?.length
      ? `<div class="card error"><strong>Nothing was saved:</strong><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
      : '')
  );
}

export function overviewPage(
  shell: Shell,
  statuses: FeatureStatus[],
  toggles: Map<string, boolean>,
  pages: Set<string>,
  notice?: string,
  /** Turns Discord mention markup (<#id>, <@&id>) into a readable name. */
  mentionName: (kind: '#' | '@&', id: string) => string = () => '(set)',
): string {
  const groups = ['Moderation', 'Community', 'Games & fun'] as const;
  const legend = `${STATE_ICON.on} working · ${STATE_ICON.idle} not set up yet · ${STATE_ICON.off} off · ${STATE_ICON.needs} needs something`;
  const sections = groups
    .map((g) => {
      const rows = statuses
        .filter((s) => s.group === g)
        .map((s) => {
          const on = toggles.get(s.id);
          const toggle =
            on === undefined
              ? ''
              : `<form class="inline" method="post" action="/toggle/${esc(s.id)}"><input type="hidden" name="csrf" value="${esc(shell.csrf)}"><button class="${on ? 'on' : 'off'}">${on ? 'Turn off' : 'Turn on'}</button></form>`;
          const settings = pages.has(s.id)
            ? `<a class="btn" href="/f/${esc(s.id)}">Settings</a>`
            : '';
          // Details can contain Discord mention markup like <#123>; show names instead.
          const detail = s.detail.replace(/<(#|@&)(\d+)>/g, (_m, kind: '#' | '@&', id: string) =>
            mentionName(kind, id),
          );
          return `<tr><td>${STATE_ICON[s.state]}</td><td>${esc(s.emoji)} <strong>${esc(s.name)}</strong><div class="detail">${esc(detail)}</div></td><td style="white-space:nowrap;text-align:right">${settings} ${toggle}</td></tr>`;
        })
        .join('');
      return `<div class="card"><h2>${esc(g)}</h2><table class="feat">${rows}</table></div>`;
    })
    .join('');
  return layout(
    'Features',
    `${banner(notice)}<h1>Features</h1><p class="muted">${esc(legend)}. Changes take effect straight away, the same as in /setup.</p>${sections}`,
    shell,
  );
}

export interface Option {
  id: string;
  name: string;
}

export interface FormOptions {
  textChannels: Option[];
  voiceChannels: Option[];
  roles: Option[];
}

function fieldHtml(f: Field, value: unknown, opts: FormOptions): string {
  const help = f.help ? `<span class="help">${esc(f.help)}</span>` : '';
  const name = esc(f.key);
  switch (f.kind) {
    case 'channel': {
      const list = f.channelKind === 'voice' ? opts.voiceChannels : opts.textChannels;
      const optionsHtml = list
        .map(
          (c) =>
            `<option value="${esc(c.id)}"${c.id === value ? ' selected' : ''}>${f.channelKind === 'voice' ? '🔊 ' : '#'}${esc(c.name)}</option>`,
        )
        .join('');
      return `<label for="${name}">${esc(f.label)}${help}</label><select id="${name}" name="${name}"><option value="">(none)</option>${optionsHtml}</select>`;
    }
    case 'role': {
      const optionsHtml = opts.roles
        .map(
          (r) =>
            `<option value="${esc(r.id)}"${r.id === value ? ' selected' : ''}>@${esc(r.name)}</option>`,
        )
        .join('');
      return `<label for="${name}">${esc(f.label)}${help}</label><select id="${name}" name="${name}"><option value="">(none)</option>${optionsHtml}</select>`;
    }
    case 'roles':
    case 'permroles': {
      const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
      const optionsHtml = opts.roles
        .map(
          (r) =>
            `<option value="${esc(r.id)}"${selected.has(r.id) ? ' selected' : ''}>@${esc(r.name)}</option>`,
        )
        .join('');
      return `<label for="${name}">${esc(f.label)}<span class="help">${esc(f.help ?? 'Hold Ctrl (Cmd on a Mac) to pick more than one. Pick none to clear.')}</span></label><select id="${name}" name="${name}" multiple>${optionsHtml}</select>`;
    }
    case 'number': {
      const shown = typeof value === 'number' ? value / (f.scale ?? 1) : '';
      return `<label for="${name}">${esc(f.label)}${f.unit ? ` <span class="help" style="display:inline">(${esc(f.unit)})</span>` : ''}${help}</label><input id="${name}" type="number" name="${name}" min="${f.min}" max="${f.max}" value="${esc(shown)}" required>`;
    }
    case 'bool':
      return `<label class="check"><input type="checkbox" name="${name}"${value ? ' checked' : ''}> ${esc(f.label)}</label>${help}`;
    case 'text':
      return f.multiline
        ? `<label for="${name}">${esc(f.label)}${help}</label><textarea id="${name}" name="${name}" maxlength="${f.maxLength}" required>${esc(value)}</textarea>`
        : `<label for="${name}">${esc(f.label)}${help}</label><input id="${name}" type="text" name="${name}" maxlength="${f.maxLength}" value="${esc(value)}" required>`;
    case 'words': {
      const words = Array.isArray(value) ? (value as string[]).join('\n') : '';
      return `<label for="${name}">${esc(f.label)}${help}</label><textarea id="${name}" name="${name}">${esc(words)}</textarea>`;
    }
    case 'events': {
      const off = new Set(Array.isArray(value) ? (value as string[]) : []);
      return `<label>${esc(f.label)}${help}</label>${SERVER_LOG_EVENTS.map((e) => `<label class="check" style="font-weight:400"><input type="checkbox" name="${name}" value="${esc(e.key)}"${off.has(e.key) ? '' : ' checked'}> ${esc(e.label)}</label>`).join('')}`;
    }
  }
}

export function featurePage(
  shell: Shell,
  page: FeaturePage,
  values: Record<string, unknown>,
  opts: FormOptions,
  moduleOn: boolean | undefined,
  hostNotes: string[],
  notice?: string,
  errors?: string[],
): string {
  const toggle =
    moduleOn === undefined
      ? ''
      : `<form class="inline" method="post" action="/toggle/${esc(page.moduleId)}?back=${esc(page.id)}"><input type="hidden" name="csrf" value="${esc(shell.csrf)}"><button class="${moduleOn ? 'on' : 'off'}">${moduleOn ? 'Turn off' : 'Turn on'}</button></form>`;
  const notes = hostNotes.length
    ? `<div class="card" style="border-left:4px solid var(--warn)"><strong>Needs the bot's host:</strong> ${hostNotes.map(esc).join(' ')}</div>`
    : '';
  const fields = page.fields.map((f) => fieldHtml(f, values[f.key], opts)).join('');
  const body = `${banner(notice, errors)}<p><a href="/">← All features</a></p>
<div class="card"><h1>${esc(page.emoji)} ${esc(page.title)}</h1><p class="muted">${esc(page.why)}</p>
${moduleOn === undefined ? '' : `<p><strong>Status:</strong> ${moduleOn ? '✅ on' : '⬜ off'} ${toggle}</p>`}</div>${notes}
<form class="card" method="post" action="/f/${esc(page.id)}"><input type="hidden" name="csrf" value="${esc(shell.csrf)}">${fields}
<div class="actions"><button class="primary">Save</button><a class="btn" href="/">Cancel</a></div></form>`;
  return layout(page.title, body, shell);
}

export interface CaseRow {
  caseNumber: number;
  type: string;
  targetTag: string;
  targetId: string;
  moderatorTag: string;
  reason: string | null;
  createdAt: Date;
}

export function casesPage(shell: Shell, cases: CaseRow[], query: string): string {
  const rows = cases
    .map(
      (c) =>
        `<tr><td>#${c.caseNumber}</td><td>${esc(c.type)}</td><td>${esc(c.targetTag)}<div class="muted" style="font-size:12px">${esc(c.targetId)}</div></td><td class="hide-sm">${esc(c.moderatorTag)}</td><td>${esc(c.reason ?? '—')}</td><td class="hide-sm">${esc(c.createdAt.toISOString().slice(0, 16).replace('T', ' '))}</td></tr>`,
    )
    .join('');
  const body = `<h1>Case history</h1>
<form class="card" method="get" action="/cases"><label for="q">Find a member (name or ID)</label><input id="q" type="text" name="q" value="${esc(query)}" maxlength="100"><div class="actions"><button class="primary">Search</button><a class="btn" href="/cases">Clear</a></div></form>
<div class="card">${cases.length ? `<table><tr><th>Case</th><th>Action</th><th>Member</th><th class="hide-sm">Moderator</th><th>Reason</th><th class="hide-sm">When (UTC)</th></tr>${rows}</table>` : '<p class="muted">No cases found.</p>'}</div>`;
  return layout('Cases', body, shell);
}
