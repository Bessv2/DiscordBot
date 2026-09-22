import { config } from '../config';

// A self-hoster reading these logs is almost never the person who wrote
// this code — so every warn/error accepts an optional `fix` string and
// prints it as a clearly-labelled next step, not just a stack trace.
const levels = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof levels)[number];

const minLevelIndex = levels.indexOf(config.LOG_LEVEL);

function write(level: Level, message: string, fix?: string): void {
  if (levels.indexOf(level) < minLevelIndex) return;
  const timestamp = new Date().toISOString();
  const line = `${timestamp} [${level.toUpperCase()}] ${message}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(line);
  if (fix) {
    out(`${' '.repeat(timestamp.length + 3)}-> Fix: ${fix}`);
  }
}

export const logger = {
  debug: (message: string) => write('debug', message),
  info: (message: string) => write('info', message),
  warn: (message: string, fix?: string) => write('warn', message, fix),
  error: (message: string, fix?: string) => write('error', message, fix),
};
