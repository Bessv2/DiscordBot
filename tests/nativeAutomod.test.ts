import { describe, expect, it } from 'vitest';
import { AutoModerationActionType, AutoModerationRuleTriggerType } from 'discord.js';
import {
  INVITE_PATTERN,
  RuleInputs,
  desiredRules,
  nativeCovered,
  parseNativeState,
  rulesHash,
} from '../src/automod/native';
import { containsInviteLink } from '../src/automod/invite';

const base: RuleInputs = {
  automodEnabled: true,
  nativeAutomod: true,
  inviteFilterOn: true,
  wordFilterOn: true,
  bannedWords: ['Badword', 'x'.repeat(61), ''],
  mentionSpamLimit: 5,
  modLogChannelId: 'log1',
  exemptRoleIds: ['mods'],
  exempt: { invite: ['c1'], words: [], mentions: ['c2'] },
};

describe("Discord's AutoMod rules", () => {
  it('builds one rule per filter, blocking and alerting the mod-log', () => {
    const r = desiredRules(base);
    expect(Object.keys(r).sort()).toEqual(['invite', 'mentions', 'words']);
    expect(r.invite).toMatchObject({
      name: 'Bot: invite links',
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: [INVITE_PATTERN] },
      exemptRoles: ['mods'],
      exemptChannels: ['c1'],
    });
    expect(r.words?.triggerMetadata).toEqual({ keywordFilter: ['badword'] }); // lowercased; too-long and empty words dropped
    expect(r.mentions).toMatchObject({
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 5 },
      exemptChannels: ['c2'],
    });
    expect(r.invite?.actions?.map((a) => a.type)).toEqual([
      AutoModerationActionType.BlockMessage,
      AutoModerationActionType.SendAlertMessage,
    ]);
  });

  it('has no rules when switched off, or when auto-mod is off', () => {
    expect(desiredRules({ ...base, nativeAutomod: false })).toEqual({});
    expect(desiredRules({ ...base, automodEnabled: false })).toEqual({});
  });

  it('leaves out filters that are off, and the alert without a mod-log', () => {
    const r = desiredRules({
      ...base,
      inviteFilterOn: false,
      wordFilterOn: false,
      modLogChannelId: null,
    });
    expect(Object.keys(r)).toEqual(['mentions']);
    expect(r.mentions?.actions).toHaveLength(1);
    expect(desiredRules({ ...base, bannedWords: [] }).words).toBeUndefined();
  });

  it("respects Discord's limits", () => {
    const r = desiredRules({
      ...base,
      exemptRoleIds: Array.from({ length: 30 }, (_, i) => `r${i}`),
      bannedWords: Array.from({ length: 1200 }, (_, i) => `w${i}`),
    });
    expect(r.invite?.exemptRoles).toHaveLength(20);
    expect((r.words?.triggerMetadata as { keywordFilter: string[] }).keywordFilter).toHaveLength(
      1000,
    );
  });

  it('the invite pattern matches what the bot filter matches', () => {
    const re = new RegExp(INVITE_PATTERN.replace('(?i)', ''), 'i');
    for (const s of [
      'join discord.gg/abc',
      'https://discord.com/invite/xyz-1',
      'DISCORDAPP.COM/INVITE/q',
    ]) {
      expect(re.test(s), s).toBe(true);
      expect(containsInviteLink(s)).toBe(true);
    }
    expect(INVITE_PATTERN.length).toBeLessThanOrEqual(260);
  });

  it('hashes settings stably, so unchanged settings cost no API calls', () => {
    expect(rulesHash(desiredRules(base))).toBe(rulesHash(desiredRules({ ...base })));
    expect(rulesHash(desiredRules(base))).not.toBe(
      rulesHash(desiredRules({ ...base, mentionSpamLimit: 6 })),
    );
  });

  it('only skips the bot filters Discord is actually running', () => {
    expect(
      nativeCovered({
        nativeAutomod: true,
        nativeAutomodState: '{"ids":{"invite":"1","mentions":"2"}}',
      }),
    ).toEqual(new Set(['invite', 'mentions']));
    expect(
      nativeCovered({ nativeAutomod: false, nativeAutomodState: '{"ids":{"invite":"1"}}' }).size,
    ).toBe(0);
    expect(parseNativeState('garbage')).toEqual({ ids: {} });
  });
});
