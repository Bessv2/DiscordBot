import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './db';
import { config } from '../config';
import { logger } from './logger';

/**
 * Runs before the bot attempts to log in, so failures come with a specific
 * fix instead of a stack trace three layers deep in discord.js (principle:
 * "fails loudly with a specific fix instead of a stack trace").
 */
export async function runStartupHealthCheck(): Promise<void> {
  checkWritableDataDir();
  await checkDatabaseConnection();
}

function checkWritableDataDir(): void {
  const match = config.DATABASE_URL.match(/^file:(.+)$/);
  if (!match) return; // Not SQLite (e.g. Postgres) — nothing local to check.

  const dbPath = match[1]!;
  // Prisma resolves a relative sqlite path against the prisma/ directory,
  // not process.cwd() — this must match that exactly, or the health check
  // ends up inspecting a different directory than the one the app actually
  // reads/writes. dist/lib (compiled) and src/lib (tsx dev) are both two
  // levels under the project root, same as prisma/'s parent.
  const prismaDir = path.resolve(__dirname, '..', '..', 'prisma');
  const dir = path.dirname(path.resolve(prismaDir, dbPath));

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (err) {
    logger.error(
      `Data directory "${dir}" is not writable: ${(err as Error).message}`,
      'If running in Docker, make sure ./data is mounted as a volume and owned by the container user. ' +
        'If running bare Node, check the directory permissions.',
    );
    process.exit(1);
  }
}

async function checkDatabaseConnection(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.error(
      `Could not connect to the database: ${(err as Error).message}`,
      'Run "npx prisma migrate deploy" (or "npm run db:migrate") to create/update the database schema, ' +
        'and check that DATABASE_URL in .env points to a valid, writable path.',
    );
    process.exit(1);
  }
}
