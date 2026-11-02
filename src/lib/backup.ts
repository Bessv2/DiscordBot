// Database backups that work the same on every platform, Windows included:
// the bot asks SQLite for a consistent copy (VACUUM INTO), which is safe
// while the bot is running, so there's no sqlite3 tool to install and no
// need to stop anything. Copies go to a "backups" folder next to the
// database, which in Docker is ./data/backups on the host.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { prisma } from './db';
import { logger } from './logger';

/** The database file on disk, or null when it isn't SQLite. */
export function sqliteFile(databaseUrl = config.DATABASE_URL): string | null {
  const match = /^file:(.+)$/.exec(databaseUrl);
  if (!match) return null;
  // Prisma resolves relative SQLite paths against prisma/ (see healthcheck.ts).
  const prismaDir = path.resolve(__dirname, '..', '..', 'prisma');
  return path.resolve(prismaDir, match[1]!.replace(/\?.*$/, ''));
}

export function backupDir(dbFile: string): string {
  return path.join(path.dirname(dbFile), 'backups');
}

export function backupName(now = new Date()): string {
  return `bot-${now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}.db`;
}

/** Oldest-first list of backups in a folder, and which to delete to keep `keep`. Pure. */
export function backupsToPrune(files: string[], keep: number): string[] {
  const ours = files.filter((f) => /^bot-\d{8}-\d{6}\.db$/.test(f)).sort();
  return keep > 0 ? ours.slice(0, Math.max(0, ours.length - keep)) : [];
}

/** Makes one backup. Returns its path. Throws with a readable message. */
export async function backupDatabase(keep = config.BACKUP_KEEP): Promise<string> {
  const file = sqliteFile();
  if (!file) throw new Error('backups here are for SQLite; for Postgres use pg_dump');
  const dir = backupDir(file);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, backupName());
  if (fs.existsSync(dest)) throw new Error('a backup was already made this second');
  // VACUUM INTO takes a string literal, not a bound parameter; the path is
  // ours (not user input), and quotes are doubled anyway.
  await prisma.$executeRawUnsafe(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  for (const old of backupsToPrune(fs.readdirSync(dir), Math.max(keep, 1)))
    fs.rmSync(path.join(dir, old), { force: true });
  return dest;
}

/** Slow-tick job: one automatic backup a day, if BACKUP_KEEP is above 0. */
export async function dailyBackup(now = Date.now()): Promise<void> {
  if (config.BACKUP_KEEP <= 0) return;
  const file = sqliteFile();
  if (!file) return;
  const dir = backupDir(file);
  const newest = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /^bot-\d{8}-\d{6}\.db$/.test(f))
        .map((f) => fs.statSync(path.join(dir, f)).mtimeMs)
        .sort((a, b) => b - a)[0]
    : undefined;
  if (newest && now - newest < 23.5 * 3600_000) return;
  try {
    const dest = await backupDatabase();
    logger.info(`Daily database backup saved: ${dest}`);
  } catch (err) {
    logger.warn(
      `Daily database backup failed: ${(err as Error).message}`,
      `Check there's free disk space and that the folder next to the database is writable. Set BACKUP_KEEP=0 in .env to turn daily backups off.`,
    );
  }
}
