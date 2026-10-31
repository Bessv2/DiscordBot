import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  DiscordAPIError,
  InviteTargetType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  VoiceBasedChannel,
} from 'discord.js';
import { Command } from '../types';
import { logger } from '../../lib/logger';

// Discord's own "Watch Together" activity (YouTube, run by Discord). The bot
// only creates an invite that launches it: no audio passes through the bot,
// so this costs nothing to run and needs no ffmpeg, API key, or ToS gamble.
// That's why it's the default way to do group jams, with /music as the
// heavy opt-in alternative.
export const WATCH_TOGETHER_APP_ID = '880218394199220334';

export const jamCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('jam')
    .setDescription(
      'Start a YouTube Watch Together in voice: queue songs and playlists, everyone hears it in sync.',
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Voice channel to start it in (defaults to the one you are in)')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(false),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;

    const picked = interaction.options.getChannel('channel');
    const channel = (picked ?? interaction.member.voice.channel) as VoiceBasedChannel | null;
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await interaction.reply({
        content:
          'Join a voice channel first (or pick one with the `channel` option), then run `/jam` again.',
        ephemeral: true,
      });
      return;
    }

    const me = await interaction.guild.members.fetchMe();
    if (!channel.permissionsFor(me).has(PermissionFlagsBits.CreateInstantInvite)) {
      await interaction.reply({
        content:
          `I need the **Create Invite** permission in ${channel} to start a watch party. ` +
          'An admin can add it in the channel settings → Permissions.',
        ephemeral: true,
      });
      return;
    }

    try {
      const invite = await channel.createInvite({
        targetType: InviteTargetType.EmbeddedApplication,
        targetApplication: WATCH_TOGETHER_APP_ID,
        maxAge: 6 * 60 * 60, // 6 hours: long enough for a session, short enough not to linger
        reason: `/jam by ${interaction.user.tag}`,
      });
      const button = new ButtonBuilder()
        .setLabel('Join the watch party')
        .setStyle(ButtonStyle.Link)
        .setURL(invite.url);
      await interaction.reply({
        content:
          `🎵 **Watch party in ${channel}!**\n` +
          'Click the button to start or join. Inside, paste a YouTube video or playlist link to queue it, and everyone in the activity sees and hears it in sync.',
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
      });
    } catch (err) {
      const code = err instanceof DiscordAPIError ? err.code : null;
      logger.warn(
        `/jam could not create a Watch Together invite in guild ${interaction.guild.id}: ${(err as Error).message}`,
      );
      await interaction.reply({
        content:
          code === 50013
            ? `I'm missing permissions in ${channel}. I need **Create Invite** there.`
            : "Discord wouldn't start Watch Together just now. You can still start it by hand: in the voice channel, click the 🚀 **Activities** button and pick **Watch Together**.",
        ephemeral: true,
      });
    }
  },
};
