import { Client, OAuth2Scopes, PermissionFlagsBits } from 'discord.js';
import { config } from '../config';
import { logger } from '../lib/logger';
import { prisma } from '../lib/db';
import { startScheduler } from '../scheduler';
import { syncCommandsIfChanged } from '../discord/commandSync';
import { cleanupTempVoice } from '../features/tempVoice';

// What the bot itself needs to carry out every feature. Kept to an explicit
// list (not Administrator) so a host can see exactly what they're granting.
const INVITE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ManageMessages, // auto-mod deletes, poll/starboard cleanup
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers, // timeouts
  PermissionFlagsBits.ManageRoles, // mute role, reaction/XP/birthday/activity roles
  PermissionFlagsBits.ManageChannels, // lockdown, mute-role channel overrides
  PermissionFlagsBits.CreateInstantInvite, // /jam watch-party invites
  PermissionFlagsBits.SendPolls, // /map vote
  PermissionFlagsBits.Connect, // /music (opt-in)
  PermissionFlagsBits.Speak, // /music (opt-in)
  PermissionFlagsBits.CreatePrivateThreads, // tickets
  PermissionFlagsBits.SendMessagesInThreads, // tickets
  PermissionFlagsBits.ManageThreads, // tickets: lock/archive on close
  PermissionFlagsBits.AttachFiles, // ticket transcripts
  PermissionFlagsBits.MoveMembers, // join-to-create voice
];

export function ready(client: Client<true>): void {
  logger.info(`Logged in as ${client.user.tag} — serving ${client.guilds.cache.size} guild(s).`);
  logInviteLink(client);
  startScheduler(client);
  void syncCommandsIfChanged(client);
  void cleanupTempVoice(client).catch((err) =>
    logger.warn(`Temp voice cleanup failed: ${(err as Error).message}`),
  );
  void warnIfContentFiltersDisabled();
}

// Saves a first-time host from hunting through the Developer Portal's URL
// generator: the link they need is right there in the logs.
function logInviteLink(client: Client<true>): void {
  const url = client.generateInvite({
    scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
    permissions: INVITE_PERMISSIONS,
  });
  if (client.guilds.cache.size === 0) {
    logger.info(
      `The bot isn't in any server yet. Open this link in your browser to add it to one:\n    ${url}`,
    );
  } else {
    logger.info(`Invite link (to add the bot to another server): ${url}`);
  }
}

async function warnIfContentFiltersDisabled(): Promise<void> {
  if (config.ENABLE_MESSAGE_CONTENT) return;

  const affected = await prisma.guildConfig.count({
    where: { OR: [{ inviteFilterOn: true }, { wordFilterOn: true }] },
  });
  if (affected > 0) {
    logger.warn(
      `${affected} guild(s) have the invite-link or word filter turned on, but ENABLE_MESSAGE_CONTENT=false so they won't run.`,
      'Enable "Message Content Intent" in the Discord Developer Portal, then set ENABLE_MESSAGE_CONTENT=true in .env and restart.',
    );
  }
}
