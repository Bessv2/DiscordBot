import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { validatePlugin } from '../src/plugins/loader';

const example: unknown = createRequire(__filename)(path.resolve(__dirname, '..', 'docs', 'plugins', 'dice-duel.js'));
const cmd = (name: string) => ({
  data: { name, toJSON: () => ({ name }) },
  execute: () => undefined,
});

describe('plugins', () => {
  it('accepts the documented example', () => {
    expect(validatePlugin(example, new Set(['warn', 'ban']))).toEqual([]);
  });
  it('explains what is wrong with a broken plugin', () => {
    expect(validatePlugin(null, new Set())).toEqual([
      expect.stringMatching(/must export an object/),
    ]);
    expect(validatePlugin({ name: 'Bad Name!' }, new Set()).join()).toMatch(/"name"/);
    expect(validatePlugin({ name: 'p', onMessage: 'nope' }, new Set()).join()).toMatch(/onMessage/);
    expect(
      validatePlugin({ name: 'p', commands: [{ data: {}, execute() {} }] }, new Set()).join(),
    ).toMatch(/SlashCommandBuilder/);
    expect(
      validatePlugin({ name: 'p', commands: [{ ...cmd('x'), execute: 1 }] }, new Set()).join(),
    ).toMatch(/execute/);
    expect(
      validatePlugin({ name: 'p', commands: [{ ...cmd('x'), scope: 'root' }] }, new Set()).join(),
    ).toMatch(/scope/);
  });
  it("can't take over a built-in command or repeat a name", () => {
    expect(validatePlugin({ name: 'p', commands: [cmd('ban')] }, new Set(['ban'])).join()).toMatch(
      /already exists/,
    );
    expect(validatePlugin({ name: 'p', commands: [cmd('x'), cmd('x')] }, new Set()).join()).toMatch(
      /already exists/,
    );
  });
});
