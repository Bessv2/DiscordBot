// Plugins: a host can add their own commands without forking the bot, by
// dropping .js files in the plugins folder (./plugins, mounted into the
// container by docker-compose.yml) and setting ENABLE_PLUGINS=true.
//
// A plugin is ordinary code running inside the bot, with the same access
// as the bot itself (its token, its database). That's why this is off by
// default, only reads files the host put there, and is not a marketplace:
// install only plugins you've read or trust. See docs/PLUGINS.md.
//
// Each plugin's commands belong to the "Plugins" module, so any server can
// switch them all off from /setup.
import fs from 'node:fs';
import path from 'node:path';
import { ChatInputCommandInteraction, Client, Message, PermissionResolvable } from 'discord.js';
import { config } from '../config';
import { logger } from '../lib/logger';
import { commands } from '../commands';
import { Command, SlashCommandData } from '../commands/types';
import { CommandScope } from '../lib/permissions';
import { registerModuleCommand } from '../lib/modules';

export interface PluginContext {
  client: Client;
  /** A folder this plugin may keep its own files in (inside the bot's data folder). */
  dataDir: string;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export interface PluginCommand {
  data: { name: string; toJSON(): unknown };
  /** Who may run it: 'utility' (everyone, default), 'moderation' or 'admin', same gates as built-in commands. */
  scope?: CommandScope;
  /** Discord permission needed when a server hasn't picked roles for that scope. */
  permission?: PermissionResolvable | null;
  execute(interaction: ChatInputCommandInteraction, ctx: PluginContext): Promise<unknown> | unknown;
}

export interface Plugin {
  name: string;
  version?: string;
  commands?: PluginCommand[];
  onReady?(ctx: PluginContext): Promise<unknown> | unknown;
  onMessage?(message: Message<true>, ctx: PluginContext): Promise<unknown> | unknown;
}

interface Loaded {
  plugin: Plugin;
  ctx: PluginContext;
}

const loaded: Loaded[] = [];

export function pluginsDir(): string {
  return config.PLUGINS_DIR ?? path.resolve(__dirname, '..', '..', 'plugins');
}

/** Checks a plugin's shape. Returns problems in plain English (empty = fine). Pure, so it's unit tested. */
export function validatePlugin(p: unknown, takenNames: Set<string>): string[] {
  const problems: string[] = [];
  if (!p || typeof p !== 'object')
    return ['it must export an object (module.exports = { name, commands, ... })'];
  const plugin = p as Partial<Plugin>;
  if (typeof plugin.name !== 'string' || !/^[a-z0-9-]{1,32}$/.test(plugin.name))
    problems.push('"name" must be 1-32 lowercase letters, numbers or dashes');
  for (const hook of ['onReady', 'onMessage'] as const) {
    if (plugin[hook] !== undefined && typeof plugin[hook] !== 'function')
      problems.push(`"${hook}" must be a function`);
  }
  if (plugin.commands !== undefined && !Array.isArray(plugin.commands))
    problems.push('"commands" must be an array');
  const names = new Set<string>();
  for (const [i, c] of (Array.isArray(plugin.commands) ? plugin.commands : []).entries()) {
    const name = (c as PluginCommand)?.data?.name;
    if (typeof name !== 'string' || typeof (c as PluginCommand).data?.toJSON !== 'function') {
      problems.push(`command #${i + 1}: "data" must be a SlashCommandBuilder from discord.js`);
      continue;
    }
    if (typeof (c as PluginCommand).execute !== 'function')
      problems.push(`/${name}: "execute" must be a function`);
    if (takenNames.has(name) || names.has(name))
      problems.push(`/${name}: a command with that name already exists`);
    const scope = (c as PluginCommand).scope;
    if (scope !== undefined && !['utility', 'moderation', 'admin'].includes(scope))
      problems.push(`/${name}: "scope" must be utility, moderation or admin`);
    names.add(name);
  }
  return problems;
}

function contextFor(client: Client, name: string): PluginContext {
  const dataDir = path.resolve(__dirname, '..', '..', 'data', 'plugins', name);
  const tag = `[plugin ${name}]`;
  return {
    client,
    dataDir,
    log: {
      info: (m) => logger.info(`${tag} ${m}`),
      warn: (m) => logger.warn(`${tag} ${m}`),
      error: (m) => logger.error(`${tag} ${m}`),
    },
  };
}

/**
 * Loads every plugin file. Called once at startup, before commands are
 * registered with Discord. A broken plugin is skipped with a clear log
 * line; it never stops the bot from starting.
 */
export function loadPlugins(client: Client): number {
  if (!config.ENABLE_PLUGINS) return 0;
  const dir = pluginsDir();
  if (!fs.existsSync(dir)) {
    logger.warn(
      `ENABLE_PLUGINS is on, but there's no plugins folder at ${dir}.`,
      'Create it and put plugin .js files in it (docs/PLUGINS.md), or set ENABLE_PLUGINS=false.',
    );
    return 0;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(c?js)$/.test(f))
    .sort();
  for (const file of files) {
    const full = path.join(dir, file);
    let mod: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require(full);
    } catch (err) {
      const missing = /Cannot find module '([^']+)'/.exec((err as Error).message)?.[1];
      logger.warn(
        `Plugin ${file} failed to load: ${(err as Error).message.split('\n')[0]}`,
        missing && !missing.startsWith('.')
          ? `Plugins can use the packages the bot already has (like discord.js) only when the plugins folder is inside the bot's folder, as ./plugins is. Move it there, or bundle "${missing}" with the plugin. The bot runs without it.`
          : 'Fix the error in that file (or remove it) and restart. The bot runs without it.',
      );
      continue;
    }
    const plugin = ((mod as { default?: unknown })?.default ?? mod) as Plugin;
    const taken = new Set(commands.map((c) => c.data.name));
    const problems = validatePlugin(plugin, taken);
    if (loaded.some((l) => l.plugin.name === plugin?.name))
      problems.push(`another plugin is already called "${plugin.name}"`);
    if (problems.length) {
      logger.warn(
        `Plugin ${file} was skipped: ${problems.join('; ')}.`,
        'See docs/PLUGINS.md for the shape a plugin needs. The bot runs without it.',
      );
      continue;
    }
    const ctx = contextFor(client, plugin.name);
    for (const pc of plugin.commands ?? []) {
      const command: Command = {
        data: pc.data as unknown as SlashCommandData,
        scope: pc.scope ?? 'utility',
        nativePermission: pc.permission ?? null,
        execute: async (interaction) => {
          await pc.execute(interaction, ctx);
        },
      };
      commands.push(command);
      registerModuleCommand('plugins', pc.data.name);
    }
    loaded.push({ plugin, ctx });
    logger.info(
      `Plugin loaded: ${plugin.name}${plugin.version ? ` ${plugin.version}` : ''} (${(plugin.commands ?? []).map((c) => `/${c.data.name}`).join(', ') || 'no commands'}).`,
    );
  }
  return loaded.length;
}

export function loadedPlugins(): string[] {
  return loaded.map((l) => l.plugin.name);
}

export async function pluginsReady(): Promise<void> {
  for (const { plugin, ctx } of loaded) {
    if (!plugin.onReady) continue;
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    await Promise.resolve(plugin.onReady(ctx)).catch((err: Error) =>
      ctx.log.error(`onReady failed: ${err.message}`),
    );
  }
}

export async function pluginsOnMessage(message: Message<true>, moduleOn: boolean): Promise<void> {
  if (!moduleOn) return;
  for (const { plugin, ctx } of loaded) {
    if (!plugin.onMessage) continue;
    await Promise.resolve(plugin.onMessage(message, ctx)).catch((err: Error) =>
      ctx.log.error(`onMessage failed: ${err.message}`),
    );
  }
}
