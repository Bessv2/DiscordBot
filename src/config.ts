import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env from the project root explicitly rather than relying on
// process.cwd() — a process manager (pm2, systemd) may launch this with a
// different working directory. dist/ (compiled) and src/ (tsx dev) are
// both one level under the project root. In Docker, docker-compose injects
// env vars directly (no .env file inside the image), so this is a no-op
// there — dotenv never overrides a variable that's already set.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Every env var the bot reads lives here and in .env.example — nothing
// sensitive or tunable is allowed to be read directly via process.env
// elsewhere, so this file is always the full list of what a host can set.
const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: z.string().optional(),
  // Relative to prisma/, not the project root — see the note in .env.example.
  DATABASE_URL: z.string().min(1).default('file:../data/bot.db'),
  ENABLE_MESSAGE_CONTENT: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  ENABLE_PREFIX_COMMANDS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  PREFIX: z.string().min(1).default('!'),

  // Privileged — gates guildMemberAdd/Remove (welcome/goodbye) since they
  // don't fire reliably without it. See src/discord/client.ts.
  ENABLE_GUILD_MEMBERS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  // Privileged — gates presenceUpdate (voice-channel activity roles).
  ENABLE_PRESENCE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  // Optional integrations below — every one of them fails closed (feature
  // just doesn't run, logged once) rather than crashing when unset.
  TWITCH_CLIENT_ID: z.string().optional(),
  TWITCH_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  STEAM_API_KEY: z.string().optional(),
  RIOT_API_KEY: z.string().optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

export type AppConfig = z.infer<typeof envSchema>;

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(
      `[startup] Invalid or missing configuration in .env:\n${issues}\n\n` +
        `Fix: copy .env.example to .env if you haven't, and fill in the required values.`,
    );
    process.exit(1);
  }
  // Prisma reads process.env.DATABASE_URL itself and never sees zod's
  // default, so write the resolved value back — otherwise an omitted
  // DATABASE_URL means the health check and Prisma disagree on the path.
  process.env.DATABASE_URL = parsed.data.DATABASE_URL;
  return parsed.data;
}

export const config = loadConfig();
