import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Guild,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  User,
} from 'discord.js';
import { prisma, getOrCreateGuildConfig } from './db';
import { logger } from './logger';
import { unmuteMember } from './muteActions';

/** Appended to every moderation-action DM so the recipient has a direct path to contest it. */
export function buildAppealButtonRow(caseId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`appeal_open:${caseId}`).setLabel('Appeal this').setStyle(ButtonStyle.Secondary),
  );
}

export function buildAppealModal(caseId: number): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('appeal_message')
    .setLabel('Why should this be reconsidered?')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`appeal_submit:${caseId}`)
    .setTitle('Submit an appeal')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export async function submitAppeal(
  client: Client<true>,
  caseId: number,
  user: User,
  message: string,
): Promise<{ ok: boolean; reply: string }> {
  const caseRecord = await prisma.case.findUnique({ where: { id: caseId } });
  if (!caseRecord || caseRecord.targetId !== user.id) {
    return { ok: false, reply: "This appeal link doesn't match your case — it may be invalid." };
  }

  const guildConfig = await getOrCreateGuildConfig(caseRecord.guildId);
  const channelId = guildConfig.appealChannelId ?? guildConfig.modLogChannelId;
  if (!channelId) {
    return { ok: false, reply: 'This server has no appeal or mod-log channel configured — your appeal could not be delivered.' };
  }

  const guild = await client.guilds.fetch(caseRecord.guildId).catch(() => null);
  const channel = guild ? await guild.channels.fetch(channelId).catch(() => null) : null;
  if (!channel || !channel.isSendable()) {
    return { ok: false, reply: "This server's appeal channel is no longer available — your appeal could not be delivered." };
  }

  const appeal = await prisma.appeal.create({
    data: { guildId: caseRecord.guildId, caseId: caseRecord.id, userId: user.id, message },
  });

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`Appeal · Case #${caseRecord.caseNumber} (${caseRecord.type})`)
    .addFields(
      { name: 'Member', value: `${user} (${user.tag})`, inline: true },
      { name: 'Original reason', value: caseRecord.reason ?? 'No reason provided', inline: true },
      { name: 'Appeal message', value: message },
    )
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`appeal_accept:${appeal.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`appeal_deny:${appeal.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
  );

  await channel.send({ embeds: [embed], components: [row] });
  return { ok: true, reply: 'Your appeal was submitted for staff review.' };
}

export async function resolveAppeal(
  client: Client<true>,
  appealId: number,
  decision: 'accepted' | 'denied',
  staff: User,
): Promise<{ ok: boolean; reply: string }> {
  const appeal = await prisma.appeal.findUnique({ where: { id: appealId }, include: { case: true } });
  if (!appeal) return { ok: false, reply: 'That appeal no longer exists.' };
  if (appeal.status !== 'pending') return { ok: false, reply: `This appeal was already ${appeal.status}.` };

  await prisma.appeal.update({
    where: { id: appealId },
    data: { status: decision, resolvedAt: new Date(), resolvedBy: staff.id },
  });

  const guild = await client.guilds.fetch(appeal.guildId).catch(() => null);
  if (guild && decision === 'accepted') {
    await reverseAction(guild, appeal.case.type, appeal.userId, staff).catch((err) => {
      logger.warn(`Could not reverse action for accepted appeal ${appealId}: ${(err as Error).message}`);
    });
  }

  const user = await client.users.fetch(appeal.userId).catch(() => null);
  await user
    ?.send(
      decision === 'accepted'
        ? `Your appeal for case #${appeal.case.caseNumber} in a server you're in was **accepted**.`
        : `Your appeal for case #${appeal.case.caseNumber} in a server you're in was **denied**.`,
    )
    .catch(() => undefined);

  return { ok: true, reply: `Appeal ${decision}.` };
}

async function reverseAction(guild: Guild, type: string, userId: string, staff: User): Promise<void> {
  if (type === 'ban') {
    await guild.members.unban(userId, 'Appeal accepted').catch(() => undefined);
    return;
  }
  if (type === 'timeout') {
    const member = await guild.members.fetch(userId).catch(() => null);
    await member?.timeout(null, 'Appeal accepted').catch(() => undefined);
    return;
  }
  if (type === 'mute') {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await unmuteMember(guild, member, staff, 'Appeal accepted');
    return;
  }
  // warn/kick have no reversible server-side state — the DM notification is the resolution.
}
