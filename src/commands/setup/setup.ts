import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageActionRowComponentBuilder,
  MessageComponentInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { Command } from '../types';
import { config } from '../../config';
import { getOrCreateGuildConfig, prisma } from '../../lib/db';
import { logger } from '../../lib/logger';
import { getConfiguredRoleIds } from '../../lib/permissions';
import { HostFacts, STATE_ICON, featureMapFields, featureStatuses } from '../../setup/status';
import {
  PanelCtx,
  PanelId,
  Rendered,
  handlePanel,
  isPanelId,
  renderPanel,
} from '../../setup/panels';

// The in-Discord setup wizard (principle #8): everything past getting the
// bot running happens here, point-and-click. It opens on a feature map —
// every feature, whether it's on, and what it still needs — and each
// feature has its own screen. "Quick start" walks the three essentials in
// order. Every screen can be skipped, and so can the whole wizard.
//
// State lives in the collector closure; nothing is "in progress" once the
// message stops being used, so there's no cross-restart state to clean up.

const WIZARD_TIMEOUT_MS = 15 * 60_000; // Discord's limit for editing the original reply
const QUICK_START: PanelId[] = ['modlog', 'automod', 'permissions'];

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
/** A button/menu click, or a form submitted from the setup message: both can redraw it. */
interface Updatable {
  update(options: Rendered): Promise<unknown>;
}

export const setupCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription(
      'Set up the bot: a map of every feature, with on/off switches and channel/role pickers.',
    )
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const ctx: PanelCtx = {
      guild: interaction.guild,
      invoker: interaction.member,
      gc: await getOrCreateGuildConfig(interaction.guild.id),
      stepLabel: null,
    };
    // Index into QUICK_START while walking it, otherwise null.
    let quickStep: number | null = null;
    let currentPanel: PanelId | null = null;

    const firstTime = !ctx.gc.setupCompleted;
    const response = await interaction.reply({
      ...(await renderMap(ctx, firstTime ? WELCOME : undefined)),
      ephemeral: true,
    });
    const collector = response.createMessageComponentCollector({ time: WIZARD_TIMEOUT_MS });

    const showPanel = async (i: Updatable, panel: PanelId, notice?: string) => {
      currentPanel = panel;
      ctx.stepLabel =
        quickStep === null ? null : `Quick start · step ${quickStep + 1} of ${QUICK_START.length}`;
      await i.update(await renderPanel(panel, ctx, navRow(quickStep), notice));
    };
    const showMap = async (i: MessageComponentInteraction, notice?: string) => {
      currentPanel = null;
      quickStep = null;
      ctx.stepLabel = null;
      ctx.gc = await prisma.guildConfig.findUniqueOrThrow({ where: { id: ctx.guild.id } });
      await i.update(await renderMap(ctx, notice));
    };

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({
          content:
            'Only the person who ran `/setup` can use these buttons. Run `/setup` yourself to get your own.',
          ephemeral: true,
        });
        return;
      }
      const [, scope, action = ''] = i.customId.split(':');

      try {
        if (scope === 'nav') {
          if (action === 'open' && i.isStringSelectMenu() && isPanelId(i.values[0]!))
            return await showPanel(i, i.values[0] as PanelId);
          if (action === 'map') return await showMap(i);
          if (action === 'quick') {
            quickStep = 0;
            return await showPanel(i, QUICK_START[0]!);
          }
          if (action === 'next') {
            // In quick start, Skip/Next moves on; anywhere else it returns to the map.
            if (quickStep !== null && quickStep + 1 < QUICK_START.length) {
              quickStep++;
              return await showPanel(i, QUICK_START[quickStep]!);
            }
            const finishedQuick = quickStep !== null;
            return await showMap(
              i,
              finishedQuick
                ? 'Essentials done! Turn on anything else you want below, or press **Done**.'
                : undefined,
            );
          }
          if (action === 'done') {
            ctx.gc = await prisma.guildConfig.update({
              where: { id: ctx.guild.id },
              data: { setupCompleted: true },
            });
            collector.stop('done');
            return await i.update(await renderDone(ctx));
          }
          return;
        }

        // A click on a screen that's no longer showing (double-click, lag): acknowledge quietly.
        if (!isPanelId(scope!) || scope !== currentPanel) return await i.deferUpdate();
        const result = await handlePanel(scope, i, action, ctx);
        if (result.modal === null) return; // form closed: opening it already answered the click
        ctx.gc = await prisma.guildConfig.findUniqueOrThrow({ where: { id: ctx.guild.id } });
        if (result.modal === undefined) await showPanel(i, scope, result.notice);
        else if (result.modal.isFromMessage()) await showPanel(result.modal, scope, result.notice);
        else await result.modal.reply({ content: result.notice ?? 'Saved.', ephemeral: true });
      } catch (err) {
        logger.error(
          `/setup: ${scope}:${action} failed in guild ${ctx.guild.id}: ${(err as Error).stack ?? err}`,
        );
        await i
          .reply({
            content: 'Something went wrong saving that. Please try again.',
            ephemeral: true,
          })
          .catch(() => undefined);
      }
    });

    collector.on('end', async (_c, reason) => {
      if (reason !== 'time') return;
      await interaction
        .editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('Setup closed')
              .setDescription(
                'Everything you changed is saved. Run `/setup` any time to carry on.',
              ),
          ],
          components: [],
        })
        .catch(() => undefined);
    });
  },
};

const WELCOME =
  "👋 **Welcome!** Here's everything this bot can do. **Quick start** walks you through the three essentials, or pick any feature from the menu. " +
  'Skip anything you like: every feature works with sensible defaults, and you can come back with `/setup` any time.';

async function hostFacts(guildId: string): Promise<HostFacts> {
  return {
    messageContent: config.ENABLE_MESSAGE_CONTENT,
    guildMembers: config.ENABLE_GUILD_MEMBERS,
    presence: config.ENABLE_PRESENCE,
    music: config.ENABLE_MUSIC,
    twitchOrYoutube: Boolean(
      (config.TWITCH_CLIENT_ID && config.TWITCH_CLIENT_SECRET) || config.YOUTUBE_API_KEY,
    ),
    steamOrRiot: Boolean(config.STEAM_API_KEY || config.RIOT_API_KEY),
    modRoleCount: (await getConfiguredRoleIds(guildId, 'moderation')).length,
    adminRoleCount: (await getConfiguredRoleIds(guildId, 'admin')).length,
  };
}

async function renderMap(ctx: PanelCtx, notice?: string): Promise<Rendered> {
  const statuses = featureStatuses(ctx.gc, await hostFacts(ctx.guild.id));
  const embed = new EmbedBuilder()
    .setTitle('🧭 Server setup — feature map')
    .setColor(0x5865f2)
    .setDescription(
      `${notice ? `${notice}\n\n` : ''}${STATE_ICON.on} on · ${STATE_ICON.off} off · ${STATE_ICON.needs} on, but needs something\n` +
        'Pick a feature below to turn it on or off and choose its channels and roles.',
    )
    .addFields(featureMapFields(statuses))
    .setFooter({ text: 'Changes save as soon as you make them. Nothing here is required.' });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('setup:nav:open')
    .setPlaceholder('Set up a feature…')
    .addOptions(
      statuses.map((s) => ({
        label: s.name.slice(0, 100),
        value: s.id,
        emoji: s.emoji,
        description: `${s.state === 'on' ? 'On' : s.state === 'off' ? 'Off' : 'Needs attention'}`,
      })),
    );
  const buttons = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('setup:nav:quick')
      .setLabel('Quick start (3 essentials)')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🚀'),
    new ButtonBuilder()
      .setCustomId('setup:nav:done')
      .setLabel(ctx.gc.setupCompleted ? 'Done' : 'Skip for now / Done')
      .setStyle(ButtonStyle.Success),
  );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu),
      buttons,
    ],
  };
}

function navRow(quickStep: number | null): Row {
  const inQuick = quickStep !== null;
  const last = inQuick && quickStep === QUICK_START.length - 1;
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('setup:nav:next')
      .setLabel(inQuick ? (last ? 'Finish quick start ▶' : 'Next / Skip ▶') : 'Skip — back to map')
      .setStyle(inQuick ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ...(inQuick
      ? [
          new ButtonBuilder()
            .setCustomId('setup:nav:map')
            .setLabel('◀ Feature map')
            .setStyle(ButtonStyle.Secondary),
        ]
      : []),
    new ButtonBuilder()
      .setCustomId('setup:nav:done')
      .setLabel('Done')
      .setStyle(ButtonStyle.Success),
  );
}

async function renderDone(ctx: PanelCtx): Promise<Rendered> {
  const statuses = featureStatuses(ctx.gc, await hostFacts(ctx.guild.id));
  const on = statuses.filter((s) => s.state !== 'off').length;
  const needs = statuses.filter((s) => s.state === 'needs');
  const embed = new EmbedBuilder()
    .setTitle('Setup saved ✅')
    .setColor(0x57f287)
    .setDescription(
      `${on} of ${statuses.length} features are on.` +
        (needs.length
          ? `\n\n**Still needs attention:**\n${needs.map((s) => `${STATE_ICON.needs} ${s.emoji} ${s.name} — ${s.detail}`).join('\n')}`
          : '') +
        '\n\nRun `/setup` any time to change things, or `/config view` for a quick summary.',
    );
  return { embeds: [embed], components: [] };
}
