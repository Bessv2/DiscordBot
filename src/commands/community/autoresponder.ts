import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { config } from '../../config';
import { getOrCreateGuildConfig, prisma } from '../../lib/db';
import { MAX_RESPONDERS, invalidateResponders } from '../../features/autoResponders';

export const autoresponderCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('autoresponder')
    .setDescription('Have the bot answer by itself when someone says a trigger phrase.')
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Add or replace an auto-response')
        .addStringOption((o) =>
          o
            .setName('trigger')
            .setDescription('Words that trigger it, e.g. "how do i join"')
            .setRequired(true)
            .setMaxLength(100),
        )
        .addStringOption((o) =>
          o
            .setName('response')
            .setDescription('What the bot replies')
            .setRequired(true)
            .setMaxLength(1500),
        )
        .addStringOption((o) =>
          o
            .setName('match')
            .setDescription('How the trigger must appear (default: anywhere in the message)')
            .addChoices(
              { name: 'anywhere in the message', value: 'contains' },
              { name: 'the whole message', value: 'exact' },
              { name: 'at the start', value: 'starts' },
            ),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Remove an auto-response')
        .addStringOption((o) =>
          o.setName('trigger').setDescription('Its trigger').setRequired(true),
        ),
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('List auto-responses'))
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    const note = config.ENABLE_MESSAGE_CONTENT
      ? ''
      : "\n⚠️ The bot can't read messages yet, so these won't fire until its host turns on Message Content (ENABLE_MESSAGE_CONTENT).";

    if (sub === 'list') {
      const list = await prisma.autoResponder.findMany({
        where: { guildId },
        orderBy: { trigger: 'asc' },
      });
      await interaction.reply({
        content:
          (list.length
            ? list
                .map((r) => `• **${r.trigger}** (${r.matchType}) → ${r.response.slice(0, 80)}`)
                .join('\n')
            : 'No auto-responses yet.') + note,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }
    const trigger = interaction.options.getString('trigger', true).trim().toLowerCase();
    if (sub === 'remove') {
      const { count } = await prisma.autoResponder.deleteMany({ where: { guildId, trigger } });
      invalidateResponders(guildId);
      await interaction.reply({
        content: count ? `Removed **${trigger}**.` : `No auto-response for **${trigger}**.`,
        ephemeral: true,
      });
      return;
    }
    if (trigger.length < 2) {
      await interaction.reply({
        content: 'Make the trigger at least 2 characters.',
        ephemeral: true,
      });
      return;
    }
    await getOrCreateGuildConfig(guildId);
    const count = await prisma.autoResponder.count({ where: { guildId } });
    const exists = await prisma.autoResponder.findUnique({
      where: { guildId_trigger: { guildId, trigger } },
    });
    if (!exists && count >= MAX_RESPONDERS) {
      await interaction.reply({
        content: `You've hit the limit of ${MAX_RESPONDERS} auto-responses. Remove one first.`,
        ephemeral: true,
      });
      return;
    }
    const data = {
      response: interaction.options.getString('response', true),
      matchType: interaction.options.getString('match') ?? 'contains',
    };
    await prisma.autoResponder.upsert({
      where: { guildId_trigger: { guildId, trigger } },
      create: { guildId, trigger, createdBy: interaction.user.id, ...data },
      update: data,
    });
    invalidateResponders(guildId);
    await interaction.reply({
      content: `${exists ? 'Updated' : 'Added'} auto-response for **${trigger}**.${note}`,
      ephemeral: true,
    });
  },
};
