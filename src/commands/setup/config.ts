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
import { checkRoleAssignable } from '../../lib/moderationGuard';

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
    .addSubcommand((sc) =>
      sc
        .setName('antiraid')
        .setDescription('Configure anti-raid join-rate detection')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable anti-raid detection?').setRequired(true))
        .addIntegerOption((o) => o.setName('join_threshold').setDescription('Joins before flagging a raid').setRequired(false))
        .addIntegerOption((o) => o.setName('interval_seconds').setDescription('...within this many seconds').setRequired(false))
        .addBooleanOption((o) => o.setName('auto_lockdown').setDescription('Automatically raise verification level when flagged?').setRequired(false)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('channel-override')
        .setDescription('Exempt a channel from specific auto-mod rules')
        .addChannelOption((o) => o.setName('channel').setDescription('The channel to configure').setRequired(true))
        .addBooleanOption((o) => o.setName('exempt_spam').setDescription('Exempt from flood/spam detection?').setRequired(false))
        .addBooleanOption((o) => o.setName('exempt_invite').setDescription('Exempt from the invite-link filter?').setRequired(false))
        .addBooleanOption((o) => o.setName('exempt_wordfilter').setDescription('Exempt from the word filter?').setRequired(false))
        .addBooleanOption((o) => o.setName('exempt_mentionspam').setDescription('Exempt from mention-spam detection?').setRequired(false)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('appeal-channel')
        .setDescription('Set where member appeals get posted for review')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Defaults to the mod-log channel if unset').addChannelTypes(ChannelType.GuildText).setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('birthday')
        .setDescription('Configure birthday announcements')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Where to announce birthdays').addChannelTypes(ChannelType.GuildText).setRequired(false),
        )
        .addRoleOption((o) => o.setName('role').setDescription('Role to grant for the day (optional)').setRequired(false)),
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
      case 'antiraid': {
        const enabled = interaction.options.getBoolean('enabled', true);
        const joinThreshold = interaction.options.getInteger('join_threshold');
        const intervalSeconds = interaction.options.getInteger('interval_seconds');
        const autoLockdown = interaction.options.getBoolean('auto_lockdown');

        await prisma.guildConfig.update({
          where: { id: guildId },
          data: {
            antiRaidEnabled: enabled,
            ...(joinThreshold !== null ? { raidJoinThreshold: joinThreshold } : {}),
            ...(intervalSeconds !== null ? { raidIntervalMs: intervalSeconds * 1000 } : {}),
            ...(autoLockdown !== null ? { raidAutoLockdown: autoLockdown } : {}),
          },
        });
        await interaction.reply({ content: `Anti-raid is now ${enabled ? 'on' : 'off'}.`, ephemeral: true });
        return;
      }
      case 'channel-override': {
        const channel = interaction.options.getChannel('channel', true);
        const exemptSpam = interaction.options.getBoolean('exempt_spam');
        const exemptInvite = interaction.options.getBoolean('exempt_invite');
        const exemptWordFilter = interaction.options.getBoolean('exempt_wordfilter');
        const exemptMentionSpam = interaction.options.getBoolean('exempt_mentionspam');

        await prisma.channelAutomodOverride.upsert({
          where: { guildId_channelId: { guildId, channelId: channel.id } },
          create: {
            guildId,
            channelId: channel.id,
            exemptSpam: exemptSpam ?? false,
            exemptInvite: exemptInvite ?? false,
            exemptWordFilter: exemptWordFilter ?? false,
            exemptMentionSpam: exemptMentionSpam ?? false,
          },
          update: {
            ...(exemptSpam !== null ? { exemptSpam } : {}),
            ...(exemptInvite !== null ? { exemptInvite } : {}),
            ...(exemptWordFilter !== null ? { exemptWordFilter } : {}),
            ...(exemptMentionSpam !== null ? { exemptMentionSpam } : {}),
          },
        });
        await interaction.reply({ content: `Updated auto-mod overrides for <#${channel.id}>.`, ephemeral: true });
        return;
      }
      case 'appeal-channel': {
        const channel = interaction.options.getChannel('channel', true);
        await prisma.guildConfig.update({ where: { id: guildId }, data: { appealChannelId: channel.id } });
        await interaction.reply({ content: `Appeal channel set to <#${channel.id}>.`, ephemeral: true });
        return;
      }
      case 'birthday': {
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('role');
        if (role) {
          // Anyone can set today as their birthday, so this role is effectively self-assignable.
          const assignable = await checkRoleAssignable(interaction.guild, interaction.member, role);
          if (!assignable.allowed) {
            await interaction.reply({ content: assignable.reason!, ephemeral: true });
            return;
          }
        }
        await prisma.guildConfig.update({
          where: { id: guildId },
          data: {
            ...(channel ? { birthdayChannelId: channel.id } : {}),
            ...(role ? { birthdayRoleId: role.id } : {}),
          },
        });
        await interaction.reply({ content: 'Birthday settings updated.', ephemeral: true });
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
      { name: 'Anti-raid', value: gc.antiRaidEnabled ? `on (${gc.raidJoinThreshold}/${gc.raidIntervalMs / 1000}s)` : 'off', inline: true },
      { name: 'Appeal channel', value: gc.appealChannelId ? `<#${gc.appealChannelId}>` : 'uses mod-log', inline: true },
      { name: 'Moderation roles', value: modRoles.length ? modRoles.map((r) => `<@&${r}>`).join(' ') : 'not restricted' },
      { name: 'Admin roles', value: adminRoles.length ? adminRoles.map((r) => `<@&${r}>`).join(' ') : 'not restricted' },
      { name: 'Setup completed', value: gc.setupCompleted ? 'yes' : 'no — run /setup' },
    );
}
