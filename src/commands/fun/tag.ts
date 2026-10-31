import { ChatInputCommandInteraction, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';
import { memberHasPermission } from '../../lib/permissions';

// Open to everyone by design — hosts who want it locked down can restrict
// the "utility" scope via /config permissions. Anyone can create a tag;
// only its creator or someone with moderation permission can edit/delete
// it, so one member's joke tag can't be griefed by another.
export const tagCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Custom text responses your server defines, no code required.')
    .addSubcommand((sc) =>
      sc
        .setName('create')
        .setDescription('Create a new tag')
        .addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true))
        .addStringOption((o) => o.setName('content').setDescription('What it replies with').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('edit')
        .setDescription('Edit a tag you created')
        .addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true))
        .addStringOption((o) => o.setName('content').setDescription('New content').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc.setName('delete').setDescription('Delete a tag').addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true)),
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('List all tags in this server'))
    .addSubcommand((sc) =>
      sc.setName('show').setDescription('Show a tag').addStringOption((o) => o.setName('name').setDescription('Tag name').setRequired(true)),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const tags = await prisma.tag.findMany({ where: { guildId }, orderBy: { name: 'asc' } });
      if (tags.length === 0) {
        await interaction.reply({ content: 'No tags yet — create one with `/tag create`.', ephemeral: true });
        return;
      }
      await interaction.reply({ content: `Tags: ${tags.map((t) => `\`${t.name}\``).join(', ')}` });
      return;
    }

    if (sub === 'show') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const tag = await prisma.tag.findUnique({ where: { guildId_name: { guildId, name } } });
      if (!tag) {
        await interaction.reply({ content: `No tag named \`${name}\`.`, ephemeral: true });
        return;
      }
      await interaction.reply(tag.content);
      return;
    }

    if (sub === 'create') {
      const name = interaction.options.getString('name', true).toLowerCase();
      const content = interaction.options.getString('content', true);
      const existing = await prisma.tag.findUnique({ where: { guildId_name: { guildId, name } } });
      if (existing) {
        await interaction.reply({ content: `A tag named \`${name}\` already exists.`, ephemeral: true });
        return;
      }
      await getOrCreateGuildConfig(guildId);
      await prisma.tag.create({ data: { guildId, name, content, createdBy: interaction.user.id } });
      await interaction.reply({ content: `Created tag \`${name}\`.`, ephemeral: true });
      return;
    }

    // edit / delete — creator or a moderator only
    const name = interaction.options.getString('name', true).toLowerCase();
    const tag = await prisma.tag.findUnique({ where: { guildId_name: { guildId, name } } });
    if (!tag) {
      await interaction.reply({ content: `No tag named \`${name}\`.`, ephemeral: true });
      return;
    }

    const isCreator = tag.createdBy === interaction.user.id;
    if (!isCreator) {
      const isMod = await memberHasPermission(interaction.member, 'moderation', PermissionFlagsBits.ManageMessages);
      if (!isMod) {
        await interaction.reply({ content: `Only the creator of \`${name}\` (or a moderator) can do that.`, ephemeral: true });
        return;
      }
    }

    if (sub === 'edit') {
      const content = interaction.options.getString('content', true);
      await prisma.tag.update({ where: { id: tag.id }, data: { content } });
      await interaction.reply({ content: `Updated tag \`${name}\`.`, ephemeral: true });
      return;
    }

    if (sub === 'delete') {
      await prisma.tag.delete({ where: { id: tag.id } });
      await interaction.reply({ content: `Deleted tag \`${name}\`.`, ephemeral: true });
    }
  },
};
