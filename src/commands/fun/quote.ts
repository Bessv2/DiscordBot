import { ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';
import { memberHasPermission } from '../../lib/permissions';

export const quoteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('A "said it here first" archive of memorable lines.')
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Archive a quote')
        .addStringOption((o) => o.setName('content').setDescription('What was said').setRequired(true))
        .addUserOption((o) => o.setName('author').setDescription('Who said it (defaults to you)').setRequired(false)),
    )
    .addSubcommand((sc) => sc.setName('random').setDescription('Show a random quote'))
    .addSubcommand((sc) => sc.setName('list').setDescription('List recent quotes'))
    .addSubcommand((sc) =>
      sc.setName('delete').setDescription('Delete a quote by its list number').addIntegerOption((o) => o.setName('id').setDescription('Quote ID from /quote list').setRequired(true)),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const content = interaction.options.getString('content', true);
      const author = interaction.options.getUser('author') ?? interaction.user;
      await getOrCreateGuildConfig(guildId);
      const record = await prisma.quote.create({
        data: { guildId, content, quotedUserTag: author.tag, addedBy: interaction.user.id },
      });
      await interaction.reply(`Quote #${record.id} added: "${content}" — ${author.tag}`);
      return;
    }

    if (sub === 'random') {
      const count = await prisma.quote.count({ where: { guildId } });
      if (count === 0) {
        await interaction.reply({ content: 'No quotes yet — add one with `/quote add`.', ephemeral: true });
        return;
      }
      const skip = Math.floor(Math.random() * count);
      const [quote] = await prisma.quote.findMany({ where: { guildId }, skip, take: 1 });
      const embed = new EmbedBuilder().setDescription(`"${quote!.content}"`).setFooter({ text: `— ${quote!.quotedUserTag}` });
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'list') {
      const quotes = await prisma.quote.findMany({ where: { guildId }, orderBy: { id: 'desc' }, take: 10 });
      if (quotes.length === 0) {
        await interaction.reply({ content: 'No quotes yet.', ephemeral: true });
        return;
      }
      const lines = quotes.map((q) => `**#${q.id}** "${q.content}" — ${q.quotedUserTag}`);
      await interaction.reply({ content: lines.join('\n') });
      return;
    }

    if (sub === 'delete') {
      const id = interaction.options.getInteger('id', true);
      const quote = await prisma.quote.findUnique({ where: { id } });
      if (!quote || quote.guildId !== guildId) {
        await interaction.reply({ content: `No quote #${id} found.`, ephemeral: true });
        return;
      }
      const isAdder = quote.addedBy === interaction.user.id;
      if (!isAdder) {
        const isMod = await memberHasPermission(interaction.member, 'moderation', PermissionFlagsBits.ManageMessages);
        if (!isMod) {
          await interaction.reply({ content: 'Only whoever added it (or a moderator) can delete it.', ephemeral: true });
          return;
        }
      }
      await prisma.quote.delete({ where: { id } });
      await interaction.reply({ content: `Deleted quote #${id}.`, ephemeral: true });
    }
  },
};
