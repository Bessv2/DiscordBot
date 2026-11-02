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

// `NAME=` with nothing after it (as .env.example ships) means "use the default".
const blankIsUnset = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

// Every env var the bot reads lives here and in .env.example — nothing
// sensitive or tunable is allowed to be read directly via process.env
// elsewhere, so this file is always the full list of what a host can set.
const envSchema = z.object({
  // trim(): a stray space or newline from copy-pasting is the most common
  // first-run mistake, and Discord just reports it as an invalid token.
  DISCORD_TOKEN: z.string().trim().min(1, 'DISCORD_TOKEN is required'),
  // Optional: the bot learns its own application ID from the token at
  // login. Kept for anyone who already set it, and for deploy-commands.
  DISCORD_CLIENT_ID: z.string().optional(),
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

  // Opt-in heavy module: the bot joins voice and plays YouTube audio. Needs
  // ffmpeg + yt-dlp, which only the music image ships (see README → Music).
  // Off by default: it costs ~100-200MB RAM while playing, and streaming
  // YouTube through a bot is against YouTube's Terms of Service.
  ENABLE_MUSIC: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  // Opt-in web dashboard, served by the bot itself (no extra container).
  // Admins sign in with a one-time link from /dashboard, so there are no
  // passwords to manage. Listens on this machine only unless DASHBOARD_HOST
  // says otherwise (compose sets 0.0.0.0 inside the container and publishes
  // the port on 127.0.0.1 only).
  ENABLE_DASHBOARD: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  DASHBOARD_PORT: blankIsUnset(z.coerce.number().int().min(1).max(65535).default(3000)),
  DASHBOARD_HOST: blankIsUnset(z.string().trim().min(1).default('127.0.0.1')),
  // The address people open in their browser. Behind a reverse proxy or a
  // tunnel, set it to the public https:// address so sign-in links work.
  DASHBOARD_URL: blankIsUnset(
    z
      .string()
      .trim()
      .url('DASHBOARD_URL must be a full address like https://bot.example.com')
      .optional()
      .transform((v) => v?.replace(/\/+$/, '')),
  ),

  // Add-ons (RSS feeds) normally refuse private and local addresses, so a
  // server admin can't use the bot to reach the host's own network. Turn on
  // only if every admin of every server the bot is in is trusted, e.g. to
  // read a feed from a reader on your own network.
  ADDONS_ALLOW_PRIVATE_NETWORK: z
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
