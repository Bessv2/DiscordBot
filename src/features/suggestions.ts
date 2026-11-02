import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { prisma } from '../lib/db';
import { isModuleEnabledForGuild } from '../lib/modules';

const STATUS = {
  pending: { label: 'Open for votes', color: 0x5865f2 },
  approved: { label: '✅ Approved', color: 0x57f287 },
  denied: { label: '❌ Denied', color: 0xed4245 },
} as const;

export function suggestionEmbed(
  s: {
    id: number;
    content: string;
    authorId: string;
    status: string;
    staffNote: string | null;
    decidedById: string | null;
  },
  up: number,
  down: number,
): EmbedBuilder {
  const st = STATUS[s.status as keyof typeof STATUS] ?? STATUS.pending;
  const embed = new EmbedBuilder()
    .setTitle(`💡 Suggestion #${s.id}`)
    .setDescription(s.content.slice(0, 4000))
    .setColor(st.color)
    .addFields(
      { name: 'From', value: `<@${s.authorId}>`, inline: true },
      { name: 'Status', value: st.label, inline: true },
      { name: 'Votes', value: `👍 ${up} · 👎 ${down}`, inline: true },
    );
  if (s.decidedById)
    embed.addFields({
      name: s.status === 'approved' ? 'Approved by' : 'Denied by',
      value: `<@${s.decidedById}>${s.staffNote ? `: ${s.staffNote}` : ''}`,
    });
  return embed;
}

export function suggestionButtons(id: number, closed: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`suggestion_vote:${id}:up`)
      .setEmoji('👍')
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`suggestion_vote:${id}:down`)
      .setEmoji('👎')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closed),
  );
}

export async function voteCounts(id: number): Promise<{ up: number; down: number }> {
  const [up, down] = await Promise.all([
    prisma.suggestionVote.count({ where: { suggestionId: id, up: true } }),
    prisma.suggestionVote.count({ where: { suggestionId: id, up: false } }),
  ]);
  return { up, down };
}

/** One vote per member; pressing your current vote again removes it, the other button switches it. */
export async function vote(i: ButtonInteraction<'cached'>, id: number, up: boolean): Promise<void> {
  const s = await prisma.suggestion.findUnique({ where: { id } });
  if (!s || s.guildId !== i.guildId) {
    await i.reply({ content: 'This suggestion no longer exists.', ephemeral: true });
    return;
  }
  if (s.status !== 'pending') {
    await i.reply({ content: 'Voting on this suggestion has closed.', ephemeral: true });
    return;
  }
  if (!(await isModuleEnabledForGuild(i.guildId, 'suggestions'))) {
    await i.reply({ content: 'Suggestions are turned off on this server.', ephemeral: true });
    return;
  }
  const key = { suggestionId_userId: { suggestionId: id, userId: i.user.id } };
  const existing = await prisma.suggestionVote.findUnique({ where: key });
  if (existing && existing.up === up) await prisma.suggestionVote.delete({ where: key });
  else
    await prisma.suggestionVote.upsert({
      where: key,
      create: { suggestionId: id, userId: i.user.id, up },
      update: { up },
    });
  const { up: u, down: d } = await voteCounts(id);
  await i.update({ embeds: [suggestionEmbed(s, u, d)] });
}
