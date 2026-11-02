import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma } from '../../lib/db';
import { suggestionButtons, suggestionEmbed, voteCounts } from '../../features/suggestions';

export const suggestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Post a suggestion for everyone to vote on.')
    .addStringOption((o) =>
      o.setName('idea').setDescription('Your suggestion').setRequired(true).setMaxLength(1500),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const cfg = await prisma.guildConfig.findUnique({ where: { id: interaction.guild.id } });
    const channel = cfg?.suggestionChannelId
      ? await interaction.guild.channels.fetch(cfg.suggestionChannelId).catch(() => null)
      : null;
    if (!channel?.isSendable()) {
      await interaction.reply({
        content:
          "Suggestions aren't set up yet. An admin can pick a channel in `/setup` → Suggestions.",
        ephemeral: true,
      });
      return;
    }
    const s = await prisma.suggestion.create({
      data: {
        guildId: interaction.guild.id,
        channelId: channel.id,
        authorId: interaction.user.id,
        content: interaction.options.getString('idea', true),
      },
    });
    const msg = await channel.send({
      embeds: [suggestionEmbed(s, 0, 0)],
      components: [suggestionButtons(s.id, false)],
      allowedMentions: { parse: [] },
    });
    await prisma.suggestion.update({ where: { id: s.id }, data: { messageId: msg.id } });
    await interaction.reply({
      content: `💡 Posted as suggestion #${s.id} in ${channel}.`,
      ephemeral: true,
    });
  },
};

export const suggestionCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('(Staff) Approve or deny a suggestion.')
    .addSubcommand((sc) =>
      sc
        .setName('approve')
        .setDescription('Approve a suggestion')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Suggestion number').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('note').setDescription('Note shown on the suggestion').setMaxLength(500),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('deny')
        .setDescription('Deny a suggestion')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Suggestion number').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('note').setDescription('Why (shown on the suggestion)').setMaxLength(500),
        ),
    )
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const id = interaction.options.getInteger('id', true);
    const status = interaction.options.getSubcommand() === 'approve' ? 'approved' : 'denied';
    const s = await prisma.suggestion.findUnique({ where: { id } });
    if (!s || s.guildId !== interaction.guild.id) {
      await interaction.reply({ content: `No suggestion #${id} here.`, ephemeral: true });
      return;
    }
    const updated = await prisma.suggestion.update({
      where: { id },
      data: {
        status,
        staffNote: interaction.options.getString('note'),
        decidedById: interaction.user.id,
      },
    });
    const { up, down } = await voteCounts(id);
    const channel = await interaction.guild.channels.fetch(s.channelId).catch(() => null);
    if (channel?.isTextBased() && s.messageId) {
      const msg = await channel.messages.fetch(s.messageId).catch(() => null);
      await msg
        ?.edit({
          embeds: [suggestionEmbed(updated, up, down)],
          components: [suggestionButtons(id, true)],
        })
        .catch(() => undefined);
    }
    const author = await interaction.client.users.fetch(s.authorId).catch(() => null);
    await author
      ?.send(
        `Your suggestion #${id} in **${interaction.guild.name}** was ${status}.${updated.staffNote ? ` Note: ${updated.staffNote}` : ''}`,
      )
      .catch(() => undefined);
    await interaction.reply({ content: `Suggestion #${id} ${status}.`, ephemeral: true });
  },
};
