import { describe, expect, it } from 'vitest';
import {
  HostFacts,
  StatusConfig,
  featureMapFields,
  featureStatuses,
  parseIntInRange,
  parseYesNo,
} from '../src/setup/status';
import { MODULES } from '../src/lib/modules';

const gc: StatusConfig = {
  modLogChannelId: null,
  appealChannelId: null,
  disabledModules: '[]',
  automodEnabled: false,
  inviteFilterOn: false,
  wordFilterOn: false,
  antiRaidEnabled: false,
  welcomeEnabled: false,
  welcomeChannelId: null,
  xpEnabled: false,
  economyEnabled: false,
  starboardChannelId: null,
  birthdayChannelId: null,
};
const host: HostFacts = {
  messageContent: false,
  guildMembers: false,
  presence: false,
  music: false,
  twitchOrYoutube: false,
  steamOrRiot: false,
  modRoleCount: 0,
  adminRoleCount: 0,
};
const byId = (cfg: StatusConfig, h: HostFacts = host) =>
  new Map(featureStatuses(cfg, h).map((s) => [s.id, s]));

describe('featureStatuses', () => {
  it('lists the three essentials plus every module, which fits one select menu', () => {
    const all = featureStatuses(gc, host);
    expect(all).toHaveLength(MODULES.length + 3);
    expect(all.length).toBeLessThanOrEqual(25);
  });

  it('flags a missing mod-log channel as needing attention', () => {
    expect(byId(gc).get('modlog')!.state).toBe('needs');
    expect(byId({ ...gc, modLogChannelId: '1' }).get('modlog')!.state).toBe('on');
  });

  it('shows switched-off modules as off', () => {
    expect(byId({ ...gc, disabledModules: '["trivia"]' }).get('trivia')!.state).toBe('off');
    expect(byId(gc).get('xp')!.state).toBe('off');
  });

  it("warns when a feature is on but the host hasn't enabled the intent it needs", () => {
    expect(byId({ ...gc, antiRaidEnabled: true }).get('antiraid')!.state).toBe('needs');
    expect(
      byId({ ...gc, antiRaidEnabled: true }, { ...host, guildMembers: true }).get('antiraid')!
        .state,
    ).toBe('on');
    expect(byId({ ...gc, automodEnabled: true, wordFilterOn: true }).get('automod')!.state).toBe(
      'needs',
    );
    expect(byId({ ...gc, automodEnabled: true }).get('automod')!.state).toBe('on');
  });

  it('asks for a channel where the feature has nowhere to post', () => {
    expect(byId(gc).get('starboard')!.state).toBe('needs');
    expect(byId({ ...gc, starboardChannelId: '5' }).get('starboard')!.state).toBe('on');
    expect(
      byId({ ...gc, welcomeEnabled: true }, { ...host, guildMembers: true }).get('welcome')!.state,
    ).toBe('needs');
  });

  it('keeps every map section within the 1024-character embed field limit', () => {
    for (const f of featureMapFields(featureStatuses(gc, host)))
      expect(f.value.length).toBeLessThanOrEqual(1024);
  });
});

describe('parseIntInRange', () => {
  it('accepts whole numbers in range only', () => {
    expect(parseIntInRange(' 5 ', 1, 10)).toBe(5);
    expect(parseIntInRange('0', 1, 10)).toBeNull();
    expect(parseIntInRange('11', 1, 10)).toBeNull();
    expect(parseIntInRange('2.5', 1, 10)).toBeNull();
    expect(parseIntInRange('five', 1, 10)).toBeNull();
    expect(parseIntInRange('', 1, 10)).toBeNull();
  });
});

describe('parseYesNo', () => {
  it('understands common yes/no answers', () => {
    expect(parseYesNo('Yes')).toBe(true);
    expect(parseYesNo('off')).toBe(false);
    expect(parseYesNo('maybe')).toBeNull();
  });
});
