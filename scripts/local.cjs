#!/usr/bin/env node
// Runs the bot without Docker, on Windows, macOS, Linux or a Raspberry Pi.
// It does what the Docker image and docker-entrypoint.sh do, with only Node
// installed:
//
//   node scripts/local.cjs setup    first run: checks Node, makes .env (asks for
//                                    the token), installs, builds, creates the database
//   node scripts/local.cjs start    applies pending migrations, then runs the bot
//   node scripts/local.cjs update   backup, git pull, reinstall, rebuild, migrate
//
// (npm run setup / npm run bot / npm run update-bot are the same commands.)
//
// Plain CommonJS with no dependencies, because `setup` runs before
// node_modules exists. The bot itself runs inside this process (not as a
// child), so Ctrl+C, pm2 and systemd signals reach its shutdown handler
// directly and there's no extra Node process using memory.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

const { nodeVersionOk, readEnvValue, setEnvValue, looksLikeToken } = require('./local-helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const IS_WINDOWS = process.platform === 'win32';

// ── Output ─────────────────────────────────────────────────────────────────

function say(msg) {
  console.log(`[bot] ${msg}`);
}

/** Stops with the problem and a plain-English fix, like the bot's own startup checks. */
function fail(problem, fix) {
  console.error(`\n[bot] ${problem}`);
  if (fix) console.error(`  -> Fix: ${fix}`);
  process.exit(1);
}

// ── Steps ──────────────────────────────────────────────────────────────────

function checkNode() {
  if (!nodeVersionOk(process.versions.node)) {
    fail(
      `This bot needs Node.js 22.12 or newer, but this is Node ${process.versions.node}.`,
      'Install the current "LTS" version from https://nodejs.org (on a Raspberry Pi or Linux server, ' +
        'see docs/WITHOUT-DOCKER.md), then open a new terminal and try again.',
    );
  }
}

/** Every command we run gets these: no Prisma update check (§7), dev deps kept for the build. */
function childEnv(extra = {}) {
  return { ...process.env, CHECKPOINT_DISABLE: '1', ...extra };
}

function run(cmd, args, opts = {}) {
  // npm is npm.cmd on Windows, which Node only runs through a shell. The
  // arguments are fixed strings from this file, never user input.
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: childEnv(opts.env),
    shell: IS_WINDOWS && cmd === 'npm',
    timeout: opts.timeout,
  });
  if (result.error && result.error.code === 'ENOENT') return { ok: false, missing: true };
  return { ok: result.status === 0, status: result.status };
}

function npm(args, what) {
  say(`${what}...`);
  const r = run('npm', args);
  if (r.missing)
    fail('npm was not found.', 'It comes with Node.js: reinstall Node from https://nodejs.org.');
  if (!r.ok) {
    fail(
      `"npm ${args.join(' ')}" failed (see the messages above).`,
      'Check your internet connection and that you have a few hundred MB of free disk space, then run it again. ' +
        'On Windows, stop the bot first: a running bot keeps its files locked.',
    );
  }
}

/** Prisma's CLI, run with this Node directly so it works the same everywhere. */
function migrate() {
  const cli = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(cli)) fail('The bot is not installed yet.', 'Run: npm run setup');
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  say('applying database migrations...');
  const r = run(process.execPath, [cli, 'migrate', 'deploy']);
  if (!r.ok) {
    fail(
      'The database could not be set up or upgraded (see the messages above).',
      'Make sure the "data" folder is writable by the user running the bot and DATABASE_URL in .env ' +
        'is "file:../data/bot.db" (or your Postgres address). Your data is not changed when this fails.',
    );
  }
}

/** Loads .env into process.env the same way the bot will (existing variables win). */
function loadEnv() {
  try {
    require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') });
  } catch {
    // dotenv not installed yet: setup installs it before anything needs it.
  }
  // Prisma's CLI needs DATABASE_URL; the bot defaults it the same way (src/config.ts).
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:../data/bot.db';
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (hidden) {
      // Don't echo the token, so it doesn't end up on screen or in a screenshot.
      rl._writeToOutput = (s) => {
        if (s.includes(question)) process.stdout.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function ensureEnvFile({ interactive }) {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(path.join(ROOT, '.env.example'), envPath);
    say('created .env from .env.example');
  }
  let text = fs.readFileSync(envPath, 'utf8');
  if (readEnvValue(text, 'DISCORD_TOKEN')) return;

  if (!interactive || !process.stdin.isTTY) {
    say('DISCORD_TOKEN in .env is still empty. Put your bot token there before starting the bot.');
    return;
  }
  console.log(
    '\nPaste your bot token: Discord Developer Portal -> your application -> Bot -> Reset Token -> Copy.\n' +
      '(It stays on this computer, in the .env file. Nothing is shown while you paste; press Enter after.)',
  );
  for (let tries = 0; tries < 3; tries++) {
    const token = await ask('Bot token: ', { hidden: true });
    if (!token) break;
    if (!looksLikeToken(token)) {
      console.log(
        'That does not look like a bot token (it should have two dots in it). Try again, or press Enter to skip.',
      );
      continue;
    }
    text = setEnvValue(text, 'DISCORD_TOKEN', token);
    fs.writeFileSync(envPath, text);
    say('saved the token in .env');
    return;
  }
  say('skipped: put your bot token in .env (DISCORD_TOKEN=...) before starting the bot.');
}

async function setup({ interactive = true, quiet = false } = {}) {
  checkNode();
  await ensureEnvFile({ interactive });
  // --include=dev: the TypeScript build needs dev dependencies even if the
  // host's shell has NODE_ENV=production set.
  npm(
    ['ci', '--include=dev', '--no-audit', '--no-fund'],
    'installing (takes a minute or two the first time)',
  );
  npm(['run', 'build'], 'building');
  loadEnv();
  migrate();
  if (quiet) return;
  console.log(
    '\n[bot] Ready. Start the bot with:  npm run bot\n' +
      '      To keep it running in the background and after a reboot, see docs/WITHOUT-DOCKER.md.\n',
  );
}

async function start() {
  checkNode();
  process.chdir(ROOT);
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) {
    say('not built yet, running setup first');
    await setup({ interactive: true, quiet: true });
  } else {
    // Asks for the token if it's still empty (only when someone is at the keyboard).
    await ensureEnvFile({ interactive: true });
    loadEnv();
    migrate();
  }
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
  process.env.CHECKPOINT_DISABLE = '1';

  // Same as docker-entrypoint.sh: keep yt-dlp current for /music. Only with
  // music on, MUSIC_AUTO_UPDATE=false turns it off, and failing never stops the bot.
  // (Only works for yt-dlp's standalone download; a pip/brew/apt install just says so.)
  if (process.env.ENABLE_MUSIC === 'true' && process.env.MUSIC_AUTO_UPDATE !== 'false') {
    say('updating yt-dlp (music)...');
    const r = run('yt-dlp', ['-U'], { timeout: 60_000 });
    if (!r.ok) say('yt-dlp update skipped; using the version already installed');
  }

  say('starting bot...');
  require(path.join(ROOT, 'dist', 'index.js'));
}

async function update() {
  checkNode();
  process.chdir(ROOT);
  const backup = path.join(ROOT, 'dist', 'scripts', 'backup.js');
  loadEnv();
  if (fs.existsSync(backup) && fs.existsSync(path.join(ROOT, 'data', 'bot.db'))) {
    say('backing up the database first...');
    if (!run(process.execPath, [backup]).ok)
      fail('The backup failed, so nothing was updated.', 'See the message above.');
  }
  if (fs.existsSync(path.join(ROOT, '.git'))) {
    say('downloading the new version (git pull)...');
    const r = run('git', ['pull', '--ff-only']);
    if (r.missing)
      fail(
        'git was not found.',
        'Install git, or download the new version as a ZIP (see docs/WITHOUT-DOCKER.md).',
      );
    if (!r.ok) {
      fail(
        'git pull failed (see above).',
        'If you changed files in the bot folder yourself, undo those changes (your .env and data folder are safe), then try again.',
      );
    }
  } else {
    say(
      'not a git checkout: download the new version first (see docs/WITHOUT-DOCKER.md), then this rebuilds it.',
    );
  }
  await setup({ interactive: false, quiet: true });
  say(
    'Updated. Restart the bot to use the new version (pm2 restart discord-mod-bot, or systemctl restart discord-mod-bot).',
  );
}

async function main() {
  const command = process.argv[2];
  if (command === 'setup') return setup();
  if (command === 'start') return start();
  if (command === 'update') return update();
  console.log('Usage: node scripts/local.cjs <setup|start|update>   (see docs/WITHOUT-DOCKER.md)');
  process.exitCode = command ? 1 : 0;
}

// Always runs (no require.main check): under pm2 this file is loaded by pm2's
// own wrapper, so require.main isn't this module.
main().catch((err) => fail(`Unexpected error: ${err && err.stack ? err.stack : err}`));
