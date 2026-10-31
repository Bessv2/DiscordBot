import { describe, expect, it } from 'vitest';
import {
  MODULES,
  blockingModule,
  isModuleOn,
  moduleForCommand,
  parseDisabledModules,
} from '../src/lib/modules';

const baseConfig = {
  disabledModules: '[]',
  automodEnabled: false,
  antiRaidEnabled: false,
  welcomeEnabled: false,
  xpEnabled: true,
  economyEnabled: false,
};

describe('parseDisabledModules', () => {
  it('reads a JSON array of IDs', () => {
    expect([...parseDisabledModules('["trivia","maps"]')]).toEqual(['trivia', 'maps']);
  });

  it('treats corrupt or non-array JSON as nothing disabled, never as a crash', () => {
    expect(parseDisabledModules('not json').size).toBe(0);
    expect(parseDisabledModules('{"trivia":true}').size).toBe(0);
    expect(parseDisabledModules(null).size).toBe(0);
  });
});

describe('blockingModule', () => {
  it('blocks every command of a switched-off module', () => {
    expect(blockingModule('jam', '["music"]')?.id).toBe('music');
    expect(blockingModule('music', '["music"]')?.id).toBe('music');
    expect(blockingModule('8ball', '["fun"]')?.id).toBe('fun');
  });

  it('leaves commands of other modules alone', () => {
    expect(blockingModule('trivia', '["music"]')).toBeNull();
  });

  it('never blocks core moderation or setup commands', () => {
    for (const cmd of ['warn', 'kick', 'ban', 'timeout', 'setup', 'config']) {
      expect(blockingModule(cmd, JSON.stringify(MODULES.map((m) => m.id)))).toBeNull();
    }
  });
});

describe('isModuleOn', () => {
  it("reads a 'flag' module from its own column", () => {
    expect(isModuleOn(baseConfig, 'xp')).toBe(true);
    expect(isModuleOn(baseConfig, 'economy')).toBe(false);
  });

  it("treats a 'list' module as on unless it is listed", () => {
    expect(isModuleOn(baseConfig, 'trivia')).toBe(true);
    expect(isModuleOn({ ...baseConfig, disabledModules: '["trivia"]' }, 'trivia')).toBe(false);
  });
});

describe('module registry', () => {
  it('has unique IDs and maps each command to exactly one module', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cmds = MODULES.flatMap((m) => m.commands);
    expect(new Set(cmds).size).toBe(cmds.length);
    for (const c of cmds) expect(moduleForCommand(c)).toBeDefined();
  });

  it('fits in one Discord select menu (max 25 options)', () => {
    expect(MODULES.length).toBeLessThanOrEqual(25);
  });

  it('only names commands that are actually registered', async () => {
    process.env.DISCORD_TOKEN ??= 'test-token';
    const { commands } = await import('../src/commands');
    const registered = new Set(commands.map((c) => c.data.name));
    for (const m of MODULES)
      for (const c of m.commands) expect(registered, `${m.id} → /${c}`).toContain(c);
  });
});
