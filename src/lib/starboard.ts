import { EmbedBuilder, MessageReaction } from 'discord.js';
import { prisma } from './db';
import { config } from '../config';
import { logger } from './logger';

/**
 * Keeps the starboard post for a message in sync with its current reaction
 * count on the configured emoji. Once a message crosses the threshold it
 * gets posted once and then only has its count updated — it's never
 * un-posted if the count later drops, matching how most starboard bots
 * behave (it's an archive, not a live leaderboard).
 */
export async function syncStarboard(reaction: MessageReaction): Promise<void> {
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message || !message.guild) return;

  const guildConfig = await prisma.guildConfig.findUnique({ where: { id: message.guild.id } });
  if (!guildConfig?.starboardChannelId) return;
  if (reaction.emoji.name !== guildConfig.starboardEmoji && reaction.emoji.toString() !== guildConfig.starboardEmoji) return;

  const count = reaction.count ?? 0;
  const existing = await prisma.starboardPost.findUnique({
    where: { guildId_originalMessageId: { guildId: message.guild.id, originalMessageId: message.id } },
  });

  const starboardChannel = await message.guild.channels.fetch(guildConfig.starboardChannelId).catch(() => null);
  if (!starboardChannel || !starboardChannel.isSendable()) return;

  if (existing) {
    const starboardMessage = await starboardChannel.messages.fetch(existing.starboardMessageId).catch(() => null);
    await starboardMessage
      ?.edit({ content: `${guildConfig.starboardEmoji} **${count}** | ${message.channel}` })
      .catch(() => undefined);
    await prisma.starboardPost.update({ where: { id: existing.id }, data: { starCount: count } });
    return;
  }

  if (count < guildConfig.starboardThreshold) return;

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: message.author?.tag ?? 'Unknown', iconURL: message.author?.displayAvatarURL() })
    .addFields({ name: 'Source', value: `[Jump to message](${message.url})` })
    .setTimestamp(message.createdAt);

  // message.content is gated behind the Message Content privileged intent —
  // without it, Discord redacts it even on a direct REST fetch like this.
  if (config.ENABLE_MESSAGE_CONTENT) {
    embed.setDescription(message.content || '*(no text content)*');
  }
  const image = message.attachments.find((a) => a.contentType?.startsWith('image/'));
  if (image) embed.setImage(image.url);

  const posted = await starboardChannel
    .send({ content: `${guildConfig.starboardEmoji} **${count}** | ${message.channel}`, embeds: [embed] })
    .catch((err) => {
      logger.warn(`Could not post starboard entry in guild ${message.guild!.id}: ${(err as Error).message}`);
      return null;
    });
  if (!posted) return;

  await prisma.starboardPost.create({
    data: {
      guildId: message.guild.id,
      originalMessageId: message.id,
      originalChannelId: message.channelId,
      starboardMessageId: posted.id,
      starCount: count,
    },
  });
}
