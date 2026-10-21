// GET /api/storybook?url=<storybook base>: reads a deployed Storybook's index for the Studio quick start. No GitHub
// token, no cookie, nothing stored or logged.
//
// Why a server piece: most hosts let the browser read index.json directly (Vercel, GitHub Pages and Chromatic send
// CORS headers), but Netlify does not by default, and only a server can read whether iframe.html may be embedded
// (X-Frame-Options and CSP frame-ancestors are not readable from another origin). The Studio calls this first and
// falls back to a direct read when it is unreachable.
//
// It is a fetcher of untrusted URLs, so it is guarded against SSRF:
//   - https on port 443 only, no user info, the hostname a DNS name (no IP literals);
//   - every address the name resolves to must be public (no private, loopback, link-local, CGNAT, multicast,
//     reserved, documentation or ULA ranges, IPv4-mapped and NAT64 forms checked too), and the connection goes to
//     that vetted address (no second lookup between the check and the connect);
//   - only three files under the given path: index.json, stories.json (the answer) and iframe.html (headers only);
//   - at most 3 redirects, each one checked again and still ending in the same file name;
//   - 5 s per request, 5 MB cap on the body, JSON required; no cookies or credentials sent, nothing forwarded from
//     the caller's request.
// Answer: 200 { base, source, index, frame: 'allowed' | 'blocked' | 'unknown' }, cached 5 minutes at the edge, or
// an error { error, message } with 400 (address refused), 404 (no index), 413, 502 or 504.
// Self-contained on purpose (node built-ins only), so Vercel bundles it as is.

import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

export const MAX_BYTES = 5 * 1024 * 1024;
export const TIMEOUT_MS = 5000;
export const MAX_REDIRECTS = 3;
const INDEX_FILES = ['index.json', 'stories.json'] as const;
type IndexFile = (typeof INDEX_FILES)[number];

// ---------------------------------------------------------------------------------------------------------------
// Addresses

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv6');

/** The IPv4 address carried inside an IPv6 one (mapped ::ffff:a.b.c.d, NAT64 64:ff9b::/96, compatible ::a.b.c.d). */
function embeddedV4(addr: string): string | null {
  const a = addr.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::|::)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (dotted) return dotted[1]!;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** True for an address on the public internet. Anything unparsable is not. */
export function isPublicAddress(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) return !BLOCKED.check(addr, 'ipv4');
  if (v === 6) {
    const v4 = embeddedV4(addr);
    if (v4) return isIP(v4) === 4 && !BLOCKED.check(v4, 'ipv4');
    if (/^64:ff9b:/i.test(addr)) return false;
    return !BLOCKED.check(addr, 'ipv6');
  }
  return false;
}

export type RefusedReason = 'invalid-url' | 'blocked';

/**
 * The Storybook base this proxy accepts, or why not. Same normalisation as core's normalizeStorybookUrl (query,
 * hash, a trailing index.html / iframe.html / index.json / stories.json and slashes dropped), stricter on the rest.
 */
export function checkStorybookUrl(input: string): { ok: true; url: URL } | { ok: false; reason: RefusedReason; message: string } {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return { ok: false, reason: 'invalid-url', message: 'Enter the full Storybook address, for example https://storybook.example.com' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'invalid-url', message: 'The Storybook address must start with https://' };
  if (u.username || u.password) return { ok: false, reason: 'invalid-url', message: 'Remove the user name and password from the address.' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'blocked', message: 'Bridge reads Storybooks on the standard https port only.' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/.test(host)) {
    return { ok: false, reason: 'blocked', message: 'Bridge reads Storybooks published on the internet. A local or private address works only from your own browser.' };
  }
  const path = u.pathname.replace(/\/(index\.html|iframe\.html|index\.json|stories\.json)$/i, '/').replace(/\/+$/, '');
  return { ok: true, url: new URL(`https://${host}${path}/`) };
}

// ---------------------------------------------------------------------------------------------------------------
// Fetching through vetted addresses

export interface Upstream {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** Reads the body up to `max` bytes; rejects with 'too-large' past it. */
  body(max: number): Promise<string>;
  /** Drops the body without reading it. */
  discard(): void;
}

export interface ProxyDeps {
  /** Every address of a host name. */
  lookup(host: string): Promise<{ address: string; family: number }[]>;
  /** One request to `url`, connecting to `address` (TLS still checks the certificate against the host name). */
  request(url: URL, address: { address: string; family: number }, method: 'GET' | 'HEAD', signal: AbortSignal): Promise<Upstream>;
}

class ProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function vetted(deps: ProxyDeps, host: string): Promise<{ address: string; family: number }> {
  let addrs: { address: string; family: number }[];
  try {
    addrs = await deps.lookup(host);
  } catch {
    throw new ProxyError(404, 'not-found', `${host} does not resolve. Check the address.`);
  }
  if (!addrs.length) throw new ProxyError(404, 'not-found', `${host} does not resolve. Check the address.`);
  if (addrs.some((a) => !isPublicAddress(a.address))) {
    throw new ProxyError(400, 'blocked', 'This address points to a private network. Bridge reads Storybooks published on the internet.');
  }
  return addrs[0]!;
}

const header = (h: Upstream['headers'], name: string): string => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v.join(', ') : (v ?? '');
};

/** One file, following at most MAX_REDIRECTS redirects that stay on https, public and on the same file name. */
async function fetchFile(deps: ProxyDeps, start: URL, file: string, method: 'GET' | 'HEAD'): Promise<{ res: Upstream; url: URL }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    const addr = await vetted(deps, url.hostname);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res: Upstream;
    try {
      res = await deps.request(url, addr, method, ctl.signal);
    } catch (err) {
      throw ctl.signal.aborted ? new ProxyError(504, 'timeout', 'The Storybook host took more than 5 seconds to answer.') : new ProxyError(502, 'network', `Could not reach ${url.hostname}.`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status < 300 || res.status >= 400 || res.status === 304) return { res, url };
    res.discard();
    const location = header(res.headers, 'location');
    if (!location) return { res, url };
    if (hop >= MAX_REDIRECTS) throw new ProxyError(502, 'redirects', 'The Storybook address redirects too many times.');
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new ProxyError(502, 'redirects', 'The Storybook host answered with a broken redirect.');
    }
    const check = checkStorybookUrl(next.toString());
    if (!check.ok || next.protocol !== 'https:') throw new ProxyError(400, 'blocked', 'The Storybook address redirects somewhere Bridge does not read.');
    // Hosts with "pretty URLs" (Cloudflare Pages) send iframe.html to /iframe; the index files must keep their name.
    const same = next.pathname.endsWith(`/${file}`) || (file === 'iframe.html' && next.pathname.endsWith('/iframe'));
    if (!same) throw new ProxyError(404, 'not-found', `The host redirects ${file} to another page, so there is no Storybook index there.`);
    url = new URL(next.pathname + next.search, `https://${next.hostname}`);
  }
}

type Frame = 'allowed' | 'blocked' | 'unknown';

/** Whether another site may frame a page, from its X-Frame-Options and CSP frame-ancestors. */
export function frameVerdict(headers: Upstream['headers']): Frame {
  const xfo = header(headers, 'x-frame-options').toLowerCase();
  if (/deny|sameorigin|allow-from/.test(xfo)) return 'blocked';
  const csp = header(headers, 'content-security-policy');
  const fa = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(csp)?.[1]?.trim().toLowerCase();
  if (fa !== undefined && !fa.split(/\s+/).includes('*')) return 'blocked';
  return 'allowed';
}

async function probeFrame(deps: ProxyDeps, base: URL): Promise<Frame> {
  try {
    let { res } = await fetchFile(deps, new URL('iframe.html', base), 'iframe.html', 'HEAD');
    if (res.status === 405 || res.status === 501) {
      res.discard();
      ({ res } = await fetchFile(deps, new URL('iframe.html', base), 'iframe.html', 'GET'));
    }
    res.discard();
    if (res.status >= 400) return 'unknown';
    return frameVerdict(res.headers);
  } catch {
    return 'unknown';
  }
}

interface Found {
  base: string;
  source: IndexFile;
  index: unknown;
}

async function readIndex(deps: ProxyDeps, base: URL): Promise<Found> {
  let last: ProxyError = new ProxyError(404, 'not-found', 'No Storybook index here: neither index.json nor stories.json was found.');
  for (const file of INDEX_FILES) {
    const { res, url } = await fetchFile(deps, new URL(file, base), file, 'GET');
    if (res.status === 401 || res.status === 403) {
      res.discard();
      last = new ProxyError(403, 'private', 'This Storybook is private: it asks for a sign-in before showing its index.');
      continue;
    }
    if (res.status >= 400) {
      res.discard();
      if (res.status >= 500) last = new ProxyError(502, 'http', `The Storybook host answered ${res.status}.`);
      continue;
    }
    const type = header(res.headers, 'content-type').toLowerCase();
    if (type.includes('text/html')) {
      res.discard();
      if (last.code === 'not-found') last = new ProxyError(404, 'not-json', `${file} is a web page, not a Storybook index.`);
      continue;
    }
    const len = Number(header(res.headers, 'content-length'));
    if (len > MAX_BYTES) {
      res.discard();
      throw new ProxyError(413, 'too-large', 'This Storybook index is larger than 5 MB.');
    }
    let text: string;
    try {
      text = await res.body(MAX_BYTES);
    } catch (err) {
      if ((err as Error).message === 'too-large') throw new ProxyError(413, 'too-large', 'This Storybook index is larger than 5 MB.');
      throw new ProxyError(502, 'network', 'The Storybook host stopped answering.');
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      if (last.code === 'not-found') last = new ProxyError(404, 'not-json', `${file} is not a Storybook index.`);
      continue;
    }
    const o = json as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    if (typeof o.loginUrl === 'string' && !('entries' in o) && !('stories' in o)) {
      last = new ProxyError(403, 'private', 'This Storybook is private: it asks for a sign-in before showing its index.');
      continue;
    }
    if (typeof o.entries !== 'object' && typeof o.stories !== 'object') continue;
    // The base after redirects (react.fluentui.dev -> storybooks.fluentui.dev/react), so previews load from there.
    const finalBase = url.toString().replace(new RegExp(`/${file.replace('.', '\\.')}$`), '');
    return { base: finalBase, source: file, index: json };
  }
  throw last;
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

export async function handleStorybookRequest(req: Request, deps: ProxyDeps): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'method', message: 'Use GET.' }, { Allow: 'GET' });
  const raw = new URL(req.url).searchParams.get('url');
  if (!raw || raw.length > 2048) return json(400, { error: 'invalid-url', message: 'Add ?url= with the Storybook address.' });
  const check = checkStorybookUrl(raw);
  if (!check.ok) return json(400, { error: check.reason, message: check.message });
  try {
    const found = await readIndex(deps, check.url);
    const frame = await probeFrame(deps, new URL(`${found.base}/`));
    return json(200, { ...found, frame }, { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' });
  } catch (err) {
    if (err instanceof ProxyError) return json(err.status, { error: err.code, message: err.message });
    return json(502, { error: 'network', message: 'Could not read this Storybook.' });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Node implementation

export const nodeDeps: ProxyDeps = {
  lookup: (host) => dnsLookup(host, { all: true, verbatim: true }),
  request: (url, addr, method, signal) =>
    new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          host: url.hostname,
          servername: url.hostname,
          port: 443,
          path: url.pathname + url.search,
          method,
          signal,
          headers: { accept: 'application/json, */*;q=0.1', 'user-agent': 'Bridge Studio (Storybook quick start)' },
          // Connect to the address that was checked, never to a fresh lookup.
          lookup: ((_h: string, opts: { all?: boolean }, cb: (err: null, a: unknown, f?: number) => void) => (opts?.all ? cb(null, [addr]) : cb(null, addr.address, addr.family))) as unknown as LookupFunction,
        },
        (res) => {
          resolve({
            status: res.statusCode ?? 502,
            headers: res.headers,
            discard: () => res.destroy(),
            body: (max) =>
              new Promise<string>((ok, ko) => {
                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (c: Buffer) => {
                  size += c.length;
                  if (size > max) {
                    res.destroy();
                    ko(new Error('too-large'));
                  } else chunks.push(c);
                });
                res.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
                res.on('error', ko);
              }),
          });
        },
      );
      req.on('error', reject);
      req.end();
    }),
};

/** Vercel Functions entry (Web standard signature). */
export function GET(request: Request): Promise<Response> {
  return handleStorybookRequest(request, nodeDeps);
}
