import {
  Collection,
  DMChannel,
  GuildBan,
  GuildChannel,
  GuildMember,
  Message,
  NonThreadGuildBasedChannel,
  PartialGuildMember,
  PartialMessage,
  ReadonlyCollection,
  Role,
  Snowflake,
  VoiceState,
} from 'discord.js';
import { logServerEvent } from './events';

// Event handlers for the server log. Each one only describes what happened;
// logServerEvent decides whether this server logs that kind of event.

const who = (id: string | null | undefined, tag?: string | null) =>
  id ? `<@${id}>${tag ? ` (${tag})` : ''}` : 'someone';

export async function onMessageDelete(message: Message | PartialMessage): Promise<void> {
  if (!message.guild || message.author?.bot) return;
  const attachments = message.attachments?.size
    ? `\n📎 ${message.attachments.size} attachment(s)`
    : '';
  await logServerEvent(message.guild, 'messages', {
    title: 'Message deleted',
    description: `${message.author ? who(message.author.id, message.author.tag) : 'A message (sent before I started)'} in <#${message.channelId}>${attachments}`,
    color: 'delete',
    channelId: message.channelId,
    text: message.content ? [{ name: 'Message', value: message.content }] : undefined,
  });
}

export async function onMessageUpdate(
  before: Message | PartialMessage,
  after: Message | PartialMessage,
): Promise<void> {
  if (!after.guild || after.author?.bot) return;
  // Embeds loading or pins also fire this; only text edits are worth logging.
  if (before.partial || before.content === after.content || !after.content) return;
  await logServerEvent(after.guild, 'messages', {
    title: 'Message edited',
    description: `${who(after.author?.id, after.author?.tag)} in <#${after.channelId}> · [jump to message](${after.url})`,
    color: 'update',
    channelId: after.channelId,
    text: [
      { name: 'Before', value: before.content ?? '' },
      { name: 'After', value: after.content },
    ],
  });
}

export async function onMessageDeleteBulk(
  messages: ReadonlyCollection<Snowflake, Message | PartialMessage>,
  channel: Exclude<GuildChannel, never> | { id: string; guild?: unknown },
): Promise<void> {
  const first = messages.first();
  if (!first?.guild) return;
  await logServerEvent(first.guild, 'messages', {
    title: 'Messages bulk-deleted',
    description: `${messages.size} message(s) removed from <#${channel.id}>`,
    color: 'delete',
    channelId: channel.id,
  });
}

export async function logMemberJoin(member: GuildMember): Promise<void> {
  const ageDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);
  await logServerEvent(member.guild, 'members', {
    title: 'Member joined',
    description: `${who(member.id, member.user.tag)} · member #${member.guild.memberCount}`,
    color: 'create',
    thumbnailUrl: member.user.displayAvatarURL(),
    // New accounts joining in a burst are the usual sign of a raid.
    fields: [
      {
        name: 'Account age',
        value: ageDays < 7 ? `⚠️ ${ageDays} day(s), new account` : `${ageDays} days`,
        inline: true,
      },
    ],
  });
}

export async function logMemberLeave(member: GuildMember | PartialGuildMember): Promise<void> {
  const roles = member.partial
    ? ''
    : member.roles.cache
        .filter((r) => r.id !== member.guild.id)
        .map((r) => r.toString())
        .join(' ');
  await logServerEvent(member.guild, 'members', {
    title: 'Member left',
    description: who(member.id, member.user?.tag),
    color: 'delete',
    fields: roles ? [{ name: 'Roles they had', value: roles }] : undefined,
  });
}

export async function onGuildMemberUpdate(
  before: GuildMember | PartialGuildMember,
  after: GuildMember,
): Promise<void> {
  if (before.partial) return;
  const fields: { name: string; value: string }[] = [];
  if (before.nickname !== after.nickname) {
    fields.push({
      name: 'Nickname',
      value: `${before.nickname ?? '*(none)*'} → ${after.nickname ?? '*(none)*'}`,
    });
  }
  const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
  const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
  if (added.size)
    fields.push({ name: 'Roles added', value: added.map((r) => r.toString()).join(' ') });
  if (removed.size)
    fields.push({ name: 'Roles removed', value: removed.map((r) => r.toString()).join(' ') });
  if (!fields.length) return;
  await logServerEvent(after.guild, 'memberUpdates', {
    title: 'Member updated',
    description: who(after.id, after.user.tag),
    color: 'update',
    fields,
  });
}

export async function logVoiceChange(before: VoiceState, after: VoiceState): Promise<void> {
  if (before.channelId === after.channelId) return; // mute/deafen/stream toggles
  const member = after.member ?? before.member;
  if (!member || member.user.bot) return;
  const [title, description, color] = !before.channelId
    ? ([
        'Joined voice',
        `${who(member.id, member.user.tag)} joined <#${after.channelId}>`,
        'create',
      ] as const)
    : !after.channelId
      ? ([
          'Left voice',
          `${who(member.id, member.user.tag)} left <#${before.channelId}>`,
          'delete',
        ] as const)
      : ([
          'Moved voice channel',
          `${who(member.id, member.user.tag)} moved <#${before.channelId}> → <#${after.channelId}>`,
          'info',
        ] as const);
  await logServerEvent(after.guild, 'voice', { title, description, color });
}

export async function onChannelDelete(
  channel: DMChannel | NonThreadGuildBasedChannel,
): Promise<void> {
  if (channel.isDMBased()) return;
  await logServerEvent(channel.guild, 'channels', {
    title: 'Channel deleted',
    description: `\`#${channel.name}\``,
    color: 'delete',
  });
}

export async function onChannelUpdate(
  before: DMChannel | NonThreadGuildBasedChannel,
  after: DMChannel | NonThreadGuildBasedChannel,
): Promise<void> {
  if (before.isDMBased() || after.isDMBased() || before.name === after.name) return;
  await logServerEvent(after.guild, 'channels', {
    title: 'Channel renamed',
    description: `${after}: \`#${before.name}\` → \`#${after.name}\``,
    color: 'update',
  });
}

export async function onRoleCreate(role: Role): Promise<void> {
  await logServerEvent(role.guild, 'roles', {
    title: 'Role created',
    description: `${role} (\`${role.name}\`)`,
    color: 'create',
  });
}

export async function onRoleDelete(role: Role): Promise<void> {
  await logServerEvent(role.guild, 'roles', {
    title: 'Role deleted',
    description: `\`${role.name}\``,
    color: 'delete',
  });
}

export async function onRoleUpdate(before: Role, after: Role): Promise<void> {
  const fields: { name: string; value: string }[] = [];
  if (before.name !== after.name)
    fields.push({ name: 'Name', value: `\`${before.name}\` → \`${after.name}\`` });
  if (before.permissions.bitfield !== after.permissions.bitfield) {
    const gained = after.permissions.toArray().filter((p) => !before.permissions.has(p));
    const lost = before.permissions.toArray().filter((p) => !after.permissions.has(p));
    if (gained.length) fields.push({ name: 'Permissions added', value: gained.join(', ') });
    if (lost.length) fields.push({ name: 'Permissions removed', value: lost.join(', ') });
  }
  if (!fields.length) return;
  await logServerEvent(after.guild, 'roles', {
    title: 'Role changed',
    description: `${after}`,
    color: 'update',
    fields,
  });
}

export async function onGuildBanAdd(ban: GuildBan): Promise<void> {
  await logServerEvent(ban.guild, 'bans', {
    title: 'Member banned',
    description: who(ban.user.id, ban.user.tag),
    color: 'delete',
    fields: ban.reason ? [{ name: 'Reason', value: ban.reason }] : undefined,
  });
}

export async function onGuildBanRemove(ban: GuildBan): Promise<void> {
  await logServerEvent(ban.guild, 'bans', {
    title: 'Member unbanned',
    description: who(ban.user.id, ban.user.tag),
    color: 'create',
  });
}

// Collection is re-exported for handler typings in eventHandler.ts.
export type { Collection };
