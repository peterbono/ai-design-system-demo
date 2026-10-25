// The whole product on a laptop: `npm run dev:full` serves every api/* function inside `astro dev`, with zero
// secrets and never touching production data (docs/HOSTED.md, "Test everything locally").
//
//   storage   the in-memory Redis of the tests (api/_lib/redis.ts), saved to .bridge-local/redis.json after every write
//   email     never sent: printed in the terminal and listed at /api/dev/outbox
//   secrets   LIBRARY_SESSION_SECRET is generated once and kept in .bridge-local/session-secret
//   GitHub    optional: GITHUB_APP_* from apps/docs-site/.env.local (or the shell); otherwise the usual
//             "not available yet" answers
//
// Upstash, KV, Resend, Blob and cron variables are never read in this mode, even when they are set. Dev only: this
// file is loaded by astro.config.mjs when BRIDGE_LOCAL=1 and by dev/cli.mjs; nothing here ships to Vercel (api/* is
// what Vercel bundles), and it refuses to run with NODE_ENV=production or on Vercel.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { escHtml, type EmailMessage, type EmailSender } from '../api/_lib/email.js';
import type { AppTokens } from '../api/_lib/github-app.js';
import type { FetchLike } from '../api/_lib/http.js';
import { localAdminStore, localAdminsOn, type LocalAdmins } from '../api/_lib/local-admin.js';
import { type EmailMember, memberStore } from '../api/_lib/members.js';
import { memoryRedis, type Redis, type RedisArg, type RedisSnapshot } from '../api/_lib/redis.js';
import { RESERVED_PATHS_URL, reservedFromFiles, type ReservedPaths } from '../src/lib/team-path.js';
import { fixtureApp, fixtureGithub, gitFiles, type SampleBuilds } from './local-github.js';
import { PERSONA_PREFIX } from './local-repo.js';

/** The first path part of the browser's GitHub stand-in: /api/dev/github/<GitHub REST path>. */
export const DEV_GITHUB = '/api/dev/github';

/** A request's headers without a local persona token: those never leave this computer. */
export function withoutPersona(headers: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (!(k.toLowerCase() === 'authorization' && v.replace(/^(Bearer|token)\s+/i, '').startsWith(PERSONA_PREFIX))) out[k] = v;
  return out;
}

/**
 * The browser's GitHub, for the local audit (the harness routes https://api.github.com/** here): the same stand-in
 * the functions use, so a persona (ghp_local_dana) reviews and merges what an email member sent. Local mode only.
 */
export async function devGithub(req: Request, f: FetchLike, env: Record<string, string | undefined> = process.env): Promise<Response> {
  if (!localAdminsOn(env)) return new Response(JSON.stringify({ message: 'Local mode only.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  const u = new URL(req.url);
  const path = u.pathname.slice(DEV_GITHUB.length) || '/';
  const headers: Record<string, string> = {};
  for (const k of ['authorization', 'accept', 'if-none-match', 'content-type']) {
    const v = req.headers.get(k);
    if (v) headers[k === 'authorization' ? 'Authorization' : k === 'accept' ? 'Accept' : k] = v;
  }
  const method = req.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.text();
  const res = await f(`https://api.github.com${path}${u.search}`, { method, headers, ...(body ? { body } : {}) });
  const out = new Headers(res.headers);
  out.set('Access-Control-Allow-Origin', '*');
  out.set('Access-Control-Expose-Headers', 'ETag, Link, X-RateLimit-Remaining, X-RateLimit-Reset');
  out.delete('content-encoding');
  out.delete('content-length');
  return new Response(res.status === 204 || res.status === 304 ? null : await res.arrayBuffer(), { status: res.status, headers: out });
}

/** The folder that holds local data, next to package.json (gitignored). */
export const LOCAL_DIR = '.bridge-local';

/** Throws when this could be production: NODE_ENV=production, or any Vercel build or function (VERCEL set). */
export function assertLocal(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === 'production') throw new Error('Bridge local mode refuses to run with NODE_ENV=production.');
  if (env.VERCEL) throw new Error('Bridge local mode refuses to run on Vercel (VERCEL is set).');
}

// ---------------------------------------------------------------------------------------------------------------
// Storage: memoryRedis saved to a JSON file after every command that writes.

const WRITES = new Set(['SET', 'GETDEL', 'DEL', 'INCRBY', 'EXPIRE', 'SADD', 'SREM', 'ZADD', 'ZREM', 'ZREMRANGEBYSCORE']);

function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`);
  renameSync(tmp, file);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * A Redis that lives in memory and in `file`: read at start, rewritten after each write, and read again when another
 * process (npm run dev:seed, npm run dev:reset) changed the file.
 */
export function fileRedis(file: string, now: () => number = Date.now): Redis & { snapshot(): RedisSnapshot } {
  const mem = memoryRedis(now);
  const stamp = () => {
    try {
      return statSync(file).mtimeMs;
    } catch {
      return -1;
    }
  };
  let seen = Number.NaN;
  const load = () => {
    const t = stamp();
    if (t === seen) return;
    const saved = readJson<RedisSnapshot>(file, []);
    mem.restore(Array.isArray(saved) ? saved : []);
    seen = t;
  };
  const writes = (args: RedisArg[]) => WRITES.has(String(args[0]).toUpperCase());
  const save = () => {
    writeJson(file, mem.snapshot());
    seen = stamp();
  };
  load();
  return {
    snapshot: () => mem.snapshot(),
    async cmd(...args) {
      load();
      const r = await mem.cmd(...args);
      if (writes(args)) save();
      return r;
    },
    async pipe(cmds) {
      load();
      const r = await mem.pipe(cmds);
      if (cmds.some(writes)) save();
      return r;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Email: an outbox instead of Resend.

export interface OutboxItem extends EmailMessage {
  at: string;
}

export const OUTBOX_KEPT = 50;

/** The 6-digit sign-in code or the first link of a message, to print it on its own line. */
export function highlight(msg: Pick<EmailMessage, 'text'>): string | null {
  const code = /\b(\d{6})\b/.exec(msg.text);
  if (code) return `code: ${code[1]}`;
  const link = /https?:\/\/\S+/.exec(msg.text);
  return link ? `link: ${link[0]}` : null;
}

/** Keeps the last OUTBOX_KEPT messages in `file` (newest first) and prints each in the terminal. */
export function outboxSender(file: string, print: (s: string) => void = console.log, now: () => number = Date.now): EmailSender & { list(): OutboxItem[] } {
  const list = (): OutboxItem[] => {
    const v = readJson<OutboxItem[]>(file, []);
    return Array.isArray(v) ? v : [];
  };
  return {
    list,
    async send(msg) {
      const item: OutboxItem = { at: new Date(now()).toISOString(), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html };
      writeJson(file, [item, ...list()].slice(0, OUTBOX_KEPT));
      const hl = highlight(msg);
      const bar = '-'.repeat(72);
      print(
        [
          '',
          bar,
          `  [bridge local] email not sent, kept in the outbox (/api/dev/outbox)`,
          `  to:      ${msg.to}`,
          `  subject: ${msg.subject}`,
          ...(hl ? [`  ${hl}`] : []),
          bar,
          ...msg.text.split('\n').map((l) => `  ${l}`),
          bar,
          '',
        ].join('\n'),
      );
    },
  };
}

export function outboxPage(items: OutboxItem[]): string {
  const rows = items
    .map((m) => {
      const hl = highlight(m);
      return `<article><p class="meta">${escHtml(m.at)} &middot; to ${escHtml(m.to)}</p><h2>${escHtml(m.subject)}</h2>${hl ? `<p class="hl">${escHtml(hl)}</p>` : ''}<pre>${escHtml(m.text)}</pre></article>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local outbox</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1b1b1f;background:#fff}h1{font-size:20px}h2{font-size:16px;margin:4px 0}article{border:1px solid #ddd;border-radius:8px;padding:12px 16px;margin:12px 0}.meta{color:#666;margin:0;font-size:13px}.hl{font:600 18px ui-monospace,monospace;margin:8px 0}pre{white-space:pre-wrap;font:13px ui-monospace,monospace;margin:0}@media (prefers-color-scheme:dark){body{background:#121214;color:#eee}article{border-color:#333}.meta{color:#aaa}}</style></head>
<body><h1>Local outbox</h1><p>Emails Bridge would have sent, newest first. Nothing leaves this computer. Reload to see new ones.</p>${rows || '<p>No email yet.</p>'}</body></html>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Secrets and environment.

/** KEY=value lines (quotes and `export ` allowed); nothing is ever printed. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    let v = m[2]!.trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.length > 1) {
      // A quoted value may span lines (a PEM key).
      while (!v.endsWith(q) || v.length === 1) {
        if (++i >= lines.length) break;
        v += `\n${lines[i]}`;
      }
      v = v.slice(1, v.endsWith(q) ? -1 : undefined);
      if (q === '"') v = v.replace(/\\n/g, '\n');
    }
    out[m[1]!] = v;
  }
  return out;
}

/** The only variables local mode reads from .env.local and the shell: GitHub App keys. */
export const GITHUB_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_SUGGEST_CLIENT_ID',
  'GITHUB_APP_SUGGEST_CLIENT_SECRET',
] as const;

/** Read or create the session secret of this computer (48 random bytes, base64url). */
export function sessionSecret(dir: string): string {
  const file = join(dir, 'session-secret');
  const old = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  if (old.length >= 32) return old;
  const fresh = randomBytes(48).toString('base64url');
  writeFileSync(file, `${fresh}\n`, { mode: 0o600 });
  return fresh;
}

/**
 * The env every handler gets locally. Storage, email, backup and cron variables are left out on purpose, so a
 * handler can never reach production Upstash or Resend, whatever the shell or .env.local holds.
 */
export function localEnv(secret: string, sources: Record<string, string | undefined>[]): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    LIBRARY_SESSION_SECRET: secret,
    KV_REST_API_URL: undefined,
    KV_REST_API_TOKEN: undefined,
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
    RESEND_API_KEY: undefined,
    INVITE_EMAIL_FROM: undefined,
    BLOB_READ_WRITE_TOKEN: undefined,
    CRON_SECRET: undefined,
    PUBLIC_SITE_URL: undefined,
  };
  for (const k of GITHUB_KEYS) {
    const v = sources.map((s) => s[k]?.trim()).find(Boolean);
    if (v) env[k] = v;
  }
  return env;
}

// ---------------------------------------------------------------------------------------------------------------
// Node request and response <-> Web Request and Response (what api/* functions take and return).

export const MAX_LOCAL_BODY = 10 * 1024 * 1024;

async function readAll(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = typeof c === 'string' ? Buffer.from(c) : (c as Buffer);
    size += b.length;
    if (size > max) throw new Error('too-large');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/** The Web Request of a Node request, as Vercel would hand it to a function. */
export async function toRequest(req: IncomingMessage, max = MAX_LOCAL_BODY): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || k.startsWith(':')) continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else headers.set(k, v);
  }
  const method = (req.method ?? 'GET').toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readAll(req, max);
  return new Request(url, { method, headers, body: body && body.length ? new Uint8Array(body) : body ? new Uint8Array() : undefined });
}

/** Cookies set over plain http on localhost: `Secure` is dropped so every browser keeps them. */
export const insecureCookie = (c: string) => c.replace(/;\s*Secure(?=;|$)/gi, '');

/** Writes a Web Response to a Node response: status, every header (each Set-Cookie on its own), body. */
export async function sendResponse(res: ServerResponse, r: Response, opts: { http?: boolean } = {}): Promise<void> {
  res.statusCode = r.status;
  const cookies = r.headers.getSetCookie();
  r.headers.forEach((v, k) => {
    if (k !== 'set-cookie') res.setHeader(k, v);
  });
  if (cookies.length) res.setHeader('Set-Cookie', opts.http ? cookies.map(insecureCookie) : cookies);
  const body = r.body ? Buffer.from(await r.arrayBuffer()) : null;
  res.end(body && body.length ? body : undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Routing: /api/<name>[/...] to the function file, as Vercel maps api/<name>/index.ts and api/<path>.ts.

/** The function file of a path, relative to the app root, or null. `_lib` is never a function. */
export function routeOf(pathname: string, exists: (rel: string) => boolean): string | null {
  const m = /^\/api\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\/?$/.exec(pathname);
  if (!m || m[1]!.split('/').some((p) => p.startsWith('_'))) return null;
  for (const rel of [`api/${m[1]}.ts`, `api/${m[1]}/index.ts`]) if (exists(rel)) return rel;
  return null;
}

/**
 * True for a request under /api/ that is a source module, not a function call: a page script importing
 * api/_lib/domains.ts makes Vite fetch /api/_lib/domains.ts. Those go on to Vite instead of the 404 of a missing
 * function. Any `_` segment (helpers are never functions) or a file extension marks one.
 */
export function isModuleRequest(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  const parts = pathname.slice('/api/'.length).split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('_'))) return true;
  return /\.[cm]?[jt]sx?$/.test(parts[parts.length - 1] ?? '');
}

type Mod = Record<string, unknown>;
type Handler = (req: Request) => Promise<Response>;

export interface Local {
  redis: Redis;
  email: EmailSender & { list(): OutboxItem[] };
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  /** Admins seeded by dev/scenarios.ts (api/_lib/local-admin.ts). */
  localAdmins?: LocalAdmins;
  /** The Bridge app for fixture teams, when this computer has no GitHub App keys (dev/local-github.ts). */
  app?: AppTokens;
}

/** How a function is called locally: its handleX with local storage, email and env; else its method export. */
export function handlerFor(rel: string, mod: Mod, local: Local, method: string, extra: { members?: unknown; invites?: unknown; library?: unknown } = {}): Handler | null {
  const { redis, email, env, fetch, localAdmins, app } = local;
  const admins = localAdmins ? { localAdmins } : {};
  const apps = app ? { app } : {};
  const call = (name: string, deps: Record<string, unknown>) => {
    const fn = mod[name];
    return typeof fn === 'function' ? (req: Request) => (fn as (r: Request, e: unknown, d: unknown) => Promise<Response>)(req, env, { fetch, email, ...deps }) : null;
  };
  switch (rel) {
    case 'api/account/index.ts':
      return call('handleAccount', { redis, ...admins });
    case 'api/entry/index.ts':
      return call('handleEntry', { redis, ...admins, ...apps });
    case 'api/contribute/index.ts':
      return call('handleContribute', { redis, ...admins, ...apps });
    case 'api/invites/index.ts':
      return call('handleInvites', { store: extra.invites, members: extra.members, redis, ...admins, ...apps });
    case 'api/ship/index.ts':
      return call('handleShip', { redis, ...apps });
    case 'api/library-access/index.ts':
      return call('handleLibraryAccess', { store: extra.library });
    case 'api/github/token.ts': {
      const fn = mod.handleTokenRequest;
      return typeof fn === 'function' ? (req) => (fn as (r: Request, e: unknown, f: FetchLike) => Promise<Response>)(req, env, fetch) : null;
    }
  }
  // Functions without storage, email or secrets (storybook, csp-report): their own Vercel export.
  const own = mod[method];
  return typeof own === 'function' ? (own as Handler) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Seed: one email member of a team, with the same store the functions use.

export async function seedMember(redis: Redis, repo: string, email: string, name?: string): Promise<EmailMember> {
  const store = memberStore(redis);
  const prev = await store.get(repo, email);
  const m: EmailMember = {
    email: email.trim().toLowerCase(),
    name: name?.trim() || email.split('@')[0]!,
    role: 'edit',
    version: (prev?.version ?? 0) + 1,
    addedBy: 'local-seed',
    at: new Date().toISOString(),
  };
  await store.put(repo, m);
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Team and Library addresses. On Vercel, vercel.json rewrites /studio/<owner>/<repo>/... to the team shell and
// /library/<owner>/<repo>/... to the Library shell when no file answers; `astro dev` has no rewrites, so local mode
// does the same here.

/** The first parts of a Studio address that are real pages (src/pages/studio), never a team owner. */
export function studioReserved(dir: string): Set<string> {
  try {
    return new Set(readdirSync(dir).map((f) => f.replace(/\.(astro|ts|md)$/, '')));
  } catch {
    return new Set();
  }
}

/**
 * The reserved team paths of the build (/team-shell/reserved.json, astro.config.mjs) read from the page sources:
 * `x.astro` builds x/index.html, `x.json.ts` builds x.json, `index.astro` builds index.html.
 */
export function devReserved(dir: string): ReservedPaths {
  const files: string[] = [];
  const walk = (d: string, rel: string) => {
    let names: string[] = [];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const f of names) {
      const r = rel ? `${rel}/${f}` : f;
      if (statSync(join(d, f)).isDirectory()) walk(join(d, f), r);
      else if (/\.(astro|md)$/.test(f)) files.push(/^index\.(astro|md)$/.test(f) ? `${rel ? `${rel}/` : ''}index.html` : `${r.replace(/\.(astro|md)$/, '')}/index.html`);
      else if (/\.ts$/.test(f)) files.push(r.replace(/\.ts$/, ''));
    }
  };
  walk(dir, '');
  return reservedFromFiles(files);
}

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** The shell address a team or Library address is served from, or null (any other path). The query is kept. */
export function teamRewrite(url: string, reserved: ReadonlySet<string>): string | null {
  const q = url.indexOf('?');
  const path = q < 0 ? url : url.slice(0, q);
  const query = q < 0 ? '' : url.slice(q);
  const parts = path.split('/');
  // ['', 'studio', owner, repo, ...rest] or ['', 'studio', '~', owner, repo, ...rest]
  if (parts[1] === 'studio') {
    const escaped = parts[2] === '~';
    const [owner, repo] = escaped ? [parts[3], parts[4]] : [parts[2], parts[3]];
    if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
    if (!escaped && reserved.has(owner)) return null;
    const rest = parts.slice(escaped ? 5 : 4).join('/');
    return `/team-shell/${rest}${query}`;
  }
  if (parts[1] === 'library') {
    const [owner, repo] = [parts[2], parts[3]];
    if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
    const rest = parts.slice(4);
    if (rest[0] === 'components' && rest[1] && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(rest[1])) return `/library-shell/components/item/${query}`;
    return `/library-shell/${rest.join('/')}${query}`;
  }
  return null;
}

/** The local data folder of an app root, created on demand. */
export function localDir(root: string): string {
  const dir = join(root, LOCAL_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function resetLocal(root: string): void {
  rmSync(join(root, LOCAL_DIR), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------------------
// The Astro integration (dev server only).

interface DevServer {
  middlewares: { use(fn: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void): void };
  ssrLoadModule(url: string): Promise<Mod>;
}

export function bridgeLocal(opts: { root: string; log?: (s: string) => void }) {
  assertLocal();
  const { root } = opts;
  const log = opts.log ?? console.log;
  return {
    name: 'bridge-local-api',
    hooks: {
      'astro:server:setup': async ({ server }: { server: DevServer }) => {
        const dir = localDir(root);
        const envFile = join(root, '.env.local');
        const fromFile = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {};
        const env = localEnv(sessionSecret(dir), [fromFile, process.env]);
        const redis = fileRedis(join(dir, 'redis.json'));
        const email = outboxSender(join(dir, 'outbox.json'), log);
        // A local persona's token (dev/local-repo.ts) is never sent to GitHub.
        const realFetch: FetchLike = (url, init) => fetch(url, { ...init, headers: withoutPersona(init?.headers) });
        const hasGithub = Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
        // Fixture teams of npm run dev:scenario: their GitHub calls are answered here, read-only (dev/local-github.ts).
        const local: Local = {
          redis,
          email,
          env,
          fetch: fixtureGithub(redis, () => gitFiles(join(root, '..', '..')), realFetch, Date.now, () => server.ssrLoadModule('/src/lib/building-sample.ts') as ReturnType<SampleBuilds>),
          localAdmins: localAdminStore(redis),
          ...(hasGithub ? {} : { app: fixtureApp(redis) }),
        };
        log(
          [
            '',
            '  [bridge local] api/* runs here, with local data only.',
            `    storage   ${join(LOCAL_DIR, 'redis.json')} (npm run dev:reset clears it)`,
            '    email     printed here and at /api/dev/outbox, never sent',
            `    GitHub    ${hasGithub ? 'GitHub App keys found in .env.local or the shell' : 'no GitHub App keys: GitHub-backed features answer "not available yet"'}`,
            '',
          ].join('\n'),
        );

        // Stores built from the same Redis, the way the functions build them from Upstash.
        let extra: { members?: unknown; invites?: unknown; library?: unknown } | null = null;
        const stores = async () => {
          if (extra) return extra;
          const invites = (await server.ssrLoadModule('/api/invites/index.ts')) as { inviteStoreOn: (r: Redis) => unknown };
          const library = (await server.ssrLoadModule('/api/library-access/index.ts')) as { libraryStoreOn: (r: Redis) => unknown };
          extra = { members: memberStore(redis), invites: invites.inviteStoreOn(redis), library: library.libraryStoreOn(redis) };
          return extra;
        };

        // Team and Library addresses: the rewrites vercel.json does on the real site (dev/local-api.ts teamRewrite).
        const reserved = studioReserved(join(root, 'src', 'pages', 'studio'));
        server.middlewares.use((req, _res, next) => {
          const method = (req.method ?? 'GET').toUpperCase();
          if (method === 'GET' || method === 'HEAD') {
            const to = teamRewrite(req.url ?? '/', reserved);
            if (to) req.url = to;
          }
          next();
        });

        // The build writes /team-shell/reserved.json (astro.config.mjs); `astro dev` has no build, so answer it here.
        server.middlewares.use((req, res, next) => {
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
          if (pathname !== RESERVED_PATHS_URL) return next();
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(`${JSON.stringify(devReserved(join(root, 'src', 'pages', 'studio')))}\n`);
        });

        // The browser's GitHub stand-in (local audits): before the module check, a path may end in .ts or .tsx.
        server.middlewares.use((req, res, next) => {
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
          if (pathname !== DEV_GITHUB && !pathname.startsWith(`${DEV_GITHUB}/`)) return next();
          void (async () => sendResponse(res, await devGithub(await toRequest(req), local.fetch), { http: true }))().catch((e: unknown) => {
            log(`  [bridge local] ${pathname} failed: ${e instanceof Error ? e.message : String(e)}`);
            if (!res.headersSent) res.statusCode = 500;
            res.end();
          });
        });

        server.middlewares.use((req, res, next) => {
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
          if (!pathname.startsWith('/api/') || isModuleRequest(pathname)) return next();
          void (async () => {
            if (pathname.replace(/\/$/, '') === '/api/dev/outbox') {
              const wantsHtml = (req.headers.accept ?? '').includes('text/html');
              res.setHeader('Cache-Control', 'no-store');
              if (wantsHtml) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.end(outboxPage(email.list()));
              }
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({ messages: email.list().map(({ html: _html, ...m }) => ({ ...m, highlight: highlight(m) })) }));
            }
            const rel = routeOf(pathname, (p) => existsSync(join(root, p)));
            if (!rel) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({ error: 'not_found', message: 'No such function.' }));
            }
            const mod = await server.ssrLoadModule(`/${rel}`);
            const method = (req.method ?? 'GET').toUpperCase();
            const handler = handlerFor(rel, mod, local, method, await stores());
            if (!handler) {
              res.statusCode = 405;
              return res.end();
            }
            await sendResponse(res, await handler(await toRequest(req)), { http: true });
          })().catch((e: unknown) => {
            log(`  [bridge local] ${pathname} failed: ${e instanceof Error ? e.message : String(e)}`);
            if (!res.headersSent) res.statusCode = e instanceof Error && e.message === 'too-large' ? 413 : 500;
            res.end();
          });
        });
      },
    },
  };
}
