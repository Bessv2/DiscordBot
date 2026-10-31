import { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } from 'discord.js';
import { prisma } from './db';

export function buildLfgEmbed(post: { game: string; hostId: string; maxSize: number; memberIds: string }): EmbedBuilder {
  const members: string[] = JSON.parse(post.memberIds);
  return new EmbedBuilder()
    .setTitle(`LFG: ${post.game}`)
    .setDescription(`Hosted by <@${post.hostId}>`)
    .addFields({ name: `Members (${members.length}/${post.maxSize})`, value: members.map((m) => `<@${m}>`).join('\n') || 'None yet' })
    .setColor(members.length >= post.maxSize ? 0x95a5a6 : 0x2ecc71)
    .setFooter({ text: members.length >= post.maxSize ? 'Group full' : 'Click Join to sign up' });
}

export function buildLfgButtons(postId: number, closed: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`lfg_join:${postId}`).setLabel('Join').setStyle(ButtonStyle.Success).setDisabled(closed),
    new ButtonBuilder().setCustomId(`lfg_leave:${postId}`).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(closed),
    new ButtonBuilder().setCustomId(`lfg_close:${postId}`).setLabel('Close').setStyle(ButtonStyle.Danger).setDisabled(closed),
  );
}

export async function joinLfg(postId: number, userId: string): Promise<{ ok: boolean; message: string }> {
  const post = await prisma.lfgPost.findUnique({ where: { id: postId } });
  if (!post || post.status !== 'open') return { ok: false, message: 'This group is no longer open.' };

  const members: string[] = JSON.parse(post.memberIds);
  if (members.includes(userId)) return { ok: false, message: "You're already in this group." };
  if (members.length >= post.maxSize) return { ok: false, message: 'This group is full.' };

  members.push(userId);
  await prisma.lfgPost.update({
    where: { id: postId },
    data: { memberIds: JSON.stringify(members), status: members.length >= post.maxSize ? 'closed' : 'open' },
  });
  return { ok: true, message: 'Joined!' };
}

export async function leaveLfg(postId: number, userId: string): Promise<{ ok: boolean; message: string }> {
  const post = await prisma.lfgPost.findUnique({ where: { id: postId } });
  if (!post) return { ok: false, message: 'This group no longer exists.' };

  const members: string[] = JSON.parse(post.memberIds).filter((id: string) => id !== userId);
  await prisma.lfgPost.update({ where: { id: postId }, data: { memberIds: JSON.stringify(members), status: 'open' } });
  return { ok: true, message: 'Left the group.' };
}

export async function closeLfg(postId: number): Promise<void> {
  await prisma.lfgPost.update({ where: { id: postId }, data: { status: 'closed' } });
}
