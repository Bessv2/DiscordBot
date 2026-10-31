import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { config } from '../../config';
import { prisma } from '../../lib/db';
import { logger } from '../../lib/logger';
import { memberHasPermission } from '../../lib/permissions';
import {
  MAX_PLAYLIST_TRACKS,
  Track,
  UserFacingError,
  formatDuration,
  resolveQuery,
} from '../../music/resolve';

// The heavy, opt-in way to do group jams: the bot itself joins voice and
// streams audio. Always registered so hosts and members can discover it,
// but it only loads the voice code when ENABLE_MUSIC=true. /jam is the
// lightweight default.
type PlayerModule = typeof import('../../music/player');
let playerModule: PlayerModule | null = null;
async function loadPlayer(): Promise<PlayerModule | null> {
  if (playerModule) return playerModule;
  try {
    playerModule = await import('../../music/player');
    return playerModule;
  } catch (err) {
    logger.error(
      `Music: could not load the voice library: ${(err as Error).message}`,
      'Run `npm install` again so the optional @discordjs/voice package gets installed (it needs Node.js 22.12 or newer).',
    );
    return null;
  }
}

/** For shutdown: stops any playback, but only if the player was ever loaded. */
export function stopAllMusic(): void {
  playerModule?.destroyAll();
}

const NOT_ENABLED =
  "Music playback isn't turned on for this bot. The person who runs the bot can turn it on (see **Music** in the README). " +
  'Meanwhile, `/jam` starts a YouTube watch party in voice that needs no setup.';

export const musicCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('The bot plays YouTube music and playlists in your voice channel.')
    .addSubcommand((sc) =>
      sc
        .setName('play')
        .setDescription('Play or queue a song or playlist')
        .addStringOption((o) =>
          o
            .setName('query')
            .setDescription('A YouTube link (video or playlist), or a song to search for')
            .setRequired(true)
            .setMaxLength(300),
        ),
    )
    .addSubcommand((sc) => sc.setName('skip').setDescription('Skip the current song'))
    .addSubcommand((sc) => sc.setName('pause').setDescription('Pause the music'))
    .addSubcommand((sc) => sc.setName('resume').setDescription('Resume the music'))
    .addSubcommand((sc) =>
      sc.setName('queue').setDescription('Show what is playing and what is next'),
    )
    .addSubcommand((sc) => sc.setName('shuffle').setDescription('Shuffle the queue'))
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Remove a song from the queue')
        .addIntegerOption((o) =>
          o
            .setName('position')
            .setDescription('Its number in /music queue')
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sc) =>
      sc.setName('stop').setDescription('Stop, clear the queue, and leave voice'),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    if (!config.ENABLE_MUSIC) {
      await interaction.reply({ content: NOT_ENABLED, ephemeral: true });
      return;
    }
    const mod = await loadPlayer();
    if (!mod) {
      await interaction.reply({
        content:
          "Music is turned on but couldn't start. The bot's host can find the reason in its log.",
        ephemeral: true,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const member = interaction.member;
    const voice = member.voice.channel;
    const music = mod.getPlayer(interaction.guild.id);

    if (sub === 'play') {
      if (!voice) {
        await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
        return;
      }
      if (music && music.channelId !== voice.id) {
        await interaction.reply({
          content: `I'm already playing in <#${music.channelId}>. Join that channel to add songs.`,
          ephemeral: true,
        });
        return;
      }
      const me = await interaction.guild.members.fetchMe();
      const perms = voice.permissionsFor(me);
      if (!perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
        await interaction.reply({
          content: `I need the **Connect** and **Speak** permissions in ${voice}.`,
          ephemeral: true,
        });
        return;
      }
      const text = interaction.channel;
      if (!text?.isSendable()) {
        await interaction.reply({
          content: "I can't post in this channel, so I'd have nowhere to show what's playing.",
          ephemeral: true,
        });
        return;
      }

      // Looking up a playlist can take a few seconds.
      await interaction.deferReply();
      let resolved;
      try {
        resolved = await resolveQuery(interaction.options.getString('query', true));
      } catch (err) {
        if (err instanceof UserFacingError) {
          await interaction.editReply(err.message);
          return;
        }
        const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
        logger.error(
          `Music: lookup failed: ${(err as Error).message}`,
          missing
            ? mod.MISSING_BINARIES_FIX
            : 'If this keeps happening, YouTube may have changed something; restarting the bot updates yt-dlp.',
        );
        await interaction.editReply(
          missing
            ? "Music isn't fully installed on this bot yet. The host can find the fix in its log."
            : "Couldn't look that up on YouTube right now. Try again in a moment.",
        );
        return;
      }
      if (resolved.tracks.length === 0) {
        await interaction.editReply(
          'Nothing playable found (live streams and videos over 3 hours are skipped).',
        );
        return;
      }

      const tracks: Track[] = resolved.tracks.map((t) => ({
        ...t,
        requestedById: member.id,
        requestedByName: member.displayName,
      }));
      let player;
      try {
        player = music ?? (await mod.connect(interaction.guild, voice, text));
      } catch (err) {
        logger.warn(
          `Music: could not join voice in guild ${interaction.guild.id}: ${(err as Error).message}`,
        );
        await interaction.editReply(
          "I couldn't connect to the voice channel. Try again, or check my Connect/Speak permissions there.",
        );
        return;
      }
      player.textChannel = text;
      const wasIdle = !player.current;
      const added = player.enqueue(tracks);
      const skippedNote = resolved.skipped
        ? ` (${resolved.skipped} skipped: unavailable, live, too long, or over ${MAX_PLAYLIST_TRACKS} tracks)`
        : '';
      const fullNote =
        added < tracks.length ? ` The queue is full, so only ${added} were added.` : '';
      await interaction.editReply(
        resolved.playlistTitle
          ? `📃 Queued **${added}** songs from **${resolved.playlistTitle}**${skippedNote}.${fullNote}`
          : wasIdle
            ? `▶️ Starting **${tracks[0]!.title}**`
            : `➕ Queued **${tracks[0]!.title}** \`${formatDuration(tracks[0]!.durationSec)}\` at position ${player.queue.length}.${fullNote}`,
      );
      return;
    }

    if (!music || !music.current) {
      await interaction.reply({
        content: "Nothing's playing. Start something with `/music play`.",
        ephemeral: true,
      });
      return;
    }

    if (sub === 'queue') {
      const lines = music.queue
        .slice(0, 15)
        .map(
          (t, i) =>
            `**${i + 1}.** ${t.title} \`${formatDuration(t.durationSec)}\` · ${t.requestedByName}`,
        );
      const more = music.queue.length > 15 ? `\n…and ${music.queue.length - 15} more` : '';
      const embed = new EmbedBuilder()
        .setTitle(`${music.paused ? '⏸️' : '🎶'} ${music.current.title}`)
        .setURL(music.current.url)
        .setDescription(lines.length ? lines.join('\n') + more : 'Nothing queued after this one.')
        .setFooter({
          text: `Requested by ${music.current.requestedByName} · ${music.queue.length} in queue`,
        });
      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }

    // Everything below changes playback: you have to be listening.
    if (voice?.id !== music.channelId) {
      await interaction.reply({
        content: `Join <#${music.channelId}> to control the music.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'pause' || sub === 'resume') {
      const ok = sub === 'pause' ? music.pause() : music.resume();
      await interaction.reply(
        ok
          ? sub === 'pause'
            ? '⏸️ Paused.'
            : '▶️ Resumed.'
          : `Already ${sub === 'pause' ? 'paused' : 'playing'}.`,
      );
      return;
    }

    if (sub === 'skip') {
      if (!(await canControl(member, music.current.requestedById))) {
        await interaction.reply({
          content: 'Only the DJ role, a moderator, or whoever queued this song can skip it.',
          ephemeral: true,
        });
        return;
      }
      const title = music.current.title;
      music.skip();
      await interaction.reply({
        content: `⏭️ Skipped **${title}**.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (sub === 'remove') {
      const pos = interaction.options.getInteger('position', true);
      const track = music.queue[pos - 1];
      if (!track) {
        await interaction.reply({
          content: `There's no song #${pos} in the queue.`,
          ephemeral: true,
        });
        return;
      }
      if (!(await canControl(member, track.requestedById))) {
        await interaction.reply({
          content: 'Only the DJ role, a moderator, or whoever queued that song can remove it.',
          ephemeral: true,
        });
        return;
      }
      music.queue.splice(pos - 1, 1);
      await interaction.reply({
        content: `🗑️ Removed **${track.title}**.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (sub === 'shuffle' || sub === 'stop') {
      if (!(await canControl(member, null))) {
        await interaction.reply({
          content: `Only the DJ role or a moderator can ${sub} the music.`,
          ephemeral: true,
        });
        return;
      }
      if (sub === 'shuffle') {
        music.shuffle();
        await interaction.reply('🔀 Shuffled the queue.');
      } else {
        music.destroy();
        await interaction.reply('⏹️ Stopped and left the voice channel.');
      }
    }
  },
};

/**
 * Without a DJ role set (/setup → Music), anyone listening can control
 * playback. With one, it takes that role, moderator rights, or having
 * queued the track in question.
 */
async function canControl(member: GuildMember, trackOwnerId: string | null): Promise<boolean> {
  const cfg = await prisma.guildConfig.findUnique({
    where: { id: member.guild.id },
    select: { musicDjRoleId: true },
  });
  if (!cfg?.musicDjRoleId) return true;
  if (trackOwnerId === member.id) return true;
  if (member.roles.cache.has(cfg.musicDjRoleId)) return true;
  return memberHasPermission(member, 'moderation', PermissionFlagsBits.ModerateMembers);
}
