import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';
import { config } from '../../config';

export const activityroleCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('activityrole')
    .setDescription('Auto-assign a role to members currently playing a matching game. Needs ENABLE_PRESENCE=true in .env.')
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Add a mapping')
        .addStringOption((o) => o.setName('game_name').setDescription('Matched as a substring, case-insensitive (e.g. "minecraft")').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role to assign while playing').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc.setName('remove').setDescription('Remove a mapping').addStringOption((o) => o.setName('game_name').setDescription('The pattern used when adding it').setRequired(true)),
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('List all mappings'))
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageRoles,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rows = await prisma.voiceActivityRole.findMany({ where: { guildId } });
      if (rows.length === 0) {
        await interaction.reply({ content: 'No activity-role mappings yet.', ephemeral: true });
        return;
      }
      await interaction.reply({ content: rows.map((r) => `"${r.gameNamePattern}" → <@&${r.roleId}>`).join('\n'), ephemeral: true });
      return;
    }

    const gameName = interaction.options.getString('game_name', true).toLowerCase();

    if (sub === 'add') {
      const role = interaction.options.getRole('role', true);
      await getOrCreateGuildConfig(guildId);
      await prisma.voiceActivityRole.upsert({
        where: { guildId_gameNamePattern: { guildId, gameNamePattern: gameName } },
        create: { guildId, gameNamePattern: gameName, roleId: role.id },
        update: { roleId: role.id },
      });
      const warning = !config.ENABLE_PRESENCE
        ? "\n⚠️ ENABLE_PRESENCE is off in .env — this won't actually trigger until it's enabled."
        : '';
      await interaction.reply({ content: `Members playing "${gameName}" will now get <@&${role.id}>.${warning}`, ephemeral: true });
      return;
    }

    await prisma.voiceActivityRole.deleteMany({ where: { guildId, gameNamePattern: gameName } });
    await interaction.reply({ content: `Removed the mapping for "${gameName}".`, ephemeral: true });
  },
};
