// Ban sharing for servers that trust each other and run on this same bot:
// a server creates a network and gets a join code; other servers join with
// it. When someone is banned in one member server, each other member either
// gets an alert in its mod-log with a "Ban here too" button (the default),
// or, if it chose "ban", the bot bans them there as well.
//
// Nothing leaves this bot: there's no central list and no outside service.
// Only servers on the same bot instance can share (by design, PROJECT.md §5).
import { createHash, randomBytes } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GuildBan,
  PermissionFlagsBits,
} from 'discord.js';
import { prisma, getOrCreateGuildConfig } from '../lib/db';
import { logger } from '../lib/logger';
import { isModuleEnabledForGuild } from '../lib/modules';
import { banMember } from '../lib/moderationActions';
import { memberHasPermission } from '../lib/permissions';
import { resolveModLogChannel } from '../lib/modlog';

export const SHARED_PREFIX = 'Shared ban from';
export type NetworkMode = 'alert' | 'ban';

const hashCode = (code: string) => createHash('sha256').update(code.trim()).digest('hex');

/** Bans the network itself made must not be shared again (that would loop). */
export function isSharedBan(reason: string | null | undefined): boolean {
  return (reason ?? '').startsWith(SHARED_PREFIX);
}

export function sharedReason(sourceName: string, reason: string | null): string {
  return `${SHARED_PREFIX} ${sourceName}: ${reason || 'no reason given'}`.slice(0, 512);
}

// Discord can deliver the same ban event twice, and a ban plus its manual
// copy elsewhere shouldn't alert twice: remember what was shared recently.
const recent = new Map<string, number>();
export function firstShare(networkId: number, userId: string, now = Date.now()): boolean {
  for (const [k, t] of recent) if (now - t > 10 * 60_000) recent.delete(k);
  const key = `${networkId}:${userId}`;
  if (recent.has(key)) return false;
  recent.set(key, now);
  return true;
}

export async function createNetwork(
  guildId: string,
  name: string,
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  if (await prisma.banNetworkMember.findUnique({ where: { guildId } }))
    return {
      ok: false,
      error: 'This server is already in a ban network. Leave it first with `/bannetwork leave`.',
    };
  await getOrCreateGuildConfig(guildId);
  const code = `ban-${randomBytes(12).toString('base64url')}`;
  await prisma.banNetwork.create({
    data: {
      name: name.trim().slice(0, 60) || 'Ban network',
      joinCodeHash: hashCode(code),
      ownerGuildId: guildId,
      members: { create: { guildId, mode: 'alert' } },
    },
  });
  return { ok: true, code };
}

export async function joinNetwork(
  guildId: string,
  code: string,
  mode: NetworkMode,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (await prisma.banNetworkMember.findUnique({ where: { guildId } }))
    return {
      ok: false,
      error: 'This server is already in a ban network. Leave it first with `/bannetwork leave`.',
    };
  const network = await prisma.banNetwork.findUnique({ where: { joinCodeHash: hashCode(code) } });
  if (!network)
    return { ok: false, error: "That join code doesn't match any network on this bot." };
  await getOrCreateGuildConfig(guildId);
  await prisma.banNetworkMember.create({ data: { guildId, networkId: network.id, mode } });
  return { ok: true, name: network.name };
}

export async function leaveNetwork(guildId: string): Promise<string | null> {
  const m = await prisma.banNetworkMember.findUnique({
    where: { guildId },
    include: { network: true },
  });
  if (!m) return null;
  await prisma.banNetworkMember.delete({ where: { guildId } });
  if ((await prisma.banNetworkMember.count({ where: { networkId: m.networkId } })) === 0)
    await prisma.banNetwork.delete({ where: { id: m.networkId } }).catch(() => undefined);
  return m.network.name;
}

/** guildBanAdd: share a ban with the rest of the server's network. */
export async function onBanForNetwork(ban: GuildBan): Promise<void> {
  const source = ban.guild;
  const membership = await prisma.banNetworkMember.findUnique({
    where: { guildId: source.id },
    include: { network: { include: { members: true } } },
  });
  if (!membership || !(await isModuleEnabledForGuild(source.id, 'bannetwork'))) return;
  const reason =
    ban.reason ??
    (await source.bans.fetch({ user: ban.user.id, force: true }).catch(() => null))?.reason ??
    null;
  if (isSharedBan(reason) || !firstShare(membership.networkId, ban.user.id)) return;
  const client = source.client;
  for (const other of membership.network.members) {
    if (other.guildId === source.id) continue;
    const guild = client.guilds.cache.get(other.guildId);
    if (!guild || !(await isModuleEnabledForGuild(guild.id, 'bannetwork'))) continue;
    if (await guild.bans.fetch({ user: ban.user.id, force: true }).catch(() => null)) continue;
    try {
      if (other.mode === 'ban') {
        const me = await guild.members.fetchMe();
        const result = await banMember(
          guild,
          me,
          ban.user,
          client.user!,
          sharedReason(source.name, reason),
          0,
        );
        if (!result.ok)
          await alert(
            client,
            guild.id,
            source.name,
            ban,
            reason,
            `Couldn't ban automatically: ${result.message}`,
          );
      } else {
        await alert(client, guild.id, source.name, ban, reason);
      }
    } catch (err) {
      logger.warn(
        `Ban network: sharing a ban to ${guild.id} failed: ${(err as Error).message}`,
        "Check the bot's Ban Members permission and its mod-log channel in that server.",
      );
    }
  }
}

async function alert(
  client: Client,
  guildId: string,
  sourceName: string,
  ban: GuildBan,
  reason: string | null,
  problem?: string,
): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = await resolveModLogChannel(guild);
  if (!channel) return;
  const here = await guild.members.fetch(ban.user.id).catch(() => null);
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🔗 Banned in a server you share bans with')
    .setDescription(
      `${ban.user} (${ban.user.tag}, \`${ban.user.id}\`) was banned in **${sourceName}**.`,
    )
    .addFields(
      { name: 'Their reason', value: (reason || 'no reason given').slice(0, 1024) },
      {
        name: 'In this server?',
        value: here
          ? 'Yes, they are a member here.'
          : 'Not a member right now (a ban here would stop them joining).',
      },
      ...(problem ? [{ name: '⚠️', value: problem.slice(0, 1024) }] : []),
    )
    .setTimestamp(new Date());
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bannet_ban:${ban.user.id}`)
      .setLabel('Ban here too')
      .setStyle(ButtonStyle.Danger),
  );
  await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
}

/** The "Ban here too" button on an alert: a moderator's decision, done as a normal ban. */
export async function handleNetworkBanButton(i: ButtonInteraction<'cached'>): Promise<void> {
  if (!(await isModuleEnabledForGuild(i.guildId, 'bannetwork'))) {
    await i.reply({ content: 'Ban sharing is switched off in this server.', ephemeral: true });
    return;
  }
  if (!(await memberHasPermission(i.member, 'moderation', PermissionFlagsBits.BanMembers))) {
    await i.reply({ content: "You don't have permission to ban here.", ephemeral: true });
    return;
  }
  const userId = i.customId.split(':')[1] ?? '';
  const user = await i.client.users.fetch(userId).catch(() => null);
  if (!user) {
    await i.reply({ content: "I can't find that user any more.", ephemeral: true });
    return;
  }
  const source =
    i.message.embeds[0]?.description?.match(/banned in \*\*(.+)\*\*/)?.[1] ?? 'another server';
  const reason = i.message.embeds[0]?.fields.find((f) => f.name === 'Their reason')?.value ?? null;
  const result = await banMember(i.guild, i.member, user, i.user, sharedReason(source, reason), 0);
  if (!result.ok) {
    await i.reply({ content: `⚠️ ${result.message}`, ephemeral: true });
    return;
  }
  await i.update({ components: [] });
  await i.followUp({ content: `✅ ${result.message}`, ephemeral: true });
}
