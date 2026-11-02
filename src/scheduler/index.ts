import { Client } from 'discord.js';
import { logger } from '../lib/logger';
import { checkDueReminders } from '../reminders/scheduler';
import { checkExpiredMutes } from '../lib/muteActions';
import { checkBirthdays } from '../birthdays/jobs';
import { checkStreamNotifications } from '../streaming/jobs';
import { sweepSpamLog } from '../automod/spam';
import { checkGiveaways } from '../features/giveaways';
import { checkAnnouncements } from '../features/announcements';
import { pruneExpiredContent } from '../lib/contentRetention';
import { checkAddons } from '../addons/runner';
import { reconcileNativeAutomod } from '../automod/native';
import { dailyBackup } from '../lib/backup';

const FAST_INTERVAL_MS = 15_000; // reminders, mute expiry — cheap, time-sensitive
const SLOW_INTERVAL_MS = 5 * 60_000; // birthdays, stream polling — coarser, rate-limit-conscious

// One scheduler owns all periodic jobs so there's a single place to reason
// about polling cost at idle, rather than N independent setIntervals.
let fastRunning = false;
let slowRunning = false;

export function startScheduler(client: Client<true>): void {
  setInterval(() => {
    if (fastRunning) return;
    fastRunning = true;
    runFastTick(client)
      .catch((err) => logger.error(`Scheduler (fast tick) error: ${(err as Error).message}`))
      .finally(() => {
        fastRunning = false;
      });
  }, FAST_INTERVAL_MS);

  setInterval(() => {
    if (slowRunning) return;
    slowRunning = true;
    runSlowTick(client)
      .catch((err) => logger.error(`Scheduler (slow tick) error: ${(err as Error).message}`))
      .finally(() => {
        slowRunning = false;
      });
  }, SLOW_INTERVAL_MS);

  // Run the slow tick once shortly after boot too, so birthdays/streams
  // don't wait a full SLOW_INTERVAL_MS after a restart.
  setTimeout(
    () =>
      void runSlowTick(client).catch((err) =>
        logger.error(`Scheduler (startup slow tick) error: ${(err as Error).message}`),
      ),
    10_000,
  );
}

async function runFastTick(client: Client<true>): Promise<void> {
  await checkDueReminders(client);
  await checkExpiredMutes(client);
  await checkGiveaways(client);
  await checkAnnouncements(client);
  sweepSpamLog(Date.now());
}

async function runSlowTick(client: Client<true>): Promise<void> {
  await checkBirthdays(client);
  await checkStreamNotifications(client);
  await pruneExpiredContent(client);
  await checkAddons(client);
  await reconcileNativeAutomod(client.guilds.cache);
  await dailyBackup();
}
