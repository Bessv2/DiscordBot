import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { checkModerationHierarchy, checkRoleAssignable } from '../../lib/moderationGuard';
import { postModLogNote } from '../../lib/modlog';

export const roleCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Give a member a role or take one away.')
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Give a member a role')
        .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Take a role away from a member')
        .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true)),
    )
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ManageRoles,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const adding = interaction.options.getSubcommand() === 'add';
    const target = interaction.options.getMember('user');
    const role = interaction.options.getRole('role', true);
    if (!target) {
      await interaction.reply({ content: "That user isn't in this server.", ephemeral: true });
      return;
    }
    // The same two rules as everywhere else: you can't act on someone above
    // you, and you can't hand out (or strip) a role at or above your own.
    const me = await interaction.guild.members.fetchMe();
    if (target.id !== interaction.user.id) {
      const hierarchy = checkModerationHierarchy(interaction.guild, interaction.member, target, me);
      if (!hierarchy.allowed) {
        await interaction.reply({ content: hierarchy.reason!, ephemeral: true });
        return;
      }
    }
    const assignable = await checkRoleAssignable(interaction.guild, interaction.member, role);
    if (!assignable.allowed) {
      await interaction.reply({ content: assignable.reason!, ephemeral: true });
      return;
    }
    if (adding === target.roles.cache.has(role.id)) {
      await interaction.reply({
        content: `${target.user.tag} ${adding ? 'already has' : "doesn't have"} ${role}.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }
    const reason = `/role ${adding ? 'add' : 'remove'} by ${interaction.user.tag}`;
    const ok = await (
      adding ? target.roles.add(role.id, reason) : target.roles.remove(role.id, reason)
    ).then(
      () => true,
      () => false,
    );
    if (!ok) {
      await interaction.reply({
        content:
          "Discord didn't let me change that role. Check my role is above it in Server Settings → Roles.",
        ephemeral: true,
      });
      return;
    }
    await interaction.reply({
      content: `${adding ? 'Gave' : 'Removed'} ${role} ${adding ? 'to' : 'from'} ${target}.`,
      allowedMentions: { parse: [] },
    });
    await postModLogNote(interaction.guild, {
      title: adding ? 'ROLE ADDED' : 'ROLE REMOVED',
      moderator: interaction.user,
      fields: [
        { name: 'Member', value: `${target} (${target.user.tag})`, inline: true },
        { name: 'Role', value: `${role}`, inline: true },
      ],
    });
  },
};
