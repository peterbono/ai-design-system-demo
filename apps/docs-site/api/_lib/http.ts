// Shared pieces of the /api functions (invites, library-access, contribute). Vercel turns no file under api/_lib
// into a function (underscore directory); each function bundles what it imports from here. Node built-ins only.

import { createHash } from 'node:crypto';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

/** An answer with a status, a code and a sentence in the user's words. Never an email in full, never a token. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** More fields for the JSON body. */
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const SECURITY_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra } });
}

export const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) => json(status, { error, message, ...extra });

export const GITHUB_DOWN = 'GitHub did not answer. Try again in a minute.';

const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

/** The host this request was sent to, as Vercel forwards it. */
export const requestHost = (req: Request) => (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host).split(',')[0]!.trim().toLowerCase();

/** `origin` is a page of this very site: same host, https (http on localhost only). */
function originMatches(req: Request, origin: string): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.origin !== origin) return false;
  const host = requestHost(req);
  if (!host || o.host.toLowerCase() !== host) return false;
  return o.protocol === 'https:' || (o.protocol === 'http:' && isLocalHost(o.host));
}

/** The request comes from a page on this very site (same rule as api/github/token.ts). Origin is required. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin || !originMatches(req, origin)) return false;
  const site = req.headers.get('sec-fetch-site');
  return !site || site === 'same-origin';
}

/** Like sameOrigin, but a request without Origin passes (some same-origin GET-like calls omit it). */
export function sameOriginWhenPresent(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin !== null && !originMatches(req, origin)) return false;
  const site = req.headers.get('sec-fetch-site');
  return !site || site === 'same-origin';
}

const REPO = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;

export function parseRepo(v: unknown): { owner: string; repo: string; full: string } {
  if (typeof v !== 'string') throw new HttpError(400, 'bad_request', 'Say which design system, as owner/name.');
  const m = REPO.exec(v.trim());
  if (!m || m[2] === '.' || m[2] === '..') throw new HttpError(400, 'bad_request', 'Say which design system, as owner/name.');
  return { owner: m[1]!, repo: m[2]!, full: `${m[1]}/${m[2]}`.toLowerCase() };
}

/** The JSON object of the body, at most `max` characters. */
export async function readBody(req: Request, max: number): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > max) throw new HttpError(413, 'too_large', 'Request too large.');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'bad_request', 'Send a JSON object.');
  }
}

/** Where emailed links point: PUBLIC_SITE_URL, else the page that asked. */
export function siteOrigin(req: Request, publicUrl: string | undefined): string {
  const pub = publicUrl?.trim();
  if (pub) {
    try {
      return new URL(pub).origin;
    } catch {
      /* fall back to the request */
    }
  }
  return req.headers.get('origin') ?? new URL(req.url).origin;
}

/** The caller's network, as Vercel forwards it; never stored in clear. */
export function clientIp(req: Request): string {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
export const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const secondsToTomorrow = (ms: number) => {
  const d = new Date(ms);
  return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - ms) / 1000));
};

/** A whole number from the env (0 allowed), else the default. */
export function envInt(v: string | undefined, d: number): number {
  const n = v?.trim() ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : d;
}
