import { Client } from 'discord.js';
import { config } from '../config';
import { logger } from '../lib/logger';
import { prisma } from '../lib/db';
import { startReminderScheduler } from '../reminders/scheduler';

export function ready(client: Client<true>): void {
  logger.info(`Logged in as ${client.user.tag} — serving ${client.guilds.cache.size} guild(s).`);
  startReminderScheduler(client);
  void warnIfContentFiltersDisabled();
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
