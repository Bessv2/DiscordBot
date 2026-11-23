import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The launcher (scripts/local.cjs) is plain CommonJS so it runs before
// node_modules exists; its pure parts live in local-helpers.cjs.
const helpers = createRequire(__filename)('../scripts/local-helpers.cjs') as {
  nodeVersionOk: (v: string) => boolean;
  readEnvValue: (text: string, key: string) => string;
  setEnvValue: (text: string, key: string, value: string) => string;
  looksLikeToken: (v: string) => boolean;
};
const { nodeVersionOk, readEnvValue, setEnvValue, looksLikeToken } = helpers;

describe('nodeVersionOk', () => {
  it('accepts 22.12 and newer', () => {
    expect(nodeVersionOk('v22.12.0')).toBe(true);
    expect(nodeVersionOk('22.23.5')).toBe(true);
    expect(nodeVersionOk('v24.0.0')).toBe(true);
  });

  it('refuses older versions', () => {
    expect(nodeVersionOk('v22.11.9')).toBe(false);
    expect(nodeVersionOk('v20.18.0')).toBe(false);
    expect(nodeVersionOk('v18.20.4')).toBe(false);
  });
});

describe('readEnvValue', () => {
  const env =
    'DISCORD_TOKEN=\nPREFIX="!"\nLOG_LEVEL=debug # chatty\n  DASHBOARD_PORT = 3000\r\n# ENABLE_MUSIC=true\n';

  it('reads plain, quoted, commented and spaced values', () => {
    expect(readEnvValue(env, 'PREFIX')).toBe('!');
    expect(readEnvValue(env, 'LOG_LEVEL')).toBe('debug');
    expect(readEnvValue(env, 'DASHBOARD_PORT')).toBe('3000');
  });

  it('treats blank, missing and commented-out keys as empty', () => {
    expect(readEnvValue(env, 'DISCORD_TOKEN')).toBe('');
    expect(readEnvValue(env, 'ENABLE_MUSIC')).toBe('');
    expect(readEnvValue(env, 'NOPE')).toBe('');
  });

  it('does not match a key that only ends with the name', () => {
    expect(readEnvValue('MY_DISCORD_TOKEN=x\n', 'DISCORD_TOKEN')).toBe('');
  });
});

describe('setEnvValue', () => {
  it('replaces the existing line and leaves the rest alone', () => {
    const text = '# token\nDISCORD_TOKEN=\n\nPREFIX=!\n';
    expect(setEnvValue(text, 'DISCORD_TOKEN', 'abc')).toBe(
      '# token\nDISCORD_TOKEN=abc\n\nPREFIX=!\n',
    );
  });

  it('keeps Windows line endings', () => {
    expect(setEnvValue('A=1\r\nDISCORD_TOKEN=\r\n', 'DISCORD_TOKEN', 'x')).toBe(
      'A=1\r\nDISCORD_TOKEN=x\r\n',
    );
  });

  it('appends when the key is missing', () => {
    expect(setEnvValue('A=1', 'DISCORD_TOKEN', 'x')).toBe('A=1\nDISCORD_TOKEN=x\n');
    expect(setEnvValue('', 'DISCORD_TOKEN', 'x')).toBe('DISCORD_TOKEN=x\n');
  });

  it('writes $ characters literally', () => {
    expect(setEnvValue('K=\n', 'K', 'a$&b')).toBe('K=a$&b\n');
  });
});

describe('looksLikeToken', () => {
  it('accepts the three-part bot token shape', () => {
    // Built here rather than written out, so GitHub's secret scanning
    // doesn't mistake a made-up token for a leaked one.
    const fake = ['A'.repeat(24), 'B'.repeat(6), 'C'.repeat(38)].join('.');
    expect(looksLikeToken(fake)).toBe(true);
  });

  it('refuses a client secret or a client ID', () => {
    expect(looksLikeToken('aBcDeFgHiJkLmNoPqRsTuVwXyZ012345')).toBe(false);
    expect(looksLikeToken('123456789012345678')).toBe(false);
  });
});
