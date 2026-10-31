import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

export const pollCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Post a simple reaction poll.')
    .addStringOption((o) => o.setName('question').setDescription('The poll question').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('options')
        .setDescription('Comma-separated choices, 2-5, e.g. "Pizza, Tacos, Sushi"')
        .setRequired(true),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const question = interaction.options.getString('question', true);
    const rawOptions = interaction.options.getString('options', true);
    const options = rawOptions
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    if (options.length < 2 || options.length > 5) {
      await interaction.reply({
        content: 'Give between 2 and 5 comma-separated options.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(question)
      .setDescription(options.map((o, i) => `${NUMBER_EMOJIS[i]} ${o}`).join('\n'))
      .setFooter({ text: `Poll by ${interaction.user.tag}` });

    await interaction.reply({ embeds: [embed] });
    const message = await interaction.fetchReply();

    for (let i = 0; i < options.length; i++) {
      await message.react(NUMBER_EMOJIS[i]!).catch(() => undefined);
    }

    await getOrCreateGuildConfig(interaction.guild.id);
    await prisma.poll.create({
      data: {
        guildId: interaction.guild.id,
        channelId: interaction.channelId,
        messageId: message.id,
        question,
        options: JSON.stringify(options),
        createdBy: interaction.user.id,
      },
    });
  },
};
