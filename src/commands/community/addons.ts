import {
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { config } from '../../config';
import { prisma } from '../../lib/db';
import { ADDON_KINDS, AddonKind, isAddonKind } from '../../addons/parse';
import { checkAddonNow, createAddon, describeTarget } from '../../addons/runner';
import { dashboardUrl } from '../../dashboard/url';

// The Discord side of add-ons. The web dashboard has the same controls;
// webhooks especially make more sense there, since their address is shown
// on a private page rather than in a message.
export const addonsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('addons')
    .setDescription('Have the bot post from news feeds, Steam, Epic, game servers or other apps.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a source for the bot to post from.')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('What to post from')
            .setRequired(true)
            .addChoices(...ADDON_KINDS.map((k) => ({ name: k.label, value: k.kind }))),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Where to post')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('target')
            .setDescription(
              'Feed address, Steam app ID, or game|host|port (not needed for Epic or webhooks)',
            )
            .setMaxLength(500),
        )
        .addStringOption((o) =>
          o.setName('name').setDescription('A short name for it').setMaxLength(80),
        )
        .addRoleOption((o) =>
          o.setName('ping').setDescription('A role to ping with each post (optional)'),
        ),
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription("List this server's add-ons and whether they're working."),
    )
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Check an add-on right now.')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('The number from /addons list').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove an add-on.')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('The number from /addons list').setRequired(true),
        ),
    ),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'add') {
      const kind = interaction.options.getString('type', true);
      if (!isAddonKind(kind))
        return void interaction.reply({ content: 'Unknown type.', ephemeral: true });
      if (kind === 'webhook' && !config.ENABLE_DASHBOARD) {
        return void interaction.reply({
          content:
            "Webhooks arrive through the bot's web dashboard, which isn't turned on. Whoever runs the bot can turn it on with `ENABLE_DASHBOARD=true` (README → Web dashboard).",
          ephemeral: true,
        });
      }
      const target = interaction.options.getString('target') ?? '';
      const needsTarget = ADDON_KINDS.find((k) => k.kind === kind)?.target;
      if (needsTarget && !target.trim()) {
        return void interaction.reply({
          content: `This type needs a **target**: ${needsTarget}.`,
          ephemeral: true,
        });
      }
      const role = interaction.options.getRole('ping');
      if (role && (role.id === guildId || role.managed)) {
        return void interaction.reply({
          content: "That role can't be pinged by add-ons; pick a normal role.",
          ephemeral: true,
        });
      }
      await interaction.deferReply({ ephemeral: true });
      const res = await createAddon({
        guildId,
        kind,
        name: interaction.options.getString('name') ?? '',
        channelId: interaction.options.getChannel('channel', true).id,
        target,
        mentionRoleId: role?.id ?? null,
        createdBy: interaction.user.id,
      });
      if (!res.ok) return void interaction.editReply(`⚠️ ${res.error}`);
      if (res.secret) {
        return void interaction.editReply(
          `🔗 Webhook **#${res.addon.id} ${res.addon.name}** added. Send messages to this address (it's shown only now, so save it; **anyone with it can post**):\n` +
            `\`${dashboardUrl()}/hooks/${res.addon.id}/${res.secret}\`\n` +
            'It takes the same JSON as a Discord webhook: `{"content": "Server restarted"}`. The sending app must be able to reach the dashboard (README → Web dashboard).',
        );
      }
      const check = await checkAddonNow(interaction.client, res.addon);
      return void interaction.editReply(
        check.ok
          ? `✅ Add-on **#${res.addon.id} ${res.addon.name}** added: ${check.message}.`
          : `⚠️ Added **#${res.addon.id} ${res.addon.name}**, but the first check failed: ${check.message}. Fix it with \`/addons remove\` and add it again, or try \`/addons test\` later.`,
      );
    }

    if (sub === 'list') {
      const addons = await prisma.addon.findMany({ where: { guildId }, orderBy: { id: 'asc' } });
      if (!addons.length) {
        return void interaction.reply({
          content: 'No add-ons yet. Add one with `/addons add`.',
          ephemeral: true,
        });
      }
      const embed = new EmbedBuilder()
        .setTitle('🧩 Add-ons')
        .setColor(0x5865f2)
        .setDescription(
          addons
            .map((a) => {
              const k = ADDON_KINDS.find((x) => x.kind === (a.kind as AddonKind));
              const status = !a.enabled
                ? '⏸️ paused'
                : a.lastError
                  ? `⚠️ ${a.lastError}`
                  : a.lastCheckedAt
                    ? '✅ working'
                    : '◽ not checked yet';
              return `**#${a.id}** ${k?.emoji ?? ''} ${a.name} → <#${a.channelId}>\n${describeTarget(a).slice(0, 120)} · ${status.slice(0, 200)}`;
            })
            .join('\n\n')
            .slice(0, 4000),
        );
      return void interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const id = interaction.options.getInteger('id', true);
    const addon = await prisma.addon.findFirst({ where: { id, guildId } });
    if (!addon)
      return void interaction.reply({
        content: `There's no add-on #${id} here. See \`/addons list\`.`,
        ephemeral: true,
      });

    if (sub === 'remove') {
      await prisma.addon.delete({ where: { id } });
      return void interaction.reply({
        content: `Removed add-on #${id} (${addon.name}).`,
        ephemeral: true,
      });
    }

    if (sub === 'test') {
      if (addon.kind === 'webhook') {
        return void interaction.reply({
          content:
            "Webhooks post whenever an app sends to their address; there's nothing to check.",
          ephemeral: true,
        });
      }
      await interaction.deferReply({ ephemeral: true });
      const check = await checkAddonNow(interaction.client, addon);
      return void interaction.editReply(
        check.ok ? `✅ #${id}: ${check.message}.` : `⚠️ #${id}: ${check.message}`,
      );
    }
  },
};
