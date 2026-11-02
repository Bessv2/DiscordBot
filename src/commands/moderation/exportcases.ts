import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { prisma } from '../../lib/db';
import { casesToCsv, casesToJson, exportFileName } from '../../lib/caseExport';

// Audit-log export for servers that need records outside Discord. Sent as
// an ephemeral attachment, so only the moderator who asked gets the file.
export const exportcasesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('exportcases')
    .setDescription(
      "Download this server's whole case history as a spreadsheet (CSV) or JSON file.",
    )
    .addStringOption((o) =>
      o
        .setName('format')
        .setDescription('CSV opens in Excel or Google Sheets; JSON is for other tools')
        .addChoices({ name: 'CSV (spreadsheet)', value: 'csv' }, { name: 'JSON', value: 'json' }),
    )
    .addUserOption((o) => o.setName('user').setDescription("Only this member's cases (optional)"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ModerateMembers,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const format = (interaction.options.getString('format') ?? 'csv') as 'csv' | 'json';
    const user = interaction.options.getUser('user');
    await interaction.deferReply({ ephemeral: true });
    const cases = await prisma.case.findMany({
      where: { guildId: interaction.guildId, ...(user ? { targetId: user.id } : {}) },
      orderBy: { caseNumber: 'asc' },
    });
    if (!cases.length) {
      await interaction.editReply(user ? `${user.tag} has no cases.` : 'There are no cases yet.');
      return;
    }
    const body = format === 'csv' ? casesToCsv(cases) : casesToJson(interaction.guildId, cases);
    const file = new AttachmentBuilder(Buffer.from(body, 'utf8'), {
      name: exportFileName(interaction.guild.name, format),
    });
    await interaction.editReply({
      content: `📄 ${cases.length} case(s)${user ? ` for ${user.tag}` : ''}.`,
      files: [file],
    });
  },
};
