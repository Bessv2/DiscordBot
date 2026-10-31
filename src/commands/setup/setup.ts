import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { Command } from '../types';
import { getOrCreateGuildConfig, prisma } from '../../lib/db';
import { getConfiguredRoleIds, setPermissionRoles } from '../../lib/permissions';

// The in-Discord onboarding wizard (principle #8): everything past cloning
// the repo and running `docker compose up` happens here, point-and-click,
// so a no-skills host never opens a config file. Three steps: mod-log
// channel, auto-mod thresholds, permission roles — matching section 6 of
// CLAUDE.md exactly. State lives entirely in the collector closure below;
// nothing is "in progress" once the wizard message stops being interacted
// with, so there's no cross-restart state to worry about.

const WIZARD_TIMEOUT_MS = 15 * 60_000;

export const setupCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Guided first-time setup: mod-log channel, auto-mod, and permission roles.')
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    await getOrCreateGuildConfig(interaction.guild.id);

    const response = await interaction.reply({
      embeds: [step1Embed()],
      components: [step1Components()],
      ephemeral: true,
    });

    const collector = response.createMessageComponentCollector({ time: WIZARD_TIMEOUT_MS });
    let finished = false;

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: 'Only the person who ran /setup can use this.', ephemeral: true });
        return;
      }

      try {
        if (i.isChannelSelectMenu() && i.customId === 'setup_modlog') {
          await prisma.guildConfig.update({
            where: { id: interaction.guild.id },
            data: { modLogChannelId: i.values[0] },
          });
          await i.update({ embeds: [step2Embed()], components: step2Components() });
          return;
        }

        if (i.isButton() && i.customId === 'setup_automod_configure') {
          const config = await prisma.guildConfig.findUniqueOrThrow({ where: { id: interaction.guild.id } });
          const modal = automodModal(config.spamMessageLimit, config.spamIntervalMs / 1000, config.mentionSpamLimit);
          await i.showModal(modal);

          const submitted = await i
            .awaitModalSubmit({ time: 120_000, filter: (m) => m.user.id === interaction.user.id })
            .catch(() => null);
          if (!submitted || !submitted.isFromMessage()) return;

          const spamLimit = parsePositiveInt(submitted.fields.getTextInputValue('spam_limit')) ?? config.spamMessageLimit;
          const spamIntervalSec =
            parsePositiveInt(submitted.fields.getTextInputValue('spam_interval')) ?? config.spamIntervalMs / 1000;
          const mentionLimit =
            parsePositiveInt(submitted.fields.getTextInputValue('mention_limit')) ?? config.mentionSpamLimit;
          const inviteFilterOn = parseYesNo(submitted.fields.getTextInputValue('invite_filter')) ?? config.inviteFilterOn;

          await prisma.guildConfig.update({
            where: { id: interaction.guild.id },
            data: {
              automodEnabled: true,
              spamMessageLimit: spamLimit,
              spamIntervalMs: spamIntervalSec * 1000,
              mentionSpamLimit: mentionLimit,
              inviteFilterOn,
            },
          });
          await submitted.update({ embeds: [await step3Embed(interaction.guild.id)], components: step3Components() });
          return;
        }

        if (i.isButton() && i.customId === 'setup_automod_skip') {
          await i.update({ embeds: [await step3Embed(interaction.guild.id)], components: step3Components() });
          return;
        }

        if (i.isRoleSelectMenu() && (i.customId === 'setup_mod_roles' || i.customId === 'setup_admin_roles')) {
          const scope = i.customId === 'setup_mod_roles' ? 'moderation' : 'admin';
          await setPermissionRoles(interaction.guild.id, scope, i.values);
          await i.update({ embeds: [await step3Embed(interaction.guild.id)], components: step3Components() });
          return;
        }

        if (i.isButton() && i.customId === 'setup_finish') {
          await prisma.guildConfig.update({
            where: { id: interaction.guild.id },
            data: { setupCompleted: true },
          });
          finished = true;
          await i.update({ embeds: [await summaryEmbed(interaction.guild.id)], components: [] });
          collector.stop('finished');
          return;
        }
      } catch (err) {
        await i
          .reply({ content: 'Something went wrong saving that — please try again.', ephemeral: true })
          .catch(() => undefined);
        throw err;
      }
    });

    collector.on('end', async (_collected, reason) => {
      if (finished || reason !== 'time') return;
      await interaction
        .editReply({
          embeds: [new EmbedBuilder().setTitle('Setup timed out').setDescription('Run `/setup` again to continue.')],
          components: [],
        })
        .catch(() => undefined);
    });
  },
};

function step1Embed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Bot Setup · Step 1 of 3')
    .setDescription(
      'Pick a channel for the **mod-log** — every warn, kick, ban, timeout, and auto-mod action gets posted here as an embed.\n\nYou can change this later with `/config modlog`.',
    );
}

function step1Components(): ActionRowBuilder<ChannelSelectMenuBuilder> {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('setup_modlog')
    .setPlaceholder('Select a mod-log channel')
    .setChannelTypes(ChannelType.GuildText);
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select);
}

function step2Embed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Bot Setup · Step 2 of 3')
    .setDescription(
      'Turn on auto-mod? It can catch message flooding, invite-link posting, and mention spam automatically.\n\n' +
        'The invite filter and word filter need the "Message Content" intent enabled on the bot — if you haven\'t ' +
        'enabled that yet, flood detection still works, and the rest will start working once you do (see `.env.example`).\n\n' +
        'You can fine-tune all of this later with `/config`.',
    );
}

function step2Components(): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('setup_automod_configure').setLabel('Configure Auto-Mod').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup_automod_skip').setLabel('Skip for now').setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

function automodModal(spamLimit: number, spamIntervalSec: number, mentionLimit: number): ModalBuilder {
  const modal = new ModalBuilder().setCustomId('setup_automod_modal').setTitle('Auto-Mod Thresholds');

  const spamLimitInput = new TextInputBuilder()
    .setCustomId('spam_limit')
    .setLabel('Messages before flagged as spam')
    .setStyle(TextInputStyle.Short)
    .setValue(String(spamLimit))
    .setRequired(true);
  const spamIntervalInput = new TextInputBuilder()
    .setCustomId('spam_interval')
    .setLabel('...within how many seconds')
    .setStyle(TextInputStyle.Short)
    .setValue(String(spamIntervalSec))
    .setRequired(true);
  const mentionLimitInput = new TextInputBuilder()
    .setCustomId('mention_limit')
    .setLabel('Mentions in one message = mention spam')
    .setStyle(TextInputStyle.Short)
    .setValue(String(mentionLimit))
    .setRequired(true);
  const inviteFilterInput = new TextInputBuilder()
    .setCustomId('invite_filter')
    .setLabel('Delete Discord invite links? (yes/no)')
    .setStyle(TextInputStyle.Short)
    .setValue('yes')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(spamLimitInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(spamIntervalInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(mentionLimitInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(inviteFilterInput),
  );
  return modal;
}

async function step3Embed(guildId: string): Promise<EmbedBuilder> {
  const modRoles = await getConfiguredRoleIds(guildId, 'moderation');
  const adminRoles = await getConfiguredRoleIds(guildId, 'admin');
  return new EmbedBuilder()
    .setTitle('Bot Setup · Step 3 of 3')
    .setDescription(
      'Optionally restrict command scopes to specific roles. Leave a menu empty to keep the default ' +
        "(Discord's own Kick/Ban/Manage-Server permissions decide who can use those commands).\n\n" +
        `**Moderation roles:** ${modRoles.length ? modRoles.map((r) => `<@&${r}>`).join(' ') : 'not restricted'}\n` +
        `**Admin roles:** ${adminRoles.length ? adminRoles.map((r) => `<@&${r}>`).join(' ') : 'not restricted'}\n\n` +
        'No optional modules are available in this version yet — see the roadmap in CLAUDE.md for what\'s planned.\n\n' +
        'Click **Finish Setup** when you\'re done.',
    );
}

function step3Components(): (ActionRowBuilder<RoleSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[] {
  const modRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('setup_mod_roles')
      .setPlaceholder('Who can use moderation commands (warn/kick/ban/timeout)?')
      .setMinValues(0)
      .setMaxValues(10),
  );
  const adminRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('setup_admin_roles')
      .setPlaceholder('Who can use /setup and /config?')
      .setMinValues(0)
      .setMaxValues(10),
  );
  const finishRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('setup_finish').setLabel('Finish Setup').setStyle(ButtonStyle.Success),
  );
  return [modRow, adminRow, finishRow];
}

async function summaryEmbed(guildId: string): Promise<EmbedBuilder> {
  const gc = await prisma.guildConfig.findUniqueOrThrow({ where: { id: guildId } });
  return new EmbedBuilder()
    .setTitle('Setup complete ✅')
    .setDescription(
      `**Mod-log:** ${gc.modLogChannelId ? `<#${gc.modLogChannelId}>` : 'not set'}\n` +
        `**Auto-mod:** ${gc.automodEnabled ? 'on' : 'off'}\n` +
        `**Invite filter:** ${gc.inviteFilterOn ? 'on' : 'off'}\n\n` +
        'Run `/config view` any time to see or change these settings.',
    );
}

function parsePositiveInt(value: string): number | null {
  const n = Number(value.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseYesNo(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (['yes', 'y', 'true', 'on'].includes(v)) return true;
  if (['no', 'n', 'false', 'off'].includes(v)) return false;
  return null;
}
