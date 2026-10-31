import { Message, PermissionFlagsBits } from 'discord.js';
import { GuildConfig } from '@prisma/client';
import { prisma } from '../lib/db';
import { config } from '../config';
import { logger } from '../lib/logger';
import { postAutomodLog } from '../lib/modlog';
import { recordMessageAndCheckSpam } from './spam';
import { containsInviteLink } from './invite';
import { findBannedWord } from './wordFilter';
import { isMentionSpam } from './mentionSpam';

/** Returns true if the message was flagged (and deleted), so callers can skip XP/prefix handling for it. */
export async function runAutomod(message: Message<true>): Promise<boolean> {
  const guildConfig = await prisma.guildConfig.findUnique({ where: { id: message.guild.id } });
  if (!guildConfig?.automodEnabled) return false;

  const member = message.member;
  if (!member) return false;
  // Mods policing their own channels shouldn't get caught by their own filters.
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

  const override = await prisma.channelAutomodOverride.findUnique({
    where: { guildId_channelId: { guildId: message.guild.id, channelId: message.channelId } },
  });

  const spamKey = `${message.guild.id}:${message.author.id}`;
  if (
    !override?.exemptSpam &&
    recordMessageAndCheckSpam(spamKey, Date.now(), guildConfig.spamMessageLimit, guildConfig.spamIntervalMs)
  ) {
    await flagMessage(message, guildConfig, 'spam', 'Sending messages too quickly.');
    return true;
  }

  // Everything past this point needs to read message text/mentions, which
  // is only reliable with the privileged Message Content intent — see
  // src/discord/client.ts for why that's opt-in via ENABLE_MESSAGE_CONTENT.
  if (!config.ENABLE_MESSAGE_CONTENT) return false;

  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  if (!override?.exemptMentionSpam && isMentionSpam(mentionCount, guildConfig.mentionSpamLimit)) {
    await flagMessage(message, guildConfig, 'mention-spam', `Mentioned ${mentionCount} users/roles in one message.`);
    return true;
  }

  if (guildConfig.inviteFilterOn && !override?.exemptInvite && containsInviteLink(message.content)) {
    await flagMessage(message, guildConfig, 'invite-link', 'Posted a Discord invite link.');
    return true;
  }

  if (guildConfig.wordFilterOn && !override?.exemptWordFilter) {
    const bannedWords: string[] = JSON.parse(guildConfig.bannedWords || '[]');
    const hit = findBannedWord(message.content, bannedWords);
    if (hit) {
      await flagMessage(message, guildConfig, 'word-filter', 'Used a banned word or phrase.');
      return true;
    }
  }
  return false;
}

async function flagMessage(
  message: Message<true>,
  guildConfig: GuildConfig,
  rule: string,
  reason: string,
): Promise<void> {
  if (message.deletable) {
    await message.delete().catch((err) => {
      logger.warn(
        `Automod could not delete a message in guild ${message.guild.id}: ${(err as Error).message}`,
        'Grant the bot the Manage Messages permission in that channel.',
      );
    });
  }

  await postAutomodLog(message.guild, {
    rule,
    user: message.author,
    channelId: message.channelId,
    reason,
    contentSnippet: guildConfig.logMessageContent ? message.content.slice(0, 500) : undefined,
  });
}
