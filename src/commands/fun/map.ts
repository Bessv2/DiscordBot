import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';
import { memberHasPermission } from '../../lib/permissions';
import {
  MAX_MAPS_PER_GAME,
  MAX_MAP_NAME,
  MAX_POLL_CHOICES,
  normalizeGame,
  parseMapList,
  pickRandom,
} from '../../lib/maps';

// Game-night map pools. Votes use Discord's own poll feature, which closes
// by itself and shows live results, so there's no vote state to keep here.
export const mapCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('map')
    .setDescription('Game-night map pools: pick a random map or let everyone vote.')
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('(Mods) Add maps to a game’s pool')
        .addStringOption((o) =>
          o
            .setName('game')
            .setDescription('Game name, e.g. Valorant')
            .setRequired(true)
            .setMaxLength(50),
        )
        .addStringOption((o) =>
          o
            .setName('maps')
            .setDescription('Comma-separated, e.g. "Ascent, Bind, Haven"')
            .setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('(Mods) Remove a map from a game’s pool')
        .addStringOption((o) => o.setName('game').setDescription('Game name').setRequired(true))
        .addStringOption((o) => o.setName('map').setDescription('Map name').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('list')
        .setDescription('Show the maps for a game, or every game with a pool')
        .addStringOption((o) =>
          o
            .setName('game')
            .setDescription('Game name (leave empty to list games)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('random')
        .setDescription('Pick random maps from a game’s pool')
        .addStringOption((o) => o.setName('game').setDescription('Game name').setRequired(true))
        .addIntegerOption((o) =>
          o
            .setName('count')
            .setDescription('How many maps (default 1)')
            .setMinValue(1)
            .setMaxValue(10),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('vote')
        .setDescription('Start a Discord poll to vote on the next map')
        .addStringOption((o) => o.setName('game').setDescription('Game name').setRequired(true))
        .addIntegerOption((o) =>
          o
            .setName('choices')
            .setDescription('Maps on the ballot, picked at random (default 5)')
            .setMinValue(2)
            .setMaxValue(MAX_POLL_CHOICES),
        )
        .addIntegerOption((o) =>
          o
            .setName('hours')
            .setDescription('How long voting stays open (default 1)')
            .setMinValue(1)
            .setMaxValue(168),
        ),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    const rawGame = interaction.options.getString('game');
    const game = rawGame ? normalizeGame(rawGame) : null;

    if (sub === 'add' || sub === 'remove') {
      const isMod = await memberHasPermission(
        interaction.member,
        'moderation',
        PermissionFlagsBits.ManageGuild,
      );
      if (!isMod) {
        await interaction.reply({
          content: 'Only moderators can change map pools.',
          ephemeral: true,
        });
        return;
      }
    }

    if (sub === 'add') {
      const { maps, tooLong } = parseMapList(interaction.options.getString('maps', true));
      if (maps.length === 0) {
        await interaction.reply({
          content: 'Give at least one map name, separated by commas.',
          ephemeral: true,
        });
        return;
      }
      await getOrCreateGuildConfig(guildId);
      const existing = await prisma.mapPool.count({ where: { guildId, game: game! } });
      const room = MAX_MAPS_PER_GAME - existing;
      if (room <= 0) {
        await interaction.reply({
          content: `That pool is full (${MAX_MAPS_PER_GAME} maps). Remove some first.`,
          ephemeral: true,
        });
        return;
      }
      const current = new Set(
        (
          await prisma.mapPool.findMany({ where: { guildId, game: game! }, select: { name: true } })
        ).map((m) => m.name.toLowerCase()),
      );
      const fresh = maps.filter((m) => !current.has(m.toLowerCase())).slice(0, room);
      // One insert per map: createMany has no skipDuplicates on SQLite.
      for (const name of fresh) {
        await prisma.mapPool.create({ data: { guildId, game: game!, name } });
      }
      const notes = [
        maps.length > fresh.length
          ? `${maps.length - fresh.length} already in the pool or over the limit`
          : '',
        tooLong.length ? `${tooLong.length} skipped for being over ${MAX_MAP_NAME} characters` : '',
      ].filter(Boolean);
      await interaction.reply({
        content: `Added ${fresh.length} map(s) to **${rawGame!.trim()}**.${notes.length ? ` (${notes.join('; ')})` : ''}`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'remove') {
      const mapName = interaction.options.getString('map', true).trim();
      const pool = await prisma.mapPool.findMany({ where: { guildId, game: game! } });
      const match = pool.find((m) => m.name.toLowerCase() === mapName.toLowerCase());
      if (!match) {
        await interaction.reply({
          content: `“${mapName}” isn't in the ${rawGame!.trim()} pool.`,
          ephemeral: true,
        });
        return;
      }
      await prisma.mapPool.delete({ where: { id: match.id } });
      await interaction.reply({ content: `Removed **${match.name}**.`, ephemeral: true });
      return;
    }

    if (sub === 'list') {
      if (!game) {
        const games = await prisma.mapPool.groupBy({
          by: ['game'],
          where: { guildId },
          _count: { _all: true },
          orderBy: { game: 'asc' },
        });
        if (games.length === 0) {
          await interaction.reply({
            content: 'No map pools yet. A moderator can start one with `/map add`.',
            ephemeral: true,
          });
          return;
        }
        const lines = games.map((g) => `• **${g.game}** — ${g._count._all} map(s)`);
        await interaction.reply({
          embeds: [new EmbedBuilder().setTitle('Map pools').setDescription(lines.join('\n'))],
        });
        return;
      }
      const pool = await prisma.mapPool.findMany({
        where: { guildId, game },
        orderBy: { name: 'asc' },
      });
      if (pool.length === 0) {
        await interaction.reply({
          content: `No maps for **${rawGame!.trim()}** yet.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${rawGame!.trim()} maps (${pool.length})`)
            .setDescription(pool.map((m) => m.name).join(', ')),
        ],
      });
      return;
    }

    const pool = await prisma.mapPool.findMany({ where: { guildId, game: game! } });

    if (sub === 'random') {
      if (pool.length === 0) {
        await interaction.reply({
          content: `No maps for **${rawGame!.trim()}** yet. Add some with \`/map add\`.`,
          ephemeral: true,
        });
        return;
      }
      const picked = pickRandom(
        pool.map((m) => m.name),
        interaction.options.getInteger('count') ?? 1,
      );
      await interaction.reply(
        picked.length === 1
          ? `🗺️ Next map for **${rawGame!.trim()}**: **${picked[0]}**`
          : `🗺️ Maps for **${rawGame!.trim()}**: ${picked.map((m, i) => `**${i + 1}.** ${m}`).join('  ')}`,
      );
      return;
    }

    // vote
    if (pool.length < 2) {
      await interaction.reply({
        content: `A vote needs at least 2 maps in the **${rawGame!.trim()}** pool.`,
        ephemeral: true,
      });
      return;
    }
    const ballot = pickRandom(
      pool.map((m) => m.name),
      interaction.options.getInteger('choices') ?? 5,
    );
    await interaction.reply({
      poll: {
        question: { text: `Next ${rawGame!.trim()} map?`.slice(0, 300) },
        answers: ballot.map((text) => ({ text })),
        duration: interaction.options.getInteger('hours') ?? 1,
        allowMultiselect: false,
      },
    });
  },
};
