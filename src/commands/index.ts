import { Command } from './types';
import { warnCommand } from './moderation/warn';
import { kickCommand } from './moderation/kick';
import { banCommand } from './moderation/ban';
import { timeoutCommand } from './moderation/timeout';
import { muteCommand } from './moderation/mute';
import { unmuteCommand } from './moderation/unmute';
import { casesCommand } from './moderation/cases';
import { userinfoCommand } from './utility/userinfo';
import { serverinfoCommand } from './utility/serverinfo';
import { remindCommand } from './utility/remind';
import { pollCommand } from './utility/poll';
import { setupCommand } from './setup/setup';
import { configCommand } from './setup/config';
import { lockdownCommand } from './setup/lockdown';
import { xpCommand } from './setup/xp';
import { tagCommand } from './fun/tag';
import { rollCommand } from './fun/roll';
import { coinflipCommand } from './fun/coinflip';
import { eightballCommand } from './fun/eightball';
import { quoteCommand } from './fun/quote';
import { reactionroleCommand } from './fun/reactionrole';
import { starboardCommand } from './fun/starboard';
import { rankCommand } from './fun/rank';
import { leaderboardCommand } from './fun/leaderboard';
import { economyCommand } from './fun/economy';
import { triviaCommand } from './fun/trivia';

// One command = one file/module (section 8) — this is the only place they
// get wired together, for both live command dispatch and `deploy-commands`.
export const commands: Command[] = [
  warnCommand,
  kickCommand,
  banCommand,
  timeoutCommand,
  muteCommand,
  unmuteCommand,
  casesCommand,
  userinfoCommand,
  serverinfoCommand,
  remindCommand,
  pollCommand,
  setupCommand,
  configCommand,
  lockdownCommand,
  xpCommand,
  tagCommand,
  rollCommand,
  coinflipCommand,
  eightballCommand,
  quoteCommand,
  reactionroleCommand,
  starboardCommand,
  rankCommand,
  leaderboardCommand,
  economyCommand,
  triviaCommand,
];
