import { describe, expect, it } from 'vitest';
import { matchesActivityPattern, rolesToAssign } from '../src/lib/activityRoles';

describe('matchesActivityPattern', () => {
  it('matches case-insensitively as a substring', () => {
    expect(matchesActivityPattern('Minecraft', 'minecraft')).toBe(true);
    expect(matchesActivityPattern('Counter-Strike 2', 'counter-strike')).toBe(true);
  });

  it('does not match unrelated activities', () => {
    expect(matchesActivityPattern('Spotify', 'minecraft')).toBe(false);
  });
});

describe('rolesToAssign', () => {
  const mappings = [
    { pattern: 'minecraft', roleId: 'role-mc' },
    { pattern: 'valorant', roleId: 'role-val' },
  ];

  it('returns roles for every matching mapping', () => {
    const result = rolesToAssign(['Minecraft'], mappings);
    expect(result.has('role-mc')).toBe(true);
    expect(result.has('role-val')).toBe(false);
  });

  it('returns an empty set when nothing matches', () => {
    const result = rolesToAssign(['Spotify'], mappings);
    expect(result.size).toBe(0);
  });

  it('matches multiple simultaneous activities', () => {
    const result = rolesToAssign(['Minecraft', 'Valorant'], mappings);
    expect(result.size).toBe(2);
  });
});
