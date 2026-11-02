// The dashboard's Lists page: things that are lists rather than settings,
// which otherwise are only managed with commands.
import { Option, Shell, esc, layout } from './render';

export interface ListsData {
  responders: { id: number; trigger: string; matchType: string; response: string }[];
  tags: { id: number; name: string; content: string }[];
  rewards: { id: number; level: number; roleName: string }[];
  announcements: {
    id: number;
    channelName: string;
    title: string | null;
    content: string;
    nextRunAt: Date;
    repeat: string;
  }[];
}

const csrf = (s: Shell) => `<input type="hidden" name="csrf" value="${esc(s.csrf)}">`;
const del = (s: Shell, action: string, label = 'Remove') =>
  `<form class="inline" method="post" action="${esc(action)}">${csrf(s)}<button class="on">${esc(label)}</button></form>`;
const short = (t: string, n = 120) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const when = (d: Date) => esc(d.toISOString().slice(0, 16).replace('T', ' '));

export function listsPage(
  shell: Shell,
  data: ListsData,
  roles: Option[],
  opts: { notice?: string; error?: string },
): string {
  const banner =
    (opts.notice ? `<div class="card notice">${esc(opts.notice)}</div>` : '') +
    (opts.error
      ? `<div class="card error"><strong>Not saved:</strong> ${esc(opts.error)}</div>`
      : '');
  const table = (rows: string[], empty: string) =>
    rows.length
      ? `<table class="feat">${rows.join('')}</table>`
      : `<p class="muted">${esc(empty)}</p>`;

  const responders = table(
    data.responders.map(
      (r) =>
        `<tr><td><strong>${esc(r.trigger)}</strong> <span class="muted">(${esc(r.matchType)})</span><div class="detail">${esc(short(r.response))}</div></td><td style="text-align:right">${del(shell, `/lists/responders/${r.id}/delete`)}</td></tr>`,
    ),
    'No auto-responses yet.',
  );
  const tags = table(
    data.tags.map(
      (t) =>
        `<tr><td><strong>${esc(t.name)}</strong><div class="detail">${esc(short(t.content))}</div></td><td style="text-align:right">${del(shell, `/lists/tags/${t.id}/delete`)}</td></tr>`,
    ),
    'No tags yet.',
  );
  const rewards = table(
    data.rewards.map(
      (r) =>
        `<tr><td>Level <strong>${r.level}</strong> → @${esc(r.roleName)}</td><td style="text-align:right">${del(shell, `/lists/rewards/${r.id}/delete`)}</td></tr>`,
    ),
    'No role rewards yet.',
  );
  const announcements = table(
    data.announcements.map(
      (a) =>
        `<tr><td><strong>${esc(a.title ?? short(a.content, 60))}</strong><div class="detail">#${esc(a.channelName)} · next ${when(a.nextRunAt)} UTC · ${esc(a.repeat === 'none' ? 'once' : a.repeat)}</div></td><td style="text-align:right">${del(shell, `/lists/announcements/${a.id}/delete`, 'Cancel')}</td></tr>`,
    ),
    'Nothing scheduled. Schedule posts with /announce send … in: or repeat:.',
  );
  const roleOptions = roles
    .map((r) => `<option value="${esc(r.id)}">@${esc(r.name)}</option>`)
    .join('');

  const body = `${banner}<h1>Lists</h1>
<p class="muted">Changes here work straight away, the same as the matching commands.</p>
<div class="card"><h2>💬 Auto-responses</h2><p class="muted">The bot replies by itself when someone says a trigger phrase (needs Message Content). Up to 50.</p>${responders}
<form method="post" action="/lists/responders">${csrf(shell)}
<label for="trigger">Trigger phrase</label><input id="trigger" type="text" name="trigger" maxlength="100" required>
<label for="matchType">Match</label><select id="matchType" name="matchType"><option value="contains">anywhere in the message</option><option value="exact">the whole message</option><option value="starts">at the start</option></select>
<label for="response">Reply</label><textarea id="response" name="response" maxlength="1500" required></textarea>
<div class="actions"><button class="primary">Add or update</button></div></form></div>
<div class="card"><h2>🏷️ Tags</h2><p class="muted">Saved replies members show with /tag show.</p>${tags}
<form method="post" action="/lists/tags">${csrf(shell)}
<label for="tname">Name</label><input id="tname" type="text" name="name" maxlength="32" required>
<label for="tcontent">Content</label><textarea id="tcontent" name="content" maxlength="2000" required></textarea>
<div class="actions"><button class="primary">Add or update</button></div></form></div>
<div class="card"><h2>📈 Level role rewards</h2><p class="muted">Roles members get when they reach a level.</p>${rewards}
<form method="post" action="/lists/rewards">${csrf(shell)}
<label for="level">Level</label><input id="level" type="number" name="level" min="1" max="1000" required>
<label for="roleId">Role</label><select id="roleId" name="roleId" required>${roleOptions}</select>
<div class="actions"><button class="primary">Add or update</button></div></form></div>
<div class="card"><h2>📣 Scheduled announcements</h2>${announcements}</div>`;
  return layout('Lists', body, shell);
}
