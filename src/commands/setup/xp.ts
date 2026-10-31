import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';
import { checkRoleAssignable } from '../../lib/moderationGuard';

export const xpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Configure the leveling/XP system.')
    .addSubcommand((sc) =>
      sc
        .setName('set')
        .setDescription('Turn leveling on/off and tune XP rate')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable leveling?').setRequired(true))
        .addIntegerOption((o) => o.setName('min_per_message').setDescription('Minimum XP per message').setMinValue(0).setMaxValue(1000).setRequired(false))
        .addIntegerOption((o) => o.setName('max_per_message').setDescription('Maximum XP per message').setMinValue(0).setMaxValue(1000).setRequired(false))
        .addIntegerOption((o) => o.setName('cooldown_seconds').setDescription('Seconds between XP-earning messages').setMinValue(0).setRequired(false)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('role-reward')
        .setDescription('Grant a role automatically at a given level')
        .addStringOption((o) =>
          o.setName('action').setDescription('add or remove').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }),
        )
        .addIntegerOption((o) => o.setName('level').setDescription('Level this reward triggers at').setMinValue(1).setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role to grant (required for action=add)').setRequired(false)),
    )
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    await getOrCreateGuildConfig(guildId);

    if (sub === 'set') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const min = interaction.options.getInteger('min_per_message');
      const max = interaction.options.getInteger('max_per_message');
      const cooldown = interaction.options.getInteger('cooldown_seconds');

      await prisma.guildConfig.update({
        where: { id: guildId },
        data: {
          xpEnabled: enabled,
          ...(min !== null ? { xpMinPerMsg: min } : {}),
          ...(max !== null ? { xpMaxPerMsg: max } : {}),
          ...(cooldown !== null ? { xpCooldownSec: cooldown } : {}),
        },
      });
      await interaction.reply({ content: `Leveling is now ${enabled ? 'on' : 'off'}.`, ephemeral: true });
      return;
    }

    if (sub === 'role-reward') {
      const action = interaction.options.getString('action', true);
      const level = interaction.options.getInteger('level', true);

      if (action === 'add') {
        const role = interaction.options.getRole('role');
        if (!role) {
          await interaction.reply({ content: 'Specify a role to add a reward.', ephemeral: true });
          return;
        }
        const assignable = await checkRoleAssignable(interaction.guild, interaction.member, role);
        if (!assignable.allowed) {
          await interaction.reply({ content: assignable.reason!, ephemeral: true });
          return;
        }
        await prisma.levelRoleReward.upsert({
          where: { guildId_level: { guildId, level } },
          create: { guildId, level, roleId: role.id },
          update: { roleId: role.id },
        });
        await interaction.reply({ content: `Level ${level} now grants <@&${role.id}>.`, ephemeral: true });
        return;
      }

      await prisma.levelRoleReward.deleteMany({ where: { guildId, level } });
      await interaction.reply({ content: `Removed the role reward for level ${level}.`, ephemeral: true });
    }
  },
};
