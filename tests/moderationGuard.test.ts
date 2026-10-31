import { describe, expect, it } from 'vitest';
import { Guild, GuildMember } from 'discord.js';
import { checkModerationHierarchy, evaluateRoleAssignable } from '../src/lib/moderationGuard';

// Discord.js classes are awkward to instantiate directly, so tests build
// minimal plain objects shaped like the real thing and cast them — this
// keeps the hierarchy-check logic itself unit tested without a live client.
function makeMember(id: string, position: number, isAdmin = false): GuildMember {
  return {
    id,
    permissions: { has: (_perm: unknown) => isAdmin },
    roles: { highest: { position } },
  } as unknown as GuildMember;
}

function makeGuild(ownerId: string): Guild {
  return { ownerId } as unknown as Guild;
}

describe('checkModerationHierarchy', () => {
  const guild = makeGuild('owner-1');
  const bot = makeMember('bot-1', 100);

  it('blocks self-moderation', () => {
    const member = makeMember('user-1', 10);
    expect(checkModerationHierarchy(guild, member, member, bot).allowed).toBe(false);
  });

  it('blocks moderating the server owner', () => {
    const invoker = makeMember('mod-1', 50);
    const owner = makeMember('owner-1', 5);
    expect(checkModerationHierarchy(guild, invoker, owner, bot).allowed).toBe(false);
  });

  it('blocks moderating the bot itself', () => {
    const invoker = makeMember('mod-1', 50);
    expect(checkModerationHierarchy(guild, invoker, bot, bot).allowed).toBe(false);
  });

  it('blocks a non-admin invoker targeting someone with an equal or higher role', () => {
    const invoker = makeMember('mod-1', 10);
    const target = makeMember('user-1', 10);
    expect(checkModerationHierarchy(guild, invoker, target, bot).allowed).toBe(false);
  });

  it('allows an administrator to bypass the role-position check', () => {
    const invoker = makeMember('mod-1', 5, true);
    const target = makeMember('user-1', 50);
    expect(checkModerationHierarchy(guild, invoker, target, bot).allowed).toBe(true);
  });

  it("blocks when the bot's own role is not above the target's", () => {
    const invoker = makeMember('mod-1', 50);
    const target = makeMember('user-1', 10);
    const lowBot = makeMember('bot-1', 5);
    expect(checkModerationHierarchy(guild, invoker, target, lowBot).allowed).toBe(false);
  });

  it('allows a normal case: invoker and bot both outrank the target', () => {
    const invoker = makeMember('mod-1', 50);
    const target = makeMember('user-1', 10);
    expect(checkModerationHierarchy(guild, invoker, target, bot).allowed).toBe(true);
  });
});

describe('evaluateRoleAssignable', () => {
  const base = {
    isEveryoneRole: false,
    isManaged: false,
    rolePosition: 5,
    invokerIsOwner: false,
    invokerHighestPosition: 10,
    botHighestPosition: 20,
  };

  it('allows a role below both the invoker and the bot', () => {
    expect(evaluateRoleAssignable(base).allowed).toBe(true);
  });

  it('blocks a role at or above the invoker\'s highest role (self-escalation)', () => {
    expect(evaluateRoleAssignable({ ...base, rolePosition: 10 }).allowed).toBe(false);
    expect(evaluateRoleAssignable({ ...base, rolePosition: 15 }).allowed).toBe(false);
  });

  it('lets the server owner map any role the bot can manage', () => {
    expect(evaluateRoleAssignable({ ...base, rolePosition: 15, invokerIsOwner: true }).allowed).toBe(true);
  });

  it('blocks a role the bot itself cannot assign, even for the owner', () => {
    expect(evaluateRoleAssignable({ ...base, rolePosition: 20, invokerIsOwner: true }).allowed).toBe(false);
  });

  it('blocks @everyone and integration-managed roles', () => {
    expect(evaluateRoleAssignable({ ...base, isEveryoneRole: true }).allowed).toBe(false);
    expect(evaluateRoleAssignable({ ...base, isManaged: true }).allowed).toBe(false);
  });
});
