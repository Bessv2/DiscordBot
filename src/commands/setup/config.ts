import {
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command, SlashCommandData } from '../types';
import { getOrCreateGuildConfig, prisma } from '../../lib/db';
import { CommandScope, getConfiguredRoleIds, setPermissionRoles } from '../../lib/permissions';

// Everything /setup covers can also be tuned later, one setting at a time,
// without re-running the whole wizard — "config over code" (principle #2).
export const configCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('View or change this server\'s settings.')
    .addSubcommand((sc) => sc.setName('view').setDescription('Show current settings'))
    .addSubcommand((sc) =>
      sc
        .setName('modlog')
        .setDescription('Set the mod-log channel')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel for mod-log embeds').addChannelTypes(ChannelType.GuildText).setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('automod')
        .setDescription('Turn auto-mod on or off')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable auto-mod?').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('wordfilter')
        .setDescription('Configure the word/phrase filter')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the word filter on/off').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('words')
            .setDescription('Comma-separated banned words — replaces the current list')
            .setRequired(false),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('permissions')
        .setDescription('Restrict a command scope to specific roles')
        .addStringOption((o) =>
          o
            .setName('scope')
            .setDescription('Which set of commands')
            .setRequired(true)
            .addChoices({ name: 'moderation (warn/kick/ban/timeout)', value: 'moderation' }, { name: 'admin (setup/config)', value: 'admin' }),
        )
        .addRoleOption((o) => o.setName('role').setDescription('Role to add or remove').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('add or remove')
            .setRequired(true)
            .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }),
        ),
    )
    .setDMPermission(false) as SlashCommandData,
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    await getOrCreateGuildConfig(guildId);

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'view': {
        await interaction.reply({ embeds: [await buildViewEmbed(guildId)] });
        return;
      }
      case 'modlog': {
        const channel = interaction.options.getChannel('channel', true);
        await prisma.guildConfig.update({ where: { id: guildId }, data: { modLogChannelId: channel.id } });
        await interaction.reply({ content: `Mod-log channel set to <#${channel.id}>.`, ephemeral: true });
        return;
      }
      case 'automod': {
        const enabled = interaction.options.getBoolean('enabled', true);
        await prisma.guildConfig.update({ where: { id: guildId }, data: { automodEnabled: enabled } });
        await interaction.reply({ content: `Auto-mod is now ${enabled ? 'on' : 'off'}.`, ephemeral: true });
        return;
      }
      case 'wordfilter': {
        const enabled = interaction.options.getBoolean('enabled', true);
        const wordsInput = interaction.options.getString('words');
        const data: { wordFilterOn: boolean; bannedWords?: string } = { wordFilterOn: enabled };
        if (wordsInput !== null) {
          const words = wordsInput
            .split(',')
            .map((w) => w.trim())
            .filter(Boolean);
          data.bannedWords = JSON.stringify(words);
        }
        await prisma.guildConfig.update({ where: { id: guildId }, data });
        await interaction.reply({
          content: `Word filter is now ${enabled ? 'on' : 'off'}${wordsInput !== null ? ' and the banned-word list was updated' : ''}.`,
          ephemeral: true,
        });
        return;
      }
      case 'permissions': {
        const scope = interaction.options.getString('scope', true) as CommandScope;
        const role = interaction.options.getRole('role', true);
        const action = interaction.options.getString('action', true);

        const current = await getConfiguredRoleIds(guildId, scope);
        const next =
          action === 'add'
            ? [...new Set([...current, role.id])]
            : current.filter((id) => id !== role.id);

        await setPermissionRoles(guildId, scope, next);
        await interaction.reply({
          content: `${action === 'add' ? 'Added' : 'Removed'} <@&${role.id}> ${action === 'add' ? 'to' : 'from'} the **${scope}** scope.`,
          ephemeral: true,
        });
        return;
      }
    }
  },
};

async function buildViewEmbed(guildId: string): Promise<EmbedBuilder> {
  const gc = await prisma.guildConfig.findUniqueOrThrow({ where: { id: guildId } });
  const modRoles = await getConfiguredRoleIds(guildId, 'moderation');
  const adminRoles = await getConfiguredRoleIds(guildId, 'admin');
  const bannedWords: string[] = JSON.parse(gc.bannedWords || '[]');

  return new EmbedBuilder()
    .setTitle('Server settings')
    .addFields(
      { name: 'Mod-log channel', value: gc.modLogChannelId ? `<#${gc.modLogChannelId}>` : 'not set', inline: true },
      { name: 'Auto-mod', value: gc.automodEnabled ? 'on' : 'off', inline: true },
      { name: 'Invite filter', value: gc.inviteFilterOn ? 'on' : 'off', inline: true },
      { name: 'Word filter', value: gc.wordFilterOn ? `on (${bannedWords.length} word[s])` : 'off', inline: true },
      { name: 'Spam threshold', value: `${gc.spamMessageLimit} msgs / ${gc.spamIntervalMs / 1000}s`, inline: true },
      { name: 'Mention spam limit', value: `${gc.mentionSpamLimit}`, inline: true },
      { name: 'Moderation roles', value: modRoles.length ? modRoles.map((r) => `<@&${r}>`).join(' ') : 'not restricted' },
      { name: 'Admin roles', value: adminRoles.length ? adminRoles.map((r) => `<@&${r}>`).join(' ') : 'not restricted' },
      { name: 'Setup completed', value: gc.setupCompleted ? 'yes' : 'no — run /setup' },
    );
}
