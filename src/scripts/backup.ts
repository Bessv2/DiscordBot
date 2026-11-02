// `npm run backup` (or, with Docker: `docker compose exec bot npm run backup`).
// Saves a copy of the database next to it, in backups/, safely while the
// bot keeps running. Works the same on Windows, Mac and Linux.
import { backupDatabase } from '../lib/backup';
import { prisma } from '../lib/db';

backupDatabase()
  .then((dest) => {
    console.log(`Backed up the database to ${dest}`);
    console.log('To restore: stop the bot, copy that file over data/bot.db, start the bot.');
  })
  .catch((err: Error) => {
    console.error(`Backup failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
