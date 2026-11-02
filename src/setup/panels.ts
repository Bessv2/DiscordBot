// One screen per feature in the /setup wizard. Each panel says what the
// feature is for (principle #7), shows its current settings, and offers
// point-and-click controls — channel/role pickers, on/off buttons, and
// small forms for numbers and text. Every screen has a Skip button.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  Guild,
  GuildMember,
  MessageActionRowComponentBuilder,
  MessageComponentInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { GuildConfig } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../lib/db';
import { checkRoleAssignable } from '../lib/moderationGuard';
import { getModule, isModuleOn, ModuleId, setModuleOn } from '../lib/modules';
import { getConfiguredRoleIds, setPermissionRoles } from '../lib/permissions';
import { normalizeGame, parseMapList, MAX_MAPS_PER_GAME } from '../lib/maps';
import { parseIntInRange, parseYesNo } from './status';
import { parseStringList } from '../lib/jsonList';
import { SERVER_LOG_EVENTS } from '../serverlog/events';
import { buildTicketPanel } from '../features/tickets';
import { buildVerifyPanel } from '../features/joinRoles';

export type PanelId = ModuleId | 'modlog' | 'permissions' | 'appeals';
type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

export interface PanelCtx {
  guild: Guild;
  invoker: GuildMember;
  gc: GuildConfig;
  /** Set while walking the quick-start path, e.g. "Quick start · step 2 of 3". */
  stepLabel: string | null;
}

export interface Rendered {
  embeds: EmbedBuilder[];
  components: Row[];
}

/** What a click did: a note to show, and the form submission to answer with if a form was used. */
export interface HandleResult {
  notice?: string;
  /** undefined: answer the click itself. null: the form was closed or timed out, so there's nothing to answer. */
  modal?: ModalSubmitInteraction | null;
}

interface Panel {
  render(ctx: PanelCtx): Promise<{ embed: EmbedBuilder; rows: Row[] }>;
  handle?(i: MessageComponentInteraction, action: string, ctx: PanelCtx): Promise<HandleResult>;
}

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;
const id = (panel: PanelId, action: string) => `setup:${panel}:${action}`;

// ── building blocks ───────────────────────────────────────────────────────

function channelPicker(
  panel: PanelId,
  action: string,
  placeholder: string,
  current: string | null,
  types: readonly ChannelType[] = TEXT_CHANNELS,
): Row {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(id(panel, action))
    .setPlaceholder(placeholder)
    .setChannelTypes(...(types as ChannelType[]))
    .setMinValues(1)
    .setMaxValues(1);
  if (current) menu.setDefaultChannels(current);
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
}

function rolePicker(
  panel: PanelId,
  action: string,
  placeholder: string,
  current: string[],
  max = 1,
): Row {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(id(panel, action))
    .setPlaceholder(placeholder)
    .setMinValues(0)
    .setMaxValues(max);
  if (current.length) menu.setDefaultRoles(...current.slice(0, max));
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
}

function button(
  panel: PanelId,
  action: string,
  label: string,
  style = ButtonStyle.Secondary,
): ButtonBuilder {
  return new ButtonBuilder().setCustomId(id(panel, action)).setLabel(label).setStyle(style);
}

function toggleButton(panel: PanelId, on: boolean): ButtonBuilder {
  return button(
    panel,
    'toggle',
    on ? 'Turn off' : 'Turn on',
    on ? ButtonStyle.Danger : ButtonStyle.Success,
  );
}

function row(...buttons: ButtonBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons);
}

function baseEmbed(ctx: PanelCtx, title: string, why: string, on: boolean | null): EmbedBuilder {
  const status = on === null ? '' : on ? '\n\n**Status:** ✅ on' : '\n\n**Status:** ⬜ off';
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`${why}${status}`)
    .setColor(on === false ? 0x99aab5 : 0x5865f2)
    .setFooter({ text: ctx.stepLabel ?? 'Changes save as soon as you make them.' });
}

function hostNote(text: string): { name: string; value: string } {
  return { name: '⚠️ Needs the bot host', value: text };
}

/** A small form. Returns the submission, or null if it was closed or timed out. */
async function askForm(
  i: MessageComponentInteraction,
  title: string,
  fields: { id: string; label: string; value: string; style?: TextInputStyle; max?: number }[],
): Promise<ModalSubmitInteraction | null> {
  const modal = new ModalBuilder().setCustomId(`setup_form:${i.id}`).setTitle(title.slice(0, 45));
  for (const f of fields) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(f.id)
          .setLabel(f.label.slice(0, 45))
          .setStyle(f.style ?? TextInputStyle.Short)
          .setValue(f.value.slice(0, f.max ?? 4000))
          .setRequired(false)
          .setMaxLength(f.max ?? 4000),
      ),
    );
  }
  await i.showModal(modal);
  return i
    .awaitModalSubmit({
      time: 5 * 60_000,
      filter: (m) => m.customId === `setup_form:${i.id}` && m.user.id === i.user.id,
    })
    .catch(() => null);
}

async function update(ctx: PanelCtx, data: Partial<GuildConfig>): Promise<void> {
  ctx.gc = await prisma.guildConfig.update({ where: { id: ctx.guild.id }, data });
}

async function toggleModule(ctx: PanelCtx, moduleId: ModuleId): Promise<string> {
  const now = !isModuleOn(ctx.gc, moduleId);
  await setModuleOn(ctx.guild.id, moduleId, now);
  ctx.gc = await prisma.guildConfig.findUniqueOrThrow({ where: { id: ctx.guild.id } });
  return `${getModule(moduleId).name} is now **${now ? 'on' : 'off'}**.`;
}

/** Number fields: keep the old value for anything blank or out of range, and say so. */
function readNumbers<K extends string>(
  sub: ModalSubmitInteraction,
  spec: Record<K, { min: number; max: number; current: number; label: string }>,
): { values: Record<K, number>; rejected: string[] } {
  const values = {} as Record<K, number>;
  const rejected: string[] = [];
  for (const key of Object.keys(spec) as K[]) {
    const s = spec[key];
    const raw = sub.fields.getTextInputValue(key);
    const parsed = raw.trim() === '' ? s.current : parseIntInRange(raw, s.min, s.max);
    if (parsed === null) rejected.push(`${s.label} (must be ${s.min}–${s.max})`);
    values[key] = parsed ?? s.current;
  }
  return { values, rejected };
}

/** Section 7: member message text in logs is opt-in and expires. Shared by the auto-mod and server-log screens. */
function textRetentionButtons(panel: PanelId, gc: GuildConfig): ButtonBuilder[] {
  return [
    button(
      panel,
      'keeptext',
      gc.logMessageContent ? 'Keep message text: on' : 'Keep message text: off',
    ),
    button(panel, 'retain', `Keep it for ${gc.contentRetainDays} days…`),
  ];
}

const TEXT_RETENTION_HELP =
  '**Message text in logs** is off unless you turn it on. When on, the text of deleted/edited or caught messages is shown in the log, then edited out after the number of days you pick.';

async function handleTextRetention(
  i: MessageComponentInteraction,
  action: string,
  ctx: PanelCtx,
): Promise<HandleResult | null> {
  if (action === 'keeptext') {
    await update(ctx, { logMessageContent: !ctx.gc.logMessageContent });
    return {
      notice: ctx.gc.logMessageContent
        ? `Message text will be kept in logs for ${ctx.gc.contentRetainDays} days, then removed.`
        : 'Message text is no longer kept in logs. Entries still show who, where and when.',
    };
  }
  if (action === 'retain') {
    const sub = await askForm(i, 'Keep message text for…', [
      { id: 'days', label: 'Days (1-365)', value: String(ctx.gc.contentRetainDays), max: 3 },
    ]);
    if (!sub) return { modal: null };
    const { values, rejected } = readNumbers(sub, {
      days: { min: 1, max: 365, current: ctx.gc.contentRetainDays, label: 'days' },
    });
    await update(ctx, { contentRetainDays: values.days });
    return {
      modal: sub,
      notice: `Message text is removed from logs after ${values.days} day(s).${keptNote(rejected)}`,
    };
  }
  return null;
}

const keptNote = (rejected: string[]) =>
  rejected.length ? ` Kept the old value for: ${rejected.join(', ')}.` : '';

// ── the panels ────────────────────────────────────────────────────────────

const panels: Record<PanelId, Panel> = {
  modlog: {
    async render(ctx) {
      const embed = baseEmbed(
        ctx,
        '📋 Mod-log channel',
        'Every warn, kick, ban, timeout, mute and auto-mod action is posted here, with who did it and why. ' +
          "It's your server's record for settling disputes later. Pick a channel only staff can see.",
        null,
      ).addFields({
        name: 'Current channel',
        value: ctx.gc.modLogChannelId ? `<#${ctx.gc.modLogChannelId}>` : 'not set',
      });
      return {
        embed,
        rows: [
          channelPicker('modlog', 'channel', 'Pick the mod-log channel', ctx.gc.modLogChannelId),
        ],
      };
    },
    async handle(i, action, ctx) {
      if (action === 'channel' && i.isChannelSelectMenu()) {
        await update(ctx, { modLogChannelId: i.values[0] });
        return { notice: `Mod-log set to <#${i.values[0]}>.` };
      }
      return {};
    },
  },

  permissions: {
    async render(ctx) {
      const mod = await getConfiguredRoleIds(ctx.guild.id, 'moderation');
      const admin = await getConfiguredRoleIds(ctx.guild.id, 'admin');
      const embed = baseEmbed(
        ctx,
        '🔑 Who can moderate',
        "By default, Discord's own permissions decide: anyone who can kick can `/kick`, anyone with Manage Server can `/setup`. " +
          'Pick roles here to decide it yourself instead. Leave a picker empty to keep the default.',
        null,
      ).addFields(
        {
          name: 'Moderation roles (warn/kick/ban/timeout/mute)',
          value: mod.length ? mod.map((r) => `<@&${r}>`).join(' ') : 'Discord default',
        },
        {
          name: 'Admin roles (/setup, /config)',
          value: admin.length ? admin.map((r) => `<@&${r}>`).join(' ') : 'Discord default',
        },
      );
      return {
        embed,
        rows: [
          rolePicker('permissions', 'mod', 'Moderation roles (empty = Discord default)', mod, 10),
          rolePicker('permissions', 'admin', 'Admin roles (empty = Discord default)', admin, 10),
          row(button('permissions', 'reset', 'Use Discord defaults for both')),
        ],
      };
    },
    async handle(i, action, ctx) {
      if ((action === 'mod' || action === 'admin') && i.isRoleSelectMenu()) {
        await setPermissionRoles(ctx.guild.id, action === 'mod' ? 'moderation' : 'admin', i.values);
        return { notice: `${action === 'mod' ? 'Moderation' : 'Admin'} roles saved.` };
      }
      if (action === 'reset') {
        await setPermissionRoles(ctx.guild.id, 'moderation', []);
        await setPermissionRoles(ctx.guild.id, 'admin', []);
        return { notice: "Back to Discord's own permissions." };
      }
      return {};
    },
  },

  appeals: {
    async render(ctx) {
      const embed = baseEmbed(
        ctx,
        '📨 Appeals channel',
        'When someone is warned, muted, kicked or banned, their DM includes an **Appeal** button. Their appeal is posted here for staff to accept or deny. ' +
          'Leave it unset to post appeals in the mod-log channel.',
        null,
      ).addFields({
        name: 'Current channel',
        value: ctx.gc.appealChannelId ? `<#${ctx.gc.appealChannelId}>` : 'uses the mod-log channel',
      });
      return {
        embed,
        rows: [
          channelPicker('appeals', 'channel', 'Pick the appeals channel', ctx.gc.appealChannelId),
          row(button('appeals', 'clear', 'Use the mod-log channel')),
        ],
      };
    },
    async handle(i, action, ctx) {
      if (action === 'channel' && i.isChannelSelectMenu()) {
        await update(ctx, { appealChannelId: i.values[0] });
        return { notice: `Appeals go to <#${i.values[0]}>.` };
      }
      if (action === 'clear') {
        await update(ctx, { appealChannelId: null });
        return { notice: 'Appeals go to the mod-log channel.' };
      }
      return {};
    },
  },

  automod: {
    async render(ctx) {
      const gc = ctx.gc;
      const embed = baseEmbed(
        ctx,
        '🛡️ Auto-mod',
        'Deletes spam the moment it happens, even when no moderator is online, and logs each catch to the mod-log. Moderators (anyone with Manage Messages) are never filtered.\n\n' +
          TEXT_RETENTION_HELP,
        gc.automodEnabled,
      ).addFields(
        {
          name: 'Flood detection',
          value: `${gc.spamMessageLimit} messages within ${gc.spamIntervalMs / 1000}s`,
          inline: true,
        },
        {
          name: 'Mention spam',
          value: `${gc.mentionSpamLimit}+ mentions in one message`,
          inline: true,
        },
        { name: 'Invite-link filter', value: gc.inviteFilterOn ? 'on' : 'off', inline: true },
        {
          name: 'Banned-word filter',
          value: gc.wordFilterOn
            ? `on (${(JSON.parse(gc.bannedWords) as string[]).length} words)`
            : 'off',
          inline: true,
        },
      );
      if (!config.ENABLE_MESSAGE_CONTENT) {
        embed.addFields(
          hostNote(
            'Flood detection works now. The invite filter, word filter and mention-spam check need **Message Content** turned on (ENABLE_MESSAGE_CONTENT) by whoever runs the bot.',
          ),
        );
      }
      return {
        embed,
        rows: [
          row(
            toggleButton('automod', gc.automodEnabled),
            button('automod', 'limits', 'Change limits…', ButtonStyle.Primary),
            button(
              'automod',
              'invite',
              gc.inviteFilterOn ? 'Invite filter: on' : 'Invite filter: off',
            ),
            button('automod', 'words', 'Banned words…'),
          ),
          row(...textRetentionButtons('automod', gc)),
        ],
      };
    },
    async handle(i, action, ctx) {
      const gc = ctx.gc;
      const retention = await handleTextRetention(i, action, ctx);
      if (retention) return retention;
      if (action === 'toggle') {
        await update(ctx, { automodEnabled: !gc.automodEnabled });
        return { notice: `Auto-mod is now **${ctx.gc.automodEnabled ? 'on' : 'off'}**.` };
      }
      if (action === 'invite') {
        await update(ctx, { inviteFilterOn: !gc.inviteFilterOn });
        return { notice: `Invite-link filter **${ctx.gc.inviteFilterOn ? 'on' : 'off'}**.` };
      }
      if (action === 'limits') {
        const sub = await askForm(i, 'Auto-mod limits', [
          {
            id: 'spam',
            label: 'Messages before it counts as flooding',
            value: String(gc.spamMessageLimit),
            max: 3,
          },
          {
            id: 'seconds',
            label: '...within how many seconds',
            value: String(gc.spamIntervalMs / 1000),
            max: 3,
          },
          {
            id: 'mentions',
            label: 'Mentions in one message = spam',
            value: String(gc.mentionSpamLimit),
            max: 3,
          },
        ]);
        if (!sub) return { modal: null };
        const { values, rejected } = readNumbers(sub, {
          spam: { min: 2, max: 50, current: gc.spamMessageLimit, label: 'messages' },
          seconds: { min: 1, max: 120, current: gc.spamIntervalMs / 1000, label: 'seconds' },
          mentions: { min: 2, max: 50, current: gc.mentionSpamLimit, label: 'mentions' },
        });
        await update(ctx, {
          spamMessageLimit: values.spam,
          spamIntervalMs: values.seconds * 1000,
          mentionSpamLimit: values.mentions,
        });
        return { modal: sub, notice: `Limits saved.${keptNote(rejected)}` };
      }
      if (action === 'words') {
        const current = JSON.parse(gc.bannedWords) as string[];
        const sub = await askForm(i, 'Banned words', [
          {
            id: 'words',
            label: 'Words or phrases, one per line or comma',
            value: current.join('\n'),
            style: TextInputStyle.Paragraph,
            max: 4000,
          },
          { id: 'on', label: 'Filter on? (yes/no)', value: gc.wordFilterOn ? 'yes' : 'no', max: 3 },
        ]);
        if (!sub) return { modal: null };
        const words = [
          ...new Set(
            sub.fields
              .getTextInputValue('words')
              .split(/[\n,]/)
              .map((w) => w.trim().toLowerCase())
              .filter(Boolean),
          ),
        ].slice(0, 500);
        const on = parseYesNo(sub.fields.getTextInputValue('on')) ?? gc.wordFilterOn;
        await update(ctx, { bannedWords: JSON.stringify(words), wordFilterOn: on });
        return {
          modal: sub,
          notice: `Saved ${words.length} word(s); word filter **${on ? 'on' : 'off'}**.`,
        };
      }
      return {};
    },
  },

  antiraid: {
    async render(ctx) {
      const gc = ctx.gc;
      const embed = baseEmbed(
        ctx,
        '🚨 Anti-raid',
        'A raid is a wave of accounts joining at once to spam. This spots the wave and warns your mods. With auto-lockdown on, it also raises the server verification level until a mod runs `/lockdown off`.',
        gc.antiRaidEnabled,
      ).addFields(
        {
          name: 'Trigger',
          value: `${gc.raidJoinThreshold} joins within ${gc.raidIntervalMs / 1000}s`,
          inline: true,
        },
        { name: 'Auto-lockdown', value: gc.raidAutoLockdown ? 'on' : 'off', inline: true },
      );
      if (!config.ENABLE_GUILD_MEMBERS)
        embed.addFields(
          hostNote(
            'This needs **Server Members** turned on (ENABLE_GUILD_MEMBERS) by whoever runs the bot, or it never sees anyone join.',
          ),
        );
      return {
        embed,
        rows: [
          row(
            toggleButton('antiraid', gc.antiRaidEnabled),
            button('antiraid', 'limits', 'Change trigger…', ButtonStyle.Primary),
            button(
              'antiraid',
              'lockdown',
              gc.raidAutoLockdown ? 'Auto-lockdown: on' : 'Auto-lockdown: off',
            ),
          ),
        ],
      };
    },
    async handle(i, action, ctx) {
      const gc = ctx.gc;
      if (action === 'toggle') {
        await update(ctx, { antiRaidEnabled: !gc.antiRaidEnabled });
        return { notice: `Anti-raid is now **${ctx.gc.antiRaidEnabled ? 'on' : 'off'}**.` };
      }
      if (action === 'lockdown') {
        await update(ctx, { raidAutoLockdown: !gc.raidAutoLockdown });
        return { notice: `Auto-lockdown **${ctx.gc.raidAutoLockdown ? 'on' : 'off'}**.` };
      }
      if (action === 'limits') {
        const sub = await askForm(i, 'Anti-raid trigger', [
          {
            id: 'joins',
            label: 'Joins that count as a raid',
            value: String(gc.raidJoinThreshold),
            max: 3,
          },
          {
            id: 'seconds',
            label: '...within how many seconds',
            value: String(gc.raidIntervalMs / 1000),
            max: 4,
          },
        ]);
        if (!sub) return { modal: null };
        const { values, rejected } = readNumbers(sub, {
          joins: { min: 2, max: 500, current: gc.raidJoinThreshold, label: 'joins' },
          seconds: { min: 5, max: 3600, current: gc.raidIntervalMs / 1000, label: 'seconds' },
        });
        await update(ctx, {
          raidJoinThreshold: values.joins,
          raidIntervalMs: values.seconds * 1000,
        });
        return { modal: sub, notice: `Trigger saved.${keptNote(rejected)}` };
      }
      return {};
    },
  },

  welcome: {
    async render(ctx) {
      const gc = ctx.gc;
      const embed = baseEmbed(
        ctx,
        '👋 Welcome & goodbye',
        'Greets each new member in a channel of your choice, and can note when someone leaves. Messages can use `{user}`, `{server}` and `{membercount}`.',
        gc.welcomeEnabled,
      ).addFields(
        {
          name: 'Welcome',
          value:
            `${gc.welcomeChannelId ? `<#${gc.welcomeChannelId}>` : 'no channel yet'}\n> ${gc.welcomeMessage}`.slice(
              0,
              1024,
            ),
        },
        {
          name: 'Goodbye',
          value:
            `${gc.goodbyeChannelId ? `<#${gc.goodbyeChannelId}>` : 'off (no channel)'}\n> ${gc.goodbyeMessage}`.slice(
              0,
              1024,
            ),
        },
      );
      if (!config.ENABLE_GUILD_MEMBERS)
        embed.addFields(
          hostNote(
            'This needs **Server Members** turned on (ENABLE_GUILD_MEMBERS) by whoever runs the bot, or it never sees anyone join.',
          ),
        );
      return {
        embed,
        rows: [
          channelPicker('welcome', 'channel', 'Welcome channel', gc.welcomeChannelId),
          channelPicker('welcome', 'goodbye', 'Goodbye channel (optional)', gc.goodbyeChannelId),
          row(
            toggleButton('welcome', gc.welcomeEnabled),
            button('welcome', 'text', 'Edit messages…', ButtonStyle.Primary),
            button('welcome', 'nogoodbye', 'No goodbye messages'),
          ),
        ],
      };
    },
    async handle(i, action, ctx) {
      const gc = ctx.gc;
      if (action === 'toggle') {
        await update(ctx, { welcomeEnabled: !gc.welcomeEnabled });
        return {
          notice: `Welcome messages **${ctx.gc.welcomeEnabled ? 'on' : 'off'}**.${ctx.gc.welcomeEnabled && !ctx.gc.welcomeChannelId ? ' Now pick a channel.' : ''}`,
        };
      }
      if (action === 'channel' && i.isChannelSelectMenu()) {
        // Picking a channel is a clear sign they want it on.
        await update(ctx, { welcomeChannelId: i.values[0], welcomeEnabled: true });
        return { notice: `Welcomes go to <#${i.values[0]}> and are on.` };
      }
      if (action === 'goodbye' && i.isChannelSelectMenu()) {
        await update(ctx, { goodbyeChannelId: i.values[0] });
        return { notice: `Goodbyes go to <#${i.values[0]}>.` };
      }
      if (action === 'nogoodbye') {
        await update(ctx, { goodbyeChannelId: null });
        return { notice: 'Goodbye messages off.' };
      }
      if (action === 'text') {
        const sub = await askForm(i, 'Welcome & goodbye messages', [
          {
            id: 'welcome',
            label: 'Welcome message',
            value: gc.welcomeMessage,
            style: TextInputStyle.Paragraph,
            max: 1000,
          },
          {
            id: 'goodbye',
            label: 'Goodbye message',
            value: gc.goodbyeMessage,
            style: TextInputStyle.Paragraph,
            max: 1000,
          },
        ]);
        if (!sub) return { modal: null };
        const welcome = sub.fields.getTextInputValue('welcome').trim() || gc.welcomeMessage;
        const goodbye = sub.fields.getTextInputValue('goodbye').trim() || gc.goodbyeMessage;
        await update(ctx, { welcomeMessage: welcome, goodbyeMessage: goodbye });
        return { modal: sub, notice: 'Messages saved. Try them with `/welcome test`.' };
      }
      return {};
    },
  },

  xp: {
    async render(ctx) {
      const gc = ctx.gc;
      const rewards = await prisma.levelRoleReward.findMany({
        where: { guildId: ctx.guild.id },
        orderBy: { level: 'asc' },
      });
      const embed = baseEmbed(
        ctx,
        '📈 Levels & XP',
        'Members earn XP for chatting (once per cooldown, so spamming does nothing) and level up. You can hand out roles at certain levels as a reward for being active. Members check theirs with `/rank`.',
        gc.xpEnabled,
      ).addFields(
        {
          name: 'XP per message',
          value: `${gc.xpMinPerMsg}–${gc.xpMaxPerMsg}, at most once every ${gc.xpCooldownSec}s`,
          inline: true,
        },
        {
          name: 'Role rewards',
          value: rewards.length
            ? rewards
                .map((r) => `Level ${r.level} → <@&${r.roleId}>`)
                .join('\n')
                .slice(0, 1024)
            : 'none yet',
        },
      );
      return {
        embed,
        rows: [
          row(
            toggleButton('xp', gc.xpEnabled),
            button('xp', 'rates', 'Change XP rates…', ButtonStyle.Primary),
            button('xp', 'clear', 'Remove all role rewards'),
          ),
          rolePicker('xp', 'reward', 'Add a role reward: pick the role…', []),
        ],
      };
    },
    async handle(i, action, ctx) {
      const gc = ctx.gc;
      if (action === 'toggle') {
        await update(ctx, { xpEnabled: !gc.xpEnabled });
        return { notice: `Levels **${ctx.gc.xpEnabled ? 'on' : 'off'}**.` };
      }
      if (action === 'clear') {
        const { count } = await prisma.levelRoleReward.deleteMany({
          where: { guildId: ctx.guild.id },
        });
        return { notice: `Removed ${count} role reward(s).` };
      }
      if (action === 'rates') {
        const sub = await askForm(i, 'XP rates', [
          { id: 'min', label: 'Least XP per message', value: String(gc.xpMinPerMsg), max: 4 },
          { id: 'max', label: 'Most XP per message', value: String(gc.xpMaxPerMsg), max: 4 },
          {
            id: 'cooldown',
            label: 'Seconds between XP gains',
            value: String(gc.xpCooldownSec),
            max: 4,
          },
        ]);
        if (!sub) return { modal: null };
        const { values, rejected } = readNumbers(sub, {
          min: { min: 1, max: 1000, current: gc.xpMinPerMsg, label: 'least XP' },
          max: { min: 1, max: 1000, current: gc.xpMaxPerMsg, label: 'most XP' },
          cooldown: { min: 0, max: 3600, current: gc.xpCooldownSec, label: 'cooldown' },
        });
        if (values.max < values.min) [values.min, values.max] = [values.max, values.min];
        await update(ctx, {
          xpMinPerMsg: values.min,
          xpMaxPerMsg: values.max,
          xpCooldownSec: values.cooldown,
        });
        return { modal: sub, notice: `XP rates saved.${keptNote(rejected)}` };
      }
      if (action === 'reward' && i.isRoleSelectMenu()) {
        const role = i.roles.first();
        if (!role) return { notice: 'Pick a role to reward.' };
        const ok = await checkRoleAssignable(ctx.guild, ctx.invoker, role);
        if (!ok.allowed) return { notice: `⚠️ ${ok.reason}` };
        const sub = await askForm(i, `Reward: ${role.name}`, [
          { id: 'level', label: 'Give this role at which level?', value: '5', max: 4 },
        ]);
        if (!sub) return { modal: null };
        const level = parseIntInRange(sub.fields.getTextInputValue('level'), 1, 1000);
        if (level === null)
          return {
            modal: sub,
            notice: '⚠️ The level has to be a whole number from 1 to 1000. Nothing was saved.',
          };
        await prisma.levelRoleReward.upsert({
          where: { guildId_level: { guildId: ctx.guild.id, level } },
          create: { guildId: ctx.guild.id, level, roleId: role.id },
          update: { roleId: role.id },
        });
        return { modal: sub, notice: `Level ${level} now gives <@&${role.id}>.` };
      }
      return {};
    },
  },

  economy: {
    async render(ctx) {
      const gc = ctx.gc;
      const embed = baseEmbed(
        ctx,
        '💰 Economy',
        'Play-money credits members earn with `/economy daily` and win at slots or trivia, with a `/leaderboard`. Purely for fun: nothing is real money.',
        gc.economyEnabled,
      ).addFields(
        { name: 'Daily bonus', value: `${gc.economyDailyAmount} credits`, inline: true },
        { name: 'Starting balance', value: `${gc.economyStartingBalance} credits`, inline: true },
      );
      return {
        embed,
        rows: [
          row(
            toggleButton('economy', gc.economyEnabled),
            button('economy', 'amounts', 'Change amounts…', ButtonStyle.Primary),
          ),
        ],
      };
    },
    async handle(i, action, ctx) {
      const gc = ctx.gc;
      if (action === 'toggle') {
        await update(ctx, { economyEnabled: !gc.economyEnabled });
        return { notice: `Economy **${ctx.gc.economyEnabled ? 'on' : 'off'}**.` };
      }
      if (action === 'amounts') {
        const sub = await askForm(i, 'Economy amounts', [
          {
            id: 'daily',
            label: 'Daily bonus (credits)',
            value: String(gc.economyDailyAmount),
            max: 7,
          },
          {
            id: 'start',
            label: 'Starting balance (credits)',
            value: String(gc.economyStartingBalance),
            max: 7,
          },
        ]);
        if (!sub) return { modal: null };
        const { values, rejected } = readNumbers(sub, {
          daily: { min: 0, max: 1_000_000, current: gc.economyDailyAmount, label: 'daily bonus' },
          start: {
            min: 0,
            max: 1_000_000,
            current: gc.economyStartingBalance,
            label: 'starting balance',
          },
        });
        await update(ctx, {
          economyDailyAmount: values.daily,
          economyStartingBalance: values.start,
        });
        return { modal: sub, notice: `Amounts saved.${keptNote(rejected)}` };
      }
      return {};
    },
  },

  starboard: {
    async render(ctx) {
      const gc = ctx.gc;
      const on = isModuleOn(gc, 'starboard');
      const embed = baseEmbed(
        ctx,
        '⭐ Starboard',
        "A highlights channel: when a message gets enough reactions with the starboard emoji, the bot reposts it there. It's how the funniest or most helpful posts get remembered.",
        on,
      ).addFields(
        {
          name: 'Channel',
          value: gc.starboardChannelId
            ? `<#${gc.starboardChannelId}>`
            : 'not set (pick one to start)',
          inline: true,
        },
        { name: 'Needs', value: `${gc.starboardThreshold} × ${gc.starboardEmoji}`, inline: true },
      );
      return {
        embed,
        rows: [
          channelPicker('starboard', 'channel', 'Starboard channel', gc.starboardChannelId),
          row(
            toggleButton('starboard', on),
            button('starboard', 'rules', 'Emoji & count…', ButtonStyle.Primary),
          ),
        ],
      };
    },
    async handle(i, action, ctx) {
      const gc = ctx.gc;
      if (action === 'toggle') return { notice: await toggleModule(ctx, 'starboard') };
      if (action === 'channel' && i.isChannelSelectMenu()) {
        await update(ctx, { starboardChannelId: i.values[0] });
        if (!isModuleOn(ctx.gc, 'starboard')) await toggleModule(ctx, 'starboard');
        return { notice: `Starboard posts go to <#${i.values[0]}>.` };
      }
      if (action === 'rules') {
        const sub = await askForm(i, 'Starboard rules', [
          { id: 'emoji', label: 'Emoji (paste it, e.g. ⭐)', value: gc.starboardEmoji, max: 64 },
          { id: 'count', label: 'Reactions needed', value: String(gc.starboardThreshold), max: 3 },
        ]);
        if (!sub) return { modal: null };
        const emoji = sub.fields.getTextInputValue('emoji').trim() || gc.starboardEmoji;
        const { values, rejected } = readNumbers(sub, {
          count: { min: 1, max: 100, current: gc.starboardThreshold, label: 'reactions needed' },
        });
        await update(ctx, { starboardEmoji: emoji, starboardThreshold: values.count });
        return {
          modal: sub,
          notice: `Starboard: ${values.count} × ${emoji}.${keptNote(rejected)}`,
        };
      }
      return {};
    },
  },

  birthdays: {
    async render(ctx) {
      const gc = ctx.gc;
      const on = isModuleOn(gc, 'birthdays');
      const embed = baseEmbed(
        ctx,
        '🎂 Birthdays',
        'Members save their birthday with `/birthday set`. On the day, the bot posts a happy birthday and can give them a special role for 24 hours.',
        on,
      ).addFields(
        {
          name: 'Announced in',
          value: gc.birthdayChannelId
            ? `<#${gc.birthdayChannelId}>`
            : 'nowhere yet (pick a channel)',
          inline: true,
        },
        {
          name: 'Birthday role',
          value: gc.birthdayRoleId ? `<@&${gc.birthdayRoleId}>` : 'none',
          inline: true,
        },
      );
      return {
        embed,
        rows: [
          channelPicker(
            'birthdays',
            'channel',
            'Where to announce birthdays',
            gc.birthdayChannelId,
          ),
          rolePicker(
            'birthdays',
            'role',
            'Birthday role (optional)',
            gc.birthdayRoleId ? [gc.birthdayRoleId] : [],
          ),
          row(toggleButton('birthdays', on), button('birthdays', 'norole', 'No birthday role')),
        ],
      };
    },
    async handle(i, action, ctx) {
      if (action === 'toggle') return { notice: await toggleModule(ctx, 'birthdays') };
      if (action === 'channel' && i.isChannelSelectMenu()) {
        await update(ctx, { birthdayChannelId: i.values[0] });
        return { notice: `Birthdays are announced in <#${i.values[0]}>.` };
      }
      if (action === 'role' && i.isRoleSelectMenu()) {
        const role = i.roles.first();
        if (!role) {
          await update(ctx, { birthdayRoleId: null });
          return { notice: 'No birthday role.' };
        }
        const ok = await checkRoleAssignable(ctx.guild, ctx.invoker, role);
        if (!ok.allowed) return { notice: `⚠️ ${ok.reason}` };
        await update(ctx, { birthdayRoleId: role.id });
        return { notice: `Birthday role set to <@&${role.id}>.` };
      }
      if (action === 'norole') {
        await update(ctx, { birthdayRoleId: null });
        return { notice: 'No birthday role.' };
      }
      return {};
    },
  },

  music: {
    async render(ctx) {
      const gc = ctx.gc;
      const on = isModuleOn(gc, 'music');
      const embed = baseEmbed(
        ctx,
        '🎵 Music & watch parties',
        '**`/jam`** starts YouTube **Watch Together** in your voice channel: everyone watches and listens in sync and can queue videos and playlists. It runs inside Discord, so it always works.\n\n' +
          '**`/music play`** has the bot itself join voice and play songs or whole playlists, with a shared queue, skip, shuffle and pause.',
        on,
      ).addFields(
        {
          name: '/music player',
          value: config.ENABLE_MUSIC
            ? 'available on this bot'
            : "off for this bot (its host hasn't turned it on)",
          inline: true,
        },
        {
          name: 'DJ role',
          value: gc.musicDjRoleId
            ? `<@&${gc.musicDjRoleId}> (others can only skip/remove their own songs)`
            : 'none: anyone listening can skip, shuffle or stop',
          inline: true,
        },
      );
      if (!config.ENABLE_MUSIC)
        embed.addFields(
          hostNote(
            'The `/music` player is a heavier add-on its host has to turn on (see **Music** in the README). `/jam` works either way.',
          ),
        );
      return {
        embed,
        rows: [
          rolePicker(
            'music',
            'dj',
            'DJ role (optional)',
            gc.musicDjRoleId ? [gc.musicDjRoleId] : [],
          ),
          row(toggleButton('music', on), button('music', 'nodj', 'No DJ role')),
        ],
      };
    },
    async handle(i, action, ctx) {
      if (action === 'toggle') return { notice: await toggleModule(ctx, 'music') };
      if (action === 'dj' && i.isRoleSelectMenu()) {
        const role = i.values[0] ?? null;
        await update(ctx, { musicDjRoleId: role });
        return { notice: role ? `DJ role set to <@&${role}>.` : 'No DJ role.' };
      }
      if (action === 'nodj') {
        await update(ctx, { musicDjRoleId: null });
        return { notice: 'No DJ role.' };
      }
      return {};
    },
  },

  maps: {
    async render(ctx) {
      const on = isModuleOn(ctx.gc, 'maps');
      const pools = await prisma.mapPool.groupBy({
        by: ['game'],
        where: { guildId: ctx.guild.id },
        _count: { _all: true },
        orderBy: { game: 'asc' },
      });
      const embed = baseEmbed(
        ctx,
        '🗺️ Game-night maps',
        'Keep a list of maps for each game you play. Then `/map random` picks the next one, or `/map vote` opens a Discord poll so everyone decides.',
        on,
      ).addFields({
        name: 'Map pools',
        value: pools.length
          ? pools
              .map((p) => `**${p.game}** — ${p._count._all} map(s)`)
              .join('\n')
              .slice(0, 1024)
          : 'none yet',
      });
      return {
        embed,
        rows: [
          row(
            toggleButton('maps', on),
            button('maps', 'add', 'Add maps for a game…', ButtonStyle.Primary),
          ),
        ],
      };
    },
    async handle(i, action, ctx) {
      if (action === 'toggle') return { notice: await toggleModule(ctx, 'maps') };
      if (action === 'add') {
        const sub = await askForm(i, 'Add maps', [
          { id: 'game', label: 'Game', value: '', max: 50 },
          {
            id: 'maps',
            label: 'Maps, separated by commas or lines',
            value: '',
            style: TextInputStyle.Paragraph,
            max: 4000,
          },
        ]);
        if (!sub) return { modal: null };
        const gameRaw = sub.fields.getTextInputValue('game').trim();
        const { maps } = parseMapList(sub.fields.getTextInputValue('maps'));
        if (!gameRaw || maps.length === 0)
          return {
            modal: sub,
            notice: '⚠️ Give a game name and at least one map. Nothing was saved.',
          };
        const game = normalizeGame(gameRaw);
        const existing = new Set(
          (
            await prisma.mapPool.findMany({
              where: { guildId: ctx.guild.id, game },
              select: { name: true },
            })
          ).map((m) => m.name.toLowerCase()),
        );
        const fresh = maps
          .filter((m) => !existing.has(m.toLowerCase()))
          .slice(0, Math.max(MAX_MAPS_PER_GAME - existing.size, 0));
        for (const name of fresh)
          await prisma.mapPool.create({ data: { guildId: ctx.guild.id, game, name } });
        return { modal: sub, notice: `Added ${fresh.length} map(s) for **${gameRaw}**.` };
      }
      return {};
    },
  },

  // Modules whose settings live in their own commands (each entry needs a
  // message, a game name, a channel to watch...). Their panel explains the
  // feature, offers the on/off switch, and shows the command to use.
  reactionroles: simplePanel(
    'reactionroles',
    '🎭 Reaction roles',
    'Members give themselves roles by reacting to a message, e.g. 🎮 for a Gamers role or 🔔 for announcements.',
    [
      'Post the message you want people to react to.',
      'Run `/reactionrole create` with its message ID, the emoji, and the role.',
    ],
  ),
  tags: simplePanel(
    'tags',
    '🏷️ Custom commands (tags)',
    'Saved replies for things you explain often, like rules, how to join the game server, or FAQ answers. Anyone can call one up.',
    ['`/tag create name:rules content:...` saves one.', '`/tag show name:rules` posts it.'],
  ),
  quotes: simplePanel(
    'quotes',
    '💬 Quote book',
    'An archive of memorable lines from your community.',
    ['`/quote add` saves a quote.', '`/quote random` pulls one up.'],
  ),
  polls: simplePanel('polls', '📊 Polls', 'Quick reaction polls with up to 5 options.', [
    '`/poll question:... options:"pizza, tacos"`',
  ]),
  reminders: simplePanel(
    'reminders',
    '⏰ Reminders',
    'Members ask the bot to ping them later about something.',
    ['`/remind time:2h message:check the oven`'],
  ),
  fun: simplePanel(
    'fun',
    '🎲 Dice & fun',
    'Dice for tabletop games (`/roll 2d6+3`), coin flips, and the magic 8-ball.',
    ['`/roll`, `/coinflip`, `/8ball`'],
  ),
  trivia: simplePanel(
    'trivia',
    '❓ Trivia',
    'Quiz rounds in a channel with answer buttons. Comes with questions built in; admins can import their own.',
    ['`/trivia start rounds:5`', '`/trivia import` with a JSON file of your own questions.'],
  ),
  lfg: simplePanel(
    'lfg',
    '🙋 Looking for group',
    'Post "who wants to play X?" with a join button. When the group fills, everyone gets pinged.',
    ['`/lfg game:Valorant size:5`'],
  ),
  tournaments: simplePanel(
    'tournaments',
    '🏆 Tournaments',
    'Simple single-elimination brackets for game nights.',
    [
      '`/tournament create name:...`, then players `/tournament join`.',
      '`/tournament start`, then report winners with `/tournament report`.',
    ],
  ),
  gameservers: simplePanel(
    'gameservers',
    '🖥️ Game servers & stats',
    'Check whether a game server (Minecraft, Valheim, ARK, and many more) is up and how many are playing. Look up Steam and League of Legends profiles too.',
    ['`/gameserver type:minecraft host:play.example.com`', '`/gamestats steam` / `/gamestats lol`'],
    () =>
      config.STEAM_API_KEY || config.RIOT_API_KEY
        ? null
        : 'Profile lookups need a Steam or Riot API key from whoever runs the bot. Server status works without one.',
  ),
  streams: simplePanel(
    'streams',
    '📺 Stream alerts',
    'Posts in a channel when a Twitch or YouTube channel goes live, so nobody misses a stream.',
    ['`/streamwatch add platform:twitch channel_name:... post_in:#streams`'],
    () =>
      config.TWITCH_CLIENT_ID || config.YOUTUBE_API_KEY
        ? null
        : 'This needs a Twitch or YouTube API key from whoever runs the bot.',
  ),
  prefix: {
    async render(ctx) {
      const gc = ctx.gc;
      const embed = baseEmbed(
        ctx,
        '❗ Legacy ! commands',
        'For mods who prefer typing old-style commands: `!warn @user reason`, `!kick`, `!ban` and `!cases`. They use the same permissions and case history as the slash commands.',
        gc.prefixCommandsOn,
      ).addFields({ name: 'Prefix', value: `\`${gc.prefix}\``, inline: true });
      if (!config.ENABLE_PREFIX_COMMANDS || !config.ENABLE_MESSAGE_CONTENT) {
        embed.addFields(
          hostNote(
            'These need **ENABLE_PREFIX_COMMANDS=true** and **Message Content** (ENABLE_MESSAGE_CONTENT) turned on by whoever runs the bot.',
          ),
        );
      }
      return {
        embed,
        rows: [
          row(
            toggleButton('prefix', gc.prefixCommandsOn),
            button('prefix', 'change', 'Change prefix…', ButtonStyle.Primary),
          ),
        ],
      };
    },
    async handle(i, action, ctx) {
      if (action === 'toggle') return { notice: await toggleModule(ctx, 'prefix') };
      if (action === 'change') {
        const sub = await askForm(i, 'Command prefix', [
          {
            id: 'prefix',
            label: 'Prefix (1-3 characters, e.g. ! or ?)',
            value: ctx.gc.prefix,
            max: 3,
          },
        ]);
        if (!sub) return { modal: null };
        const prefix = sub.fields.getTextInputValue('prefix').trim();
        if (!prefix || /\s/.test(prefix))
          return {
            modal: sub,
            notice: '⚠️ The prefix must be 1-3 characters with no spaces. Nothing was saved.',
          };
        await update(ctx, { prefix });
        return { modal: sub, notice: `Prefix is now \`${prefix}\`.` };
      }
      return {};
    },
  },

  serverlog: {
    async render(ctx) {
      const gc = ctx.gc;
      const on = isModuleOn(gc, 'serverlog');
      const offList = parseStringList(gc.serverLogEvents);
      const embed = baseEmbed(
        ctx,
        '📜 Server logs',
        'A channel recording what happens on the server, so your mods can see who deleted a message, who left, or who changed a role, even when nobody was watching. Pick a channel only staff can see.\n\n' +
          TEXT_RETENTION_HELP,
        on,
      ).addFields(
        {
          name: 'Log channel',
          value: gc.serverLogChannelId
            ? `<#${gc.serverLogChannelId}>`
            : 'not set (pick one to start)',
          inline: true,
        },
        {
          name: 'Logging',
          value:
            SERVER_LOG_EVENTS.filter((e) => !offList.includes(e.key))
              .map((e) => e.label)
              .join('\n') || 'nothing (pick events below)',
        },
      );
      const notes = [
        !config.ENABLE_GUILD_MEMBERS &&
          'Joins, leaves, nickname and role changes need **Server Members** (ENABLE_GUILD_MEMBERS).',
        !config.ENABLE_MESSAGE_CONTENT &&
          'Edited messages and the text of deleted ones need **Message Content** (ENABLE_MESSAGE_CONTENT).',
      ].filter(Boolean);
      if (notes.length) embed.addFields(hostNote(notes.join('\n')));
      const events = new StringSelectMenuBuilder()
        .setCustomId(id('serverlog', 'events'))
        .setPlaceholder('What to log…')
        .setMinValues(0)
        .setMaxValues(SERVER_LOG_EVENTS.length)
        .addOptions(
          SERVER_LOG_EVENTS.map((e) => ({
            label: e.label,
            value: e.key,
            default: !offList.includes(e.key),
          })),
        );
      return {
        embed,
        rows: [
          channelPicker('serverlog', 'channel', 'Pick the log channel', gc.serverLogChannelId),
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(events),
          row(toggleButton('serverlog', on), ...textRetentionButtons('serverlog', gc)),
        ],
      };
    },
    async handle(i, action, ctx) {
      const retention = await handleTextRetention(i, action, ctx);
      if (retention) return retention;
      if (action === 'toggle') return { notice: await toggleModule(ctx, 'serverlog') };
      if (action === 'channel' && i.isChannelSelectMenu()) {
        await update(ctx, { serverLogChannelId: i.values[0] });
        if (!isModuleOn(ctx.gc, 'serverlog')) await toggleModule(ctx, 'serverlog');
        return { notice: `Server logs go to <#${i.values[0]}>.` };
      }
      if (action === 'events' && i.isStringSelectMenu()) {
        const off = SERVER_LOG_EVENTS.map((e) => e.key).filter((k) => !i.values.includes(k));
        await update(ctx, { serverLogEvents: JSON.stringify(off) });
        return {
          notice: `Logging ${i.values.length} of ${SERVER_LOG_EVENTS.length} kinds of event.`,
        };
      }
      return {};
    },
  },

  tickets: {
    async render(ctx) {
      const gc = ctx.gc;
      const on = isModuleOn(gc, 'tickets');
      const embed = baseEmbed(
        ctx,
        '🎫 Support tickets',
        "Members press a button to open a **private thread** with your staff: for reports, appeals or questions they don't want to ask in public. When it closes, a transcript is saved to a channel you pick.\n\n" +
          '1. Pick the staff role. 2. Pick a transcript channel (optional). 3. Post the ticket button in a channel.',
        on,
      ).addFields(
        {
          name: 'Staff role',
          value: gc.ticketStaffRoleId
            ? `<@&${gc.ticketStaffRoleId}>`
            : 'not set (moderators can always see tickets)',
          inline: true,
        },
        {
          name: 'Transcripts',
          value: gc.ticketLogChannelId ? `<#${gc.ticketLogChannelId}>` : 'not saved',
          inline: true,
        },
      );
      if (!config.ENABLE_MESSAGE_CONTENT)
        embed.addFields(
          hostNote(
            'Transcripts list who wrote when; the message text itself is only included with **Message Content** (ENABLE_MESSAGE_CONTENT).',
          ),
        );
      return {
        embed,
        rows: [
          rolePicker(
            'tickets',
            'staff',
            'Staff role (who sees tickets)',
            gc.ticketStaffRoleId ? [gc.ticketStaffRoleId] : [],
          ),
          channelPicker('tickets', 'log', 'Where transcripts go (optional)', gc.ticketLogChannelId),
          channelPicker('tickets', 'post', 'Post the "Open a ticket" button in…', null, [
            ChannelType.GuildText,
          ]),
          row(toggleButton('tickets', on)),
        ],
      };
    },
    async handle(i, action, ctx) {
      if (action === 'toggle') return { notice: await toggleModule(ctx, 'tickets') };
      if (action === 'staff' && i.isRoleSelectMenu()) {
        await update(ctx, { ticketStaffRoleId: i.values[0] ?? null });
        return {
          notice: i.values[0]
            ? `Staff role set to <@&${i.values[0]}>.`
            : 'No staff role: moderators handle tickets.',
        };
      }
      if (action === 'log' && i.isChannelSelectMenu()) {
        await update(ctx, { ticketLogChannelId: i.values[0] });
        return { notice: `Transcripts go to <#${i.values[0]}>.` };
      }
      if (action === 'post' && i.isChannelSelectMenu()) {
        const channel = i.channels.first();
        const ok =
          channel && 'send' in channel
            ? await channel.send(buildTicketPanel()).then(
                () => true,
                () => false,
              )
            : false;
        return {
          notice: ok
            ? `Ticket button posted in <#${i.values[0]}>.`
            : `⚠️ I couldn't post in <#${i.values[0]}>. Check I can send messages there.`,
        };
      }
      return {};
    },
  },

  suggestions: {
    async render(ctx) {
      const gc = ctx.gc;
      const on = isModuleOn(gc, 'suggestions');
      const embed = baseEmbed(
        ctx,
        '💡 Suggestions',
        'Members post ideas with `/suggest`; they appear in a channel where everyone can vote 👍 or 👎. Staff approve or deny them with `/suggestion approve` or `/suggestion deny`, and the author gets a DM.',
        on,
      ).addFields({
        name: 'Channel',
        value: gc.suggestionChannelId
          ? `<#${gc.suggestionChannelId}>`
          : 'not set (pick one to start)',
      });
      return {
        embed,
        rows: [
          channelPicker('suggestions', 'channel', 'Suggestions channel', gc.suggestionChannelId),
          row(toggleButton('suggestions', on)),
        ],
      };
    },
    async handle(i, action, ctx) {
      if (action === 'toggle') return { notice: await toggleModule(ctx, 'suggestions') };
      if (action === 'channel' && i.isChannelSelectMenu()) {
        await update(ctx, { suggestionChannelId: i.values[0] });
        return { notice: `Suggestions go to <#${i.values[0]}>.` };
      }
      return {};
    },
  },

  joinroles: {
    async render(ctx) {
      const gc = ctx.gc;
      const on = isModuleOn(gc, 'joinroles');
      const joinRoles = parseStringList(gc.joinRoleIds);
      const embed = baseEmbed(
        ctx,
        '✅ Join roles & verification',
        '**Join roles** are given to everyone the moment they join (e.g. a Member role).\n' +
          '**Verification** keeps new accounts out of most channels until they press a **Verify** button, which stops most spam bots. Give the verified role access to your channels, and post the button in a channel newcomers can see.',
        on,
      ).addFields(
        {
          name: 'Join roles',
          value: joinRoles.length ? joinRoles.map((r) => `<@&${r}>`).join(' ') : 'none',
          inline: true,
        },
        {
          name: 'Verified role',
          value: gc.verifyRoleId ? `<@&${gc.verifyRoleId}>` : 'none',
          inline: true,
        },
      );
      if (!config.ENABLE_GUILD_MEMBERS)
        embed.addFields(
          hostNote(
            'Join roles need **Server Members** (ENABLE_GUILD_MEMBERS) to see people join. The Verify button works without it.',
          ),
        );
      return {
        embed,
        rows: [
          rolePicker('joinroles', 'join', 'Roles everyone gets on joining (up to 5)', joinRoles, 5),
          rolePicker(
            'joinroles',
            'verify',
            'Role the Verify button gives',
            gc.verifyRoleId ? [gc.verifyRoleId] : [],
          ),
          channelPicker('joinroles', 'post', 'Post the Verify button in…', null, [
            ChannelType.GuildText,
          ]),
          row(toggleButton('joinroles', on)),
        ],
      };
    },
    async handle(i, action, ctx) {
      if (action === 'toggle') return { notice: await toggleModule(ctx, 'joinroles') };
      if ((action === 'join' || action === 'verify') && i.isRoleSelectMenu()) {
        // The bot hands these out to anyone, so the usual rule applies: never above the person setting it up.
        for (const role of i.roles.values()) {
          const ok = await checkRoleAssignable(ctx.guild, ctx.invoker, role);
          if (!ok.allowed) return { notice: `⚠️ <@&${role.id}>: ${ok.reason}` };
        }
        if (action === 'join') {
          await update(ctx, { joinRoleIds: JSON.stringify(i.values) });
          return {
            notice: i.values.length
              ? `New members get ${i.values.map((r) => `<@&${r}>`).join(' ')}.`
              : 'No join roles.',
          };
        }
        await update(ctx, { verifyRoleId: i.values[0] ?? null });
        return {
          notice: i.values[0]
            ? `The Verify button gives <@&${i.values[0]}>. Now post it in a channel.`
            : 'No verified role.',
        };
      }
      if (action === 'post' && i.isChannelSelectMenu()) {
        if (!ctx.gc.verifyRoleId) return { notice: '⚠️ Pick the verified role first.' };
        const channel = i.channels.first();
        const ok =
          channel && 'send' in channel
            ? await channel.send(buildVerifyPanel()).then(
                () => true,
                () => false,
              )
            : false;
        return {
          notice: ok
            ? `Verify button posted in <#${i.values[0]}>.`
            : `⚠️ I couldn't post in <#${i.values[0]}>.`,
        };
      }
      return {};
    },
  },

  tempvoice: {
    async render(ctx) {
      const gc = ctx.gc;
      const on = isModuleOn(gc, 'tempvoice');
      const embed = baseEmbed(
        ctx,
        '🔊 Join-to-create voice',
        'Instead of a pile of empty voice channels: members join one "hub" channel and get their own room in the same category, which they can rename, limit or lock with `/voice`. Rooms are deleted when everyone leaves.',
        on,
      ).addFields({
        name: 'Hub channel',
        value: gc.tempVoiceHubId
          ? `<#${gc.tempVoiceHubId}>`
          : 'not set (pick a voice channel, e.g. "➕ Join to create")',
      });
      return {
        embed,
        rows: [
          channelPicker(
            'tempvoice',
            'hub',
            'Pick the join-to-create voice channel',
            gc.tempVoiceHubId,
            [ChannelType.GuildVoice],
          ),
          row(toggleButton('tempvoice', on)),
        ],
      };
    },
    async handle(i, action, ctx) {
      if (action === 'toggle') return { notice: await toggleModule(ctx, 'tempvoice') };
      if (action === 'hub' && i.isChannelSelectMenu()) {
        await update(ctx, { tempVoiceHubId: i.values[0] });
        return { notice: `Joining <#${i.values[0]}> now makes a room.` };
      }
      return {};
    },
  },

  giveaways: simplePanel(
    'giveaways',
    '🎉 Giveaways',
    'Members enter with a button; winners are drawn and announced automatically when time is up, even after a restart.',
    [
      '`/giveaway start prize:Nitro duration:2d winners:1`',
      '`/giveaway end`, `/giveaway reroll` and `/giveaway list`',
    ],
  ),
  autoresponders: simplePanel(
    'autoresponders',
    '🤖 Auto-responders',
    'The bot replies by itself when a message contains a trigger phrase: answer "how do I join the server?" once and never again. Each trigger replies at most once every 30 seconds per channel.',
    [
      '`/autoresponder add trigger:how do i join response:Use the IP play.example.com`',
      '`/autoresponder list` and `/autoresponder remove`',
    ],
    () =>
      config.ENABLE_MESSAGE_CONTENT
        ? null
        : 'This needs **Message Content** (ENABLE_MESSAGE_CONTENT) to read messages.',
  ),
  addons: simplePanel(
    'addons',
    '🧩 Add-ons',
    'Have the bot post from other places: news feeds and patch notes, Steam game news, Epic free games, your game server going up or down, and messages from other apps (webhooks).',
    [
      '`/addons add type:Steam game news channel:#patch-notes target:730`',
      '`/addons add type:RSS / Atom feed channel:#news target:https://...`',
      '`/addons list`, `/addons test` and `/addons remove`',
      'Or use the **Add-ons** page of the web dashboard (`/dashboard`).',
    ],
  ),
  announcements: simplePanel(
    'announcements',
    '📣 Announcements',
    'Post a styled announcement now, later, or every day or week: event reminders, weekly rules posts, game night.',
    [
      '`/announce send channel:#news message:... in:2h repeat:weekly`',
      '`/announce list` and `/announce cancel`',
    ],
  ),
  activityroles: simplePanel(
    'activityroles',
    '🕹️ Now-playing roles',
    'Gives members a role while Discord shows them playing a certain game, so you can see who is in-game at a glance.',
    ['`/activityrole add game_name:Minecraft role:@Mining`'],
    () =>
      config.ENABLE_PRESENCE
        ? null
        : 'This needs **Presence** turned on (ENABLE_PRESENCE) by whoever runs the bot.',
  ),
};

function simplePanel(
  moduleId: ModuleId,
  title: string,
  why: string,
  howTo: string[],
  hostCheck?: () => string | null,
): Panel {
  return {
    async render(ctx) {
      const on = isModuleOn(ctx.gc, moduleId);
      const embed = baseEmbed(ctx, title, why, on).addFields({
        name: 'How to use it',
        value: howTo.map((l) => `• ${l}`).join('\n'),
      });
      const note = hostCheck?.();
      if (note) embed.addFields(hostNote(note));
      return { embed, rows: [row(toggleButton(moduleId, on))] };
    },
    async handle(_i, action, ctx) {
      if (action === 'toggle') return { notice: await toggleModule(ctx, moduleId) };
      return {};
    },
  };
}

export function isPanelId(value: string): value is PanelId {
  return value in panels;
}

export async function renderPanel(
  panelId: PanelId,
  ctx: PanelCtx,
  navRow: Row,
  notice?: string,
): Promise<Rendered> {
  const { embed, rows } = await panels[panelId].render(ctx);
  if (notice) embed.setDescription(`${embed.data.description ?? ''}\n\n> ${notice}`);
  return { embeds: [embed], components: [...rows, navRow].slice(0, 5) };
}

export async function handlePanel(
  panelId: PanelId,
  i: MessageComponentInteraction,
  action: string,
  ctx: PanelCtx,
): Promise<HandleResult> {
  return (await panels[panelId].handle?.(i, action, ctx)) ?? {};
}
