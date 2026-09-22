import { Command } from './types';
import { warnCommand } from './moderation/warn';
import { kickCommand } from './moderation/kick';
import { banCommand } from './moderation/ban';
import { timeoutCommand } from './moderation/timeout';
import { casesCommand } from './moderation/cases';
import { userinfoCommand } from './utility/userinfo';
import { serverinfoCommand } from './utility/serverinfo';
import { remindCommand } from './utility/remind';
import { pollCommand } from './utility/poll';
import { setupCommand } from './setup/setup';
import { configCommand } from './setup/config';

// One command = one file/module (section 8) — this is the only place they
// get wired together, for both live command dispatch and `deploy-commands`.
export const commands: Command[] = [
  warnCommand,
  kickCommand,
  banCommand,
  timeoutCommand,
  casesCommand,
  userinfoCommand,
  serverinfoCommand,
  remindCommand,
  pollCommand,
  setupCommand,
  configCommand,
];
