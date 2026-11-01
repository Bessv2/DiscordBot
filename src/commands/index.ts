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
import { welcomeCommand } from './setup/welcome';
import { birthdayCommand } from './fun/birthday';
import { gameserverCommand } from './fun/gameserver';
import { gamestatsCommand } from './fun/gamestats';
import { streamwatchCommand } from './fun/streamwatch';
import { activityroleCommand } from './fun/activityrole';
import { lfgCommand } from './fun/lfg';
import { tournamentCommand } from './fun/tournament';
import { mapCommand } from './fun/map';
import { jamCommand } from './fun/jam';
import { musicCommand } from './fun/music';
import { purgeCommand } from './moderation/purge';
import { slowmodeCommand } from './moderation/slowmode';
import { lockCommand, unlockCommand } from './moderation/lock';
import { unbanCommand } from './moderation/unban';
import { roleCommand } from './moderation/role';
import { helpCommand } from './utility/help';
import { dashboardCommand } from './setup/dashboard';
import { ticketCommand } from './community/ticket';
import { giveawayCommand } from './community/giveaway';
import { suggestCommand, suggestionCommand } from './community/suggest';
import { autoresponderCommand } from './community/autoresponder';
import { announceCommand } from './community/announce';
import { voiceCommand } from './community/voice';

// One command = one file/module (section 8) — this is the only place they
// get wired together, for live command dispatch and for registering the
// commands with Discord (commandSync.ts on startup, or `deploy-commands`).
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
  welcomeCommand,
  birthdayCommand,
  gameserverCommand,
  gamestatsCommand,
  streamwatchCommand,
  activityroleCommand,
  lfgCommand,
  tournamentCommand,
  mapCommand,
  jamCommand,
  musicCommand,
  purgeCommand,
  slowmodeCommand,
  lockCommand,
  unlockCommand,
  unbanCommand,
  roleCommand,
  helpCommand,
  dashboardCommand,
  ticketCommand,
  giveawayCommand,
  suggestCommand,
  suggestionCommand,
  autoresponderCommand,
  announceCommand,
  voiceCommand,
];
