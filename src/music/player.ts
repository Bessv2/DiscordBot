// Only ever loaded through a dynamic import from /music when ENABLE_MUSIC
// is on, so a host who never turns music on never loads @discordjs/voice
// or starts a single ffmpeg process.
import { ChildProcess, spawn } from 'node:child_process';
import { Guild, SendableChannels, VoiceBasedChannel } from 'discord.js';
import {
  AudioPlayer,
  AudioPlayerStatus,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import { logger } from '../lib/logger';
import { Track, YTDLP_BASE_ARGS, formatDuration } from './resolve';

export const MAX_QUEUE = 200;
const IDLE_LEAVE_MS = 5 * 60_000; // queue empty this long → leave voice
const ALONE_CHECK_MS = 30_000; // nobody else in the channel for 2 checks → leave

export class GuildMusic {
  readonly queue: Track[] = [];
  current: Track | null = null;
  private readonly player: AudioPlayer;
  private procs: ChildProcess[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private aloneTimer: NodeJS.Timeout;
  private aloneStrikes = 0;
  private destroyed = false;

  constructor(
    readonly guild: Guild,
    readonly connection: VoiceConnection,
    public textChannel: SendableChannels,
  ) {
    this.player = createAudioPlayer();
    connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.killProcs();
      void this.playNext();
    });
    this.player.on('error', (err) => {
      logger.warn(
        `Music: playback error in guild ${guild.id} on "${this.current?.title}": ${err.message}`,
      );
      void this.say(`⚠️ Couldn't play **${this.current?.title ?? 'that track'}**, skipping it.`);
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      // A move between channels shows up as a brief disconnect; a kick
      // stays disconnected. Give it a few seconds to tell them apart.
      Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]).catch(() => this.destroy());
    });

    this.aloneTimer = setInterval(() => this.checkAlone(), ALONE_CHECK_MS);
  }

  get channelId(): string | null {
    return this.connection.joinConfig.channelId;
  }

  get paused(): boolean {
    return this.player.state.status === AudioPlayerStatus.Paused;
  }

  enqueue(tracks: Track[]): number {
    const room = MAX_QUEUE - this.queue.length;
    const added = tracks.slice(0, Math.max(room, 0));
    this.queue.push(...added);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.current) void this.playNext();
    return added.length;
  }

  skip(): void {
    // Stopping fires Idle, which moves on to the next track.
    this.player.stop(true);
  }

  pause(): boolean {
    return this.player.pause();
  }

  resume(): boolean {
    return this.player.unpause();
  }

  shuffle(): void {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j]!, this.queue[i]!];
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.queue.length = 0;
    this.current = null;
    clearInterval(this.aloneTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.player.stop(true);
    this.killProcs();
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    players.delete(this.guild.id);
  }

  private async playNext(): Promise<void> {
    if (this.destroyed) return;
    const next = this.queue.shift() ?? null;
    this.current = next;
    if (!next) {
      this.idleTimer = setTimeout(() => {
        void this.say('👋 Queue finished a while ago, so I left the voice channel.');
        this.destroy();
      }, IDLE_LEAVE_MS);
      return;
    }

    // yt-dlp downloads the audio, ffmpeg turns it into Ogg/Opus, which is
    // what Discord voice carries, so no Opus encoder is needed in Node.
    const ytdlp = spawn(
      'yt-dlp',
      [
        ...YTDLP_BASE_ARGS,
        '-f',
        'bestaudio/best',
        '--no-playlist',
        '--quiet',
        '-o',
        '-',
        '--',
        next.url,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-vn',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-c:a',
        'libopus',
        '-b:a',
        '96k',
        '-f',
        'ogg',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.procs = [ytdlp, ffmpeg];

    let ytErr = '';
    ytdlp.stderr.on('data', (d: Buffer) => (ytErr = (ytErr + d.toString()).slice(-1000)));
    ytdlp.on('close', (code) => {
      if (code && code !== 0 && !ytdlp.killed)
        logger.warn(
          `Music: yt-dlp failed on ${next.url} (code ${code}): ${ytErr.trim().split('\n').pop()}`,
        );
    });
    for (const p of this.procs) {
      p.on('error', (err) =>
        logger.error(`Music: could not start ${p.spawnfile}: ${err.message}`, MISSING_BINARIES_FIX),
      );
    }
    // Skipping kills the pipeline mid-stream; those broken-pipe errors are expected.
    ffmpeg.stdin.on('error', () => undefined);
    ytdlp.stdout.on('error', () => undefined);
    ytdlp.stdout.pipe(ffmpeg.stdin);

    this.player.play(
      createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus, metadata: next }),
    );
    await this.say(
      `🎶 Now playing **${next.title}** \`${formatDuration(next.durationSec)}\` — requested by ${next.requestedByName}`,
    );
  }

  private killProcs(): void {
    for (const p of this.procs) if (p.exitCode === null) p.kill('SIGKILL');
    this.procs = [];
  }

  private checkAlone(): void {
    const channel = this.channelId
      ? (this.guild.channels.cache.get(this.channelId) as VoiceBasedChannel | undefined)
      : undefined;
    const humans = channel?.members.filter((m) => !m.user.bot).size ?? 0;
    this.aloneStrikes = humans === 0 ? this.aloneStrikes + 1 : 0;
    if (this.aloneStrikes >= 2) {
      void this.say('👋 Everyone left the voice channel, so I stopped the music.');
      this.destroy();
    }
  }

  private async say(text: string): Promise<void> {
    // allowedMentions none: titles come from YouTube and requester names from members.
    await this.textChannel
      .send({ content: text, allowedMentions: { parse: [] } })
      .catch(() => undefined);
  }
}

export const MISSING_BINARIES_FIX =
  'Music needs ffmpeg and yt-dlp, which only the music build of the bot includes. ' +
  'With Docker, set ENABLE_MUSIC=true and BOT_IMAGE_TAG=music in .env, then run `docker compose up -d`. ' +
  'Without Docker, install ffmpeg and yt-dlp so both are on the PATH.';

const players = new Map<string, GuildMusic>();

export function getPlayer(guildId: string): GuildMusic | undefined {
  return players.get(guildId);
}

export async function connect(
  guild: Guild,
  channel: VoiceBasedChannel,
  textChannel: SendableChannels,
): Promise<GuildMusic> {
  const existing = players.get(guild.id);
  if (existing) return existing;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true, // the bot never listens; deafening tells Discord not to send it audio at all
  });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (err) {
    connection.destroy();
    throw err;
  }
  const music = new GuildMusic(guild, connection, textChannel);
  players.set(guild.id, music);
  return music;
}

/** Called on shutdown so no ffmpeg/yt-dlp children outlive the bot. */
export function destroyAll(): void {
  for (const p of [...players.values()]) p.destroy();
}
