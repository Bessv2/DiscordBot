import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { getCaseByNumber, getCasesForUser } from '../../lib/caseManager';

export const casesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('cases')
    .setDescription("Look up a member's moderation case history.")
    .addUserOption((o) => o.setName('user').setDescription('The member to look up').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('case_number').setDescription('Show one specific case instead of the recent list').setRequired(false),
    )
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ModerateMembers,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const targetUser = interaction.options.getUser('user', true);
    const caseNumber = interaction.options.getInteger('case_number');

    if (caseNumber !== null) {
      const record = await getCaseByNumber(interaction.guild.id, caseNumber);
      if (!record || record.targetId !== targetUser.id) {
        await interaction.reply({
          content: `No case #${caseNumber} found for ${targetUser.tag}.`,
          ephemeral: true,
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle(`Case #${record.caseNumber} · ${record.type.toUpperCase()}`)
        .addFields(
          { name: 'Member', value: record.targetTag, inline: true },
          { name: 'Moderator', value: record.moderatorTag, inline: true },
          { name: 'Reason', value: record.reason ?? 'No reason provided' },
        )
        .setTimestamp(record.createdAt);
      await interaction.reply({ embeds: [embed] });
      return;
    }

    const cases = await getCasesForUser(interaction.guild.id, targetUser.id, 10);
    if (cases.length === 0) {
      await interaction.reply({ content: `No cases found for ${targetUser.tag}.`, ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Case history · ${targetUser.tag}`)
      .setDescription(
        cases
          .map((c) => `**#${c.caseNumber}** · ${c.type} · ${c.reason ?? 'no reason'} — <t:${Math.floor(c.createdAt.getTime() / 1000)}:R>`)
          .join('\n'),
      );
    await interaction.reply({ embeds: [embed] });
  },
};
