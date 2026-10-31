import { ChatInputCommandInteraction, EmbedBuilder, GuildMember, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';
import { memberHasPermission } from '../../lib/permissions';
import { Bracket, findNextPlayableMatch, generateBracket, getChampion, reportWinner } from '../../lib/bracket';

async function isOrganizer(member: GuildMember, createdBy: string): Promise<boolean> {
  if (member.id === createdBy) return true;
  return memberHasPermission(member, 'moderation', PermissionFlagsBits.ManageGuild);
}

function describeBracket(bracket: Bracket): string {
  return bracket
    .map(
      (round, i) =>
        `**Round ${i + 1}**\n` +
        round
          .map((m) => `${m.player1 ? `<@${m.player1}>` : 'TBD'} vs ${m.player2 ? `<@${m.player2}>` : 'TBD'}${m.winner ? ` → won by <@${m.winner}>` : ''}`)
          .join('\n'),
    )
    .join('\n\n');
}

export const tournamentCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('tournament')
    .setDescription('Run a simple single-elimination bracket for a community game night.')
    .addSubcommand((sc) => sc.setName('create').setDescription('Create a tournament').addStringOption((o) => o.setName('name').setDescription('Tournament name').setRequired(true)))
    .addSubcommand((sc) => sc.setName('join').setDescription('Join a tournament').addStringOption((o) => o.setName('name').setDescription('Tournament name').setRequired(true)))
    .addSubcommand((sc) => sc.setName('leave').setDescription('Leave a tournament').addStringOption((o) => o.setName('name').setDescription('Tournament name').setRequired(true)))
    .addSubcommand((sc) => sc.setName('start').setDescription('Lock entries and generate the bracket').addStringOption((o) => o.setName('name').setDescription('Tournament name').setRequired(true)))
    .addSubcommand((sc) =>
      sc
        .setName('report')
        .setDescription('Report the winner of the next match')
        .addStringOption((o) => o.setName('name').setDescription('Tournament name').setRequired(true))
        .addUserOption((o) => o.setName('winner').setDescription('Who won').setRequired(true)),
    )
    .addSubcommand((sc) => sc.setName('view').setDescription('Show the current bracket').addStringOption((o) => o.setName('name').setDescription('Tournament name').setRequired(true)))
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const name = interaction.options.getString('name', true);
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const existing = await prisma.tournament.findFirst({ where: { guildId, name, status: { not: 'complete' } } });
      if (existing) {
        await interaction.reply({ content: `A tournament named "${name}" is already running.`, ephemeral: true });
        return;
      }
      await getOrCreateGuildConfig(guildId);
      await prisma.tournament.create({
        data: { guildId, name, participants: JSON.stringify([interaction.user.id]), bracket: '[]', createdBy: interaction.user.id },
      });
      await interaction.reply(`Tournament **${name}** created — \`/tournament join name:${name}\` to enter.`);
      return;
    }

    const tournament = await prisma.tournament.findFirst({ where: { guildId, name }, orderBy: { id: 'desc' } });
    if (!tournament) {
      await interaction.reply({ content: `No tournament named "${name}".`, ephemeral: true });
      return;
    }
    const participants: string[] = JSON.parse(tournament.participants);

    if (sub === 'join') {
      if (tournament.status !== 'open') {
        await interaction.reply({ content: 'Entries are closed for this tournament.', ephemeral: true });
        return;
      }
      if (participants.includes(interaction.user.id)) {
        await interaction.reply({ content: "You're already entered.", ephemeral: true });
        return;
      }
      participants.push(interaction.user.id);
      await prisma.tournament.update({ where: { id: tournament.id }, data: { participants: JSON.stringify(participants) } });
      await interaction.reply(`${interaction.user} joined **${name}** (${participants.length} entered).`);
      return;
    }

    if (sub === 'leave') {
      if (tournament.status !== 'open') {
        await interaction.reply({ content: 'Entries are closed — too late to leave.', ephemeral: true });
        return;
      }
      await prisma.tournament.update({
        where: { id: tournament.id },
        data: { participants: JSON.stringify(participants.filter((id) => id !== interaction.user.id)) },
      });
      await interaction.reply({ content: 'Left the tournament.', ephemeral: true });
      return;
    }

    if (sub === 'start') {
      if (!(await isOrganizer(interaction.member, tournament.createdBy))) {
        await interaction.reply({ content: 'Only the organizer (or a moderator) can start it.', ephemeral: true });
        return;
      }
      if (tournament.status !== 'open') {
        await interaction.reply({ content: 'This tournament already started.', ephemeral: true });
        return;
      }
      if (participants.length < 2) {
        await interaction.reply({ content: 'Need at least 2 entrants to start.', ephemeral: true });
        return;
      }
      const bracket = generateBracket(participants);
      await prisma.tournament.update({ where: { id: tournament.id }, data: { status: 'in_progress', bracket: JSON.stringify(bracket) } });
      await interaction.reply({ content: `**${name}** has started!\n\n${describeBracket(bracket)}` });
      return;
    }

    if (sub === 'view') {
      const bracket: Bracket = JSON.parse(tournament.bracket);
      if (bracket.length === 0) {
        await interaction.reply({ content: `**${name}** hasn't started yet. Entrants: ${participants.map((p) => `<@${p}>`).join(', ') || 'none'}` });
        return;
      }
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle(name).setDescription(describeBracket(bracket))] });
      return;
    }

    // report
    if (!(await isOrganizer(interaction.member, tournament.createdBy))) {
      await interaction.reply({ content: 'Only the organizer (or a moderator) can report results.', ephemeral: true });
      return;
    }
    if (tournament.status !== 'in_progress') {
      await interaction.reply({ content: 'This tournament is not in progress.', ephemeral: true });
      return;
    }
    const bracket: Bracket = JSON.parse(tournament.bracket);
    const winner = interaction.options.getUser('winner', true);
    const next = findNextPlayableMatch(bracket);
    if (!next) {
      await interaction.reply({ content: 'No match is currently awaiting a result.', ephemeral: true });
      return;
    }
    if (next.match.player1 !== winner.id && next.match.player2 !== winner.id) {
      await interaction.reply({ content: `${winner.tag} isn't in the next playable match (${next.match.player1 ? `<@${next.match.player1}>` : 'TBD'} vs ${next.match.player2 ? `<@${next.match.player2}>` : 'TBD'}).`, ephemeral: true });
      return;
    }

    const updatedBracket = reportWinner(bracket, next.roundIndex, next.matchIndex, winner.id);
    const champion = getChampion(updatedBracket);
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: { bracket: JSON.stringify(updatedBracket), status: champion ? 'complete' : 'in_progress' },
    });

    if (champion) {
      await interaction.reply(`🏆 **${name}** is complete! Champion: <@${champion}>\n\n${describeBracket(updatedBracket)}`);
    } else {
      await interaction.reply(`Result recorded: <@${winner.id}> advances.\n\n${describeBracket(updatedBracket)}`);
    }
  },
};
