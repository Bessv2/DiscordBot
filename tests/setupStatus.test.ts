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
  nativeAutomod: false,
  nativeAutomodState: '{}',
  inviteFilterOn: false,
  wordFilterOn: false,
  antiRaidEnabled: false,
  welcomeEnabled: false,
  welcomeChannelId: null,
  xpEnabled: false,
  economyEnabled: false,
  starboardChannelId: null,
  birthdayChannelId: null,
  prefixCommandsOn: false,
  serverLogChannelId: null,
  ticketStaffRoleId: null,
  suggestionChannelId: null,
  joinRoleIds: '[]',
  verifyRoleId: null,
  tempVoiceHubId: null,
};
const host: HostFacts = {
  messageContent: false,
  guildMembers: false,
  presence: false,
  music: false,
  twitchOrYoutube: false,
  steamOrRiot: false,
  prefixCommands: false,
  modRoleCount: 0,
  adminRoleCount: 0,
};
const byId = (cfg: StatusConfig, h: HostFacts = host) =>
  new Map(featureStatuses(cfg, h).map((s) => [s.id, s]));

describe('featureStatuses', () => {
  it('lists the three essentials plus every module, at most 25 per menu group', () => {
    const all = featureStatuses(gc, host);
    expect(all).toHaveLength(MODULES.length + 3);
    for (const g of ['Moderation', 'Community', 'Games & fun'])
      expect(all.filter((s) => s.group === g).length).toBeLessThanOrEqual(25);
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

  it('marks features with nowhere to post as "not set up yet", not as a problem', () => {
    expect(byId(gc).get('starboard')!.state).toBe('idle');
    expect(byId(gc).get('serverlog')!.state).toBe('idle');
    expect(byId(gc).get('tempvoice')!.state).toBe('idle');
    expect(byId({ ...gc, serverLogChannelId: '9' }).get('serverlog')!.state).toBe('on');
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

describe('new modules', () => {
  it('legacy ! commands need both host switches', () => {
    const on = { ...gc, prefixCommandsOn: true };
    expect(byId(on).get('prefix')!.state).toBe('needs');
    expect(
      byId(on, { ...host, prefixCommands: true, messageContent: true }).get('prefix')!.state,
    ).toBe('on');
    expect(byId(gc).get('prefix')!.state).toBe('off');
  });

  it('join roles warn without Server Members, but the Verify button alone is fine', () => {
    expect(byId({ ...gc, joinRoleIds: '["1"]' }).get('joinroles')!.state).toBe('needs');
    expect(byId({ ...gc, verifyRoleId: '2' }).get('joinroles')!.state).toBe('on');
    expect(byId(gc).get('joinroles')!.state).toBe('idle');
  });

  it('auto-responders need Message Content', () => {
    expect(byId(gc).get('autoresponders')!.state).toBe('needs');
    expect(byId(gc, { ...host, messageContent: true }).get('autoresponders')!.state).toBe('on');
  });

  it('splits a long group across fields instead of cutting it off', () => {
    const fields = featureMapFields(featureStatuses(gc, host));
    const shown = fields
      .map((f) => f.value)
      .join('\n')
      .split('\n').length;
    expect(shown).toBe(MODULES.length + 3);
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
