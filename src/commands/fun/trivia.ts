import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  SendableChannels,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';
import { memberHasPermission } from '../../lib/permissions';
import { addToBalance } from '../../lib/walletActions';
import { logger } from '../../lib/logger';
import defaultQuestions from '../../data/trivia-default.json';

interface TriviaQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
}

const ROUND_TIME_MS = 20_000;
const CORRECT_ANSWER_REWARD = 10;

// One trivia session per channel at a time — keyed so /trivia stop can
// find and end it. Purely in-memory: a session is live state, not data
// that needs to survive a restart.
const activeSessions = new Map<string, { stop: () => void }>();

export const triviaCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Run a trivia round in this channel.')
    .addSubcommand((sc) =>
      sc.setName('start').setDescription('Start a trivia session').addIntegerOption((o) => o.setName('rounds').setDescription('How many questions (default 5, max 10)').setRequired(false)),
    )
    .addSubcommand((sc) => sc.setName('stop').setDescription('Stop the current session in this channel'))
    .addSubcommand((sc) =>
      sc
        .setName('import')
        .setDescription('(Admin) Import custom questions from a JSON file')
        .addAttachmentOption((o) => o.setName('file').setDescription('JSON array of {question, choices, correctIndex}').setRequired(true)),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'stop') {
      const session = activeSessions.get(interaction.channelId);
      if (!session) {
        await interaction.reply({ content: 'No trivia session is running here.', ephemeral: true });
        return;
      }
      session.stop();
      await interaction.reply({ content: 'Stopping trivia.', ephemeral: true });
      return;
    }

    if (sub === 'import') {
      const isMod = await memberHasPermission(interaction.member, 'moderation', PermissionFlagsBits.ManageGuild);
      if (!isMod) {
        await interaction.reply({ content: "You don't have permission to import questions.", ephemeral: true });
        return;
      }
      const attachment = interaction.options.getAttachment('file', true);
      await interaction.deferReply({ ephemeral: true });
      const parsed = await fetchAndParseQuestions(attachment.url);
      if (!parsed) {
        await interaction.editReply('Could not parse that file — expected a JSON array of {question, choices, correctIndex}.');
        return;
      }
      await getOrCreateGuildConfig(interaction.guild.id);
      await prisma.triviaQuestion.createMany({
        data: parsed.map((q) => ({
          guildId: interaction.guild.id,
          question: q.question,
          choices: JSON.stringify(q.choices),
          correctIndex: q.correctIndex,
        })),
      });
      await interaction.editReply(`Imported ${parsed.length} question(s).`);
      return;
    }

    // start
    if (activeSessions.has(interaction.channelId)) {
      await interaction.reply({ content: 'A trivia session is already running in this channel.', ephemeral: true });
      return;
    }
    const channel = interaction.channel;
    if (!channel?.isSendable()) {
      await interaction.reply({ content: "I can't send messages in this channel.", ephemeral: true });
      return;
    }

    const rounds = Math.min(interaction.options.getInteger('rounds') ?? 5, 10);
    const customQuestions = await prisma.triviaQuestion.findMany({ where: { guildId: interaction.guild.id } });
    const pool: TriviaQuestion[] = [
      ...customQuestions.map((q) => ({ question: q.question, choices: JSON.parse(q.choices) as string[], correctIndex: q.correctIndex })),
      ...defaultQuestions,
    ];

    await interaction.reply({ content: `Starting ${rounds} round(s) of trivia!`, ephemeral: true });

    const guildConfig = await prisma.guildConfig.findUnique({ where: { id: interaction.guild.id } });
    const guildId = interaction.guild.id;
    const scores = new Map<string, number>();
    let stopped = false;
    activeSessions.set(interaction.channelId, { stop: () => { stopped = true; } });

    for (let round = 0; round < rounds && !stopped; round++) {
      await runRound(channel, guildId, pool, round, rounds, scores, guildConfig?.economyEnabled ?? false, () => stopped);
    }

    activeSessions.delete(interaction.channelId);

    if (scores.size > 0) {
      const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
      const lines = ranked.slice(0, 10).map(([userId, score], i) => `**${i + 1}.** <@${userId}> — ${score} correct`);
      await channel.send({ embeds: [new EmbedBuilder().setTitle('Trivia results').setDescription(lines.join('\n'))] });
    } else {
      await channel.send('Trivia ended — nobody scored.');
    }
  },
};

async function runRound(
  channel: SendableChannels,
  guildId: string,
  pool: TriviaQuestion[],
  roundIndex: number,
  totalRounds: number,
  scores: Map<string, number>,
  economyEnabled: boolean,
  isStopped: () => boolean,
): Promise<void> {
  if (isStopped()) return;
  const q = pool[Math.floor(Math.random() * pool.length)]!;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    q.choices.slice(0, 4).map((choice, i) =>
      new ButtonBuilder()
        .setCustomId(`trivia_answer:${i}`)
        .setLabel(`${String.fromCharCode(65 + i)}. ${choice}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary),
    ),
  );
  const embed = new EmbedBuilder().setTitle(`Question ${roundIndex + 1}/${totalRounds}`).setDescription(q.question);

  const message = await channel.send({ embeds: [embed], components: [row] });
  const answers = new Map<string, number>();

  await new Promise<void>((resolve) => {
    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: ROUND_TIME_MS });

    collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
      if (!answers.has(buttonInteraction.user.id)) {
        answers.set(buttonInteraction.user.id, Number(buttonInteraction.customId.split(':')[1]));
        await buttonInteraction.reply({ content: 'Answer locked in!', ephemeral: true }).catch(() => undefined);
      } else {
        await buttonInteraction.reply({ content: "You've already answered this one.", ephemeral: true }).catch(() => undefined);
      }
    });

    collector.on('end', async () => {
      const correctUserIds = [...answers.entries()].filter(([, i]) => i === q.correctIndex).map(([id]) => id);
      for (const userId of correctUserIds) {
        scores.set(userId, (scores.get(userId) ?? 0) + 1);
        if (economyEnabled) {
          await addToBalance(guildId, userId, CORRECT_ANSWER_REWARD).catch(() => undefined);
        }
      }

      const resultText =
        correctUserIds.length > 0
          ? `Correct: **${q.choices[q.correctIndex]}** — ${correctUserIds.map((id) => `<@${id}>`).join(', ')}`
          : `Correct answer: **${q.choices[q.correctIndex]}** — nobody got it.`;
      await message.edit({ embeds: [embed.setFooter({ text: resultText.replace(/<@|>/g, '') })], components: [] }).catch((err: Error) => {
        logger.warn(`Could not edit trivia question message: ${err.message}`);
      });
      await message.reply(resultText).catch(() => undefined);
      resolve();
    });
  });
}

async function fetchAndParseQuestions(url: string): Promise<TriviaQuestion[] | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return null;
    const valid = data.every(
      (q) =>
        typeof q === 'object' &&
        q !== null &&
        typeof (q as TriviaQuestion).question === 'string' &&
        Array.isArray((q as TriviaQuestion).choices) &&
        (q as TriviaQuestion).choices.length >= 2 &&
        typeof (q as TriviaQuestion).correctIndex === 'number',
    );
    return valid ? (data as TriviaQuestion[]) : null;
  } catch {
    return null;
  }
}
