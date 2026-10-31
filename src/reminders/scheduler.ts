import { Client } from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

// A simple DB-polling job rather than per-reminder setTimeouts — reminders
// survive a bot restart this way, and it costs nothing at idle for a small
// self-hosted deployment. Called by src/scheduler on a fixed interval.
export async function checkDueReminders(client: Client<true>): Promise<void> {
  const due = await prisma.reminder.findMany({
    where: { fired: false, remindAt: { lte: new Date() } },
  });

  for (const reminder of due) {
    // Mark fired first so a slow/failed delivery can't cause a repeat send.
    await prisma.reminder.update({ where: { id: reminder.id }, data: { fired: true } });

    const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
    if (!channel || !channel.isSendable()) {
      logger.warn(`Reminder ${reminder.id}: channel ${reminder.channelId} no longer exists or isn't text-based.`);
      continue;
    }

    await channel.send(`<@${reminder.userId}> Reminder: ${reminder.message}`).catch((err) => {
      logger.warn(
        `Could not deliver reminder ${reminder.id} to channel ${reminder.channelId}: ${(err as Error).message}`,
        'The bot may have lost access to that channel.',
      );
    });
  }
}
