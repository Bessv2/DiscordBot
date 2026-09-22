import { describe, expect, it } from 'vitest';
import { evaluatePermission } from '../src/lib/permissions';

describe('evaluatePermission', () => {
  it('always allows administrators, regardless of configured roles', () => {
    expect(
      evaluatePermission({
        isAdministrator: true,
        configuredRoleIds: ['mod-role'],
        memberRoleIds: ['some-other-role'],
        hasNativePermission: false,
      }),
    ).toBe(true);
  });

  it('falls back to native Discord permission when no roles are configured', () => {
    expect(
      evaluatePermission({
        isAdministrator: false,
        configuredRoleIds: [],
        memberRoleIds: ['random-role'],
        hasNativePermission: true,
      }),
    ).toBe(true);

    expect(
      evaluatePermission({
        isAdministrator: false,
        configuredRoleIds: [],
        memberRoleIds: ['random-role'],
        hasNativePermission: false,
      }),
    ).toBe(false);
  });

  it('open commands (hasNativePermission null) are allowed with no configured roles', () => {
    expect(
      evaluatePermission({
        isAdministrator: false,
        configuredRoleIds: [],
        memberRoleIds: [],
        hasNativePermission: null,
      }),
    ).toBe(true);
  });

  it('requires a configured role when the scope has one set, even with native permission', () => {
    expect(
      evaluatePermission({
        isAdministrator: false,
        configuredRoleIds: ['trial-mod'],
        memberRoleIds: ['some-other-role'],
        hasNativePermission: true, // has Discord's Ban Members etc., but not the configured role
      }),
    ).toBe(false);
  });

  it('allows a member holding one of the configured roles, even without native permission', () => {
    expect(
      evaluatePermission({
        isAdministrator: false,
        configuredRoleIds: ['trial-mod'],
        memberRoleIds: ['trial-mod', 'member'],
        hasNativePermission: false,
      }),
    ).toBe(true);
  });
});
