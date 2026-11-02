import { randomBytes, timingSafeEqual } from 'node:crypto';

// Sign-in without passwords or a Discord OAuth app: an admin runs
// /dashboard in Discord and gets a link with a one-time token. Opening it
// starts a session for that person and that server only. Everything lives in
// memory: a restart signs everyone out, which costs a /dashboard and keeps
// nothing secret on disk.

export const LOGIN_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 12 * 60 * 60_000;
const MAX_PENDING = 1000; // bounds memory if someone spams /dashboard

export interface Session {
  id: string;
  userId: string;
  guildId: string;
  /** Sent with every form and checked on every POST. */
  csrf: string;
  expiresAt: number;
}

const pending = new Map<string, { userId: string; guildId: string; expiresAt: number }>();
const sessions = new Map<string, Session>();

const token = () => randomBytes(32).toString('base64url');

export function createLoginToken(userId: string, guildId: string, now = Date.now()): string {
  sweep(now);
  if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
  const t = token();
  pending.set(t, { userId, guildId, expiresAt: now + LOGIN_TTL_MS });
  return t;
}

/** Single use: a token works once, within its lifetime, and is gone after. */
export function redeemLoginToken(t: string, now = Date.now()): Session | null {
  const p = pending.get(t);
  pending.delete(t);
  if (!p || p.expiresAt < now) return null;
  const s: Session = {
    id: token(),
    userId: p.userId,
    guildId: p.guildId,
    csrf: token(),
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: string | undefined, now = Date.now()): Session | null {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expiresAt < now) {
    sessions.delete(id);
    return null;
  }
  return s;
}

export function destroySession(id: string | undefined): void {
  if (id) sessions.delete(id);
}

/** Constant-time compare, so the CSRF check doesn't leak how much matched. */
export function safeEqual(a: string | undefined, b: string): boolean {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sweep(now = Date.now()): void {
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
  for (const [k, v] of sessions) if (v.expiresAt < now) sessions.delete(k);
}

/** Reads one cookie from a Cookie header without pulling in a parser. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
