// HTTP fetches of addresses that server admins type in (RSS feeds). The
// person typing the URL is a Discord admin, not necessarily whoever runs the
// bot, so the bot must not become a way to reach the host's own network
// (router pages, other containers, cloud metadata). Every connection,
// including ones after a redirect, resolves the name and refuses private,
// loopback and link-local addresses at connect time, so DNS tricks can't
// slip past a check done earlier.
import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch } from 'undici';
import { config } from '../config';

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(addr, prefix, 'ipv6');

/** True for addresses that belong to a private or local network. */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    // ::ffff:10.0.0.1 is an IPv4 address in disguise.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped?.[1]) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as dns.LookupAddress[];
    const bad = config.ADDONS_ALLOW_PRIVATE_NETWORK
      ? undefined
      : list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      const e: NodeJS.ErrnoException = new Error(
        `refusing to connect to a private or local address (${hostname})`,
      );
      e.code = 'EPRIVATE';
      return callback(e, '');
    }
    if (options.all) return callback(null, list);
    const first = list[0]!;
    callback(null, first.address, first.family);
  });
}

const agent = new Agent({
  connect: { lookup: safeLookup as never, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

export const MAX_BYTES = 2 * 1024 * 1024;

/** Checks the shape of a URL before any network access. Returns an error message, or null if fine. */
export function checkUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "That isn't a full web address (it should start with https://).";
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    return 'Only http:// and https:// addresses work.';
  if (u.username || u.password)
    return "Addresses with a username or password in them aren't allowed.";
  if (config.ADDONS_ALLOW_PRIVATE_NETWORK) return null;
  if (
    net.isIP(u.hostname.replace(/^\[|\]$/g, '')) &&
    isPrivateAddress(u.hostname.replace(/^\[|\]$/g, ''))
  )
    return "That's a private or local address, which add-ons can't reach.";
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(u.hostname))
    return "That's a local address, which add-ons can't reach.";
  return null;
}

/** GET a public URL and return its body as text (at most 2 MB). Throws with a readable message on failure. */
export async function safeGetText(url: string, accept = '*/*'): Promise<string> {
  const problem = checkUrl(url);
  if (problem) throw new Error(problem);
  const res = await fetch(url, {
    dispatcher: agent,
    headers: { accept, 'user-agent': 'self-hosted-discord-bot (add-ons)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`the site answered ${res.status} ${res.statusText}`);
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error('the response is larger than 2 MB');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
