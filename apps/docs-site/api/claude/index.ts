// /api/claude: the team's own Claude on Bridge (docs/FIGMA-FIXES.md, "Claude runs it for the team"). A team admin
// connects the team's Anthropic API key in Studio Settings; Bridge keeps it encrypted (api/_lib/claude-key.ts) and
// never sends it back to any browser.
//
//   GET  /api/claude?repo=owner/name
//     -> 200 { available, connected, addedBy?, at?, canManage }    any member of the team; never the key
//   POST /api/claude { action: "connect", repo, key }               team admins: checks the key with Anthropic, stores it
//     -> 200 { connected: true, addedBy, at }
//   POST /api/claude { action: "disconnect", repo }                 team admins
//     -> 200 { connected: false }
//   POST /api/claude { action: "fix", repo, component }            anyone who can edit: Claude fixes one component
//     -> 200 { run: RunView, existing }                             existing: the run already in progress for it
//   GET  /api/claude?repo=owner/name&run=<id>                       where a run stands; moves it one step first (one
//     -> 200 { run: RunView }                                       Claude round, up to about two minutes); &peek=1 reads
//   GET  /api/claude?repo=owner/name&runs=1                         the team's runs of the last 7 days, newest first
//     -> 200 { runs: RunView[] }
//   Errors: { error, message } in Studio words (401 sign in, 403 not an admin or not on this team, 400 a key Claude did
//   not accept, 409 not_connected, 429 too many tries or runs, 503 not set up on this site).
// RunView and the run's steps: api/_lib/fix-runs.ts. Vercel limits: one Claude round per request (fluid compute, 300 s
// per request on this project), the state in Redis between requests, so a run never needs a longer function.
//
// Who may ask, for one team: a GitHub token (`Authorization: Bearer`, Studio's GitHub sign-in and the Figma plugin, any
// origin, CORS open) whose account can push to the repository (admin for connect and disconnect), read with that token;
// or an email member of the team signed in to Studio (the contribute cookie or a Bridge account session, with
// `X-Bridge-Contribute: 1` from a page of this site): Admin for connect and disconnect.
//
// Env: BRIDGE_SECRETS_KEY (base64, 32 bytes or more: the encryption key), CLAUDE_RUNS_PER_HOUR (optional, runs a team
// starts per hour, default 5), PUBLIC_SITE_URL (optional, the Studio links of a run), the storage env (KV_REST_API_URL +
// KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN), and the contribute env for email members
// (LIBRARY_SESSION_SECRET, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY). Nothing here logs.

import { randomBytes } from 'node:crypto';
import { contributorOf, type ContribEnv } from '../contribute/index.js';
import { API_KEY, claudeKeyStore, secretsKey, type ClaudeKeyStore } from '../_lib/claude-key.js';
import { advanceRun, getRun, listRuns, runView, startRun, type RunDeps, type RunView, type StoredRun } from '../_lib/fix-runs.js';
import { githubApp } from '../_lib/github-app.js';
import { envInt, fail, GITHUB_DOWN, HttpError, json, parseRepo, readBody, sameOriginWhenPresent, type FetchLike } from '../_lib/http.js';
import { localAdminsOn } from '../_lib/local-admin.js';
import type { MemberStore } from '../_lib/members.js';
import { redisRest, type Redis } from '../_lib/redis.js';
import type { AppTokens } from '../_lib/github-app.js';

export type { FetchLike, RunView };

export interface ClaudeEnv extends ContribEnv {
  BRIDGE_SECRETS_KEY?: string | undefined;
  CLAUDE_RUNS_PER_HOUR?: string | undefined;
}

export interface ClaudeDeps {
  fetch: FetchLike;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
  /** Injected (tests, local mode); otherwise built from the env. */
  redis?: Redis;
  members?: MemberStore;
  app?: AppTokens;
  /** The Bridge app with write access for runs (contents and pull requests); defaults to `app`. */
  writeApp?: AppTokens;
  /** Tests: Claude for a key, instead of the Messages API. */
  ask?: RunDeps['ask'];
}

/** The words Studio shows. Designer words: what happened and what to do. */
export const CLAUDE_WORDS = {
  notConfigured: 'Connecting Claude is not set up on this site yet.',
  signin: 'Sign in to Bridge first: with GitHub, or with your email in Studio.',
  notOnTeam: 'Only people on this team can see its Claude connection.',
  adminOnly: 'Only admins of this team can connect or disconnect Claude.',
  badKey: 'This does not look like an Anthropic API key. Copy it again from the Claude Console: it starts with sk-ant-.',
  keyRejected: 'Claude did not accept this key. Copy it again from the Claude Console, then paste it here.',
  claudeDown: 'Claude did not answer. Try again in a minute.',
  tooManyTries: 'Too many tries for now. Try again in an hour.',
  origin: 'Connect Claude from Studio on this site.',
} as const;

const MAX_BODY = 4096;
const CONNECT_TRIES_PER_HOUR = 10;
const STORAGE_DOWN = 'Bridge could not reach its storage. Try again in a minute.';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' };

// ---------------------------------------------------------------------------------------------------------------
// Who asks

/** A person on the team, as Bridge read them on this request. */
export interface TeamCaller {
  kind: 'github' | 'member';
  /** The name Bridge shows: a GitHub profile name or login, an email member's name. Never an email. */
  name: string;
  admin: boolean;
  /** Can edit the library (GitHub push, or an email member). */
  canEdit: boolean;
}

/** The GitHub token of an `Authorization: Bearer` header (20 characters or more; local mode accepts the personas'). */
export function bearerOf(req: Request, processEnv: Record<string, string | undefined> = process.env): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_.-]{1,255})$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!m) return null;
  return m.length >= (localAdminsOn(processEnv) ? 8 : 20) ? m : null;
}

async function ghUser(f: FetchLike, token: string, path: string): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await f(`https://api.github.com${path}`, { method: 'GET', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-claude', 'X-GitHub-Api-Version': '2022-11-28' } });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

/**
 * The person behind the request, on this team, or a 401 or 403. A GitHub token is read with itself (who, and their
 * permissions on the repository); a cookie needs `X-Bridge-Contribute: 1` from this site (no cross-site form can send it).
 */
export async function teamCaller(req: Request, owner: string, repo: string, full: string, env: ClaudeEnv, deps: ClaudeDeps): Promise<TeamCaller> {
  const bearer = bearerOf(req);
  if (bearer) {
    const me = await ghUser(deps.fetch, bearer, '/user');
    if (me.status === 401 || me.status === 403 || typeof me.data?.login !== 'string') throw new HttpError(401, 'signin', 'Your GitHub sign-in expired. Sign in again.');
    const r = await ghUser(deps.fetch, bearer, `/repos/${owner}/${repo}`);
    if (r.status === 401) throw new HttpError(401, 'signin', 'Your GitHub sign-in expired. Sign in again.');
    const p = r.status === 200 ? r.data?.permissions : null;
    if (!p || !(p.push || p.admin)) throw new HttpError(403, 'forbidden', CLAUDE_WORDS.notOnTeam);
    const profile = typeof me.data.name === 'string' && me.data.name.trim() ? me.data.name.trim() : me.data.login;
    return { kind: 'github', name: profile, admin: p.admin === true, canEdit: true };
  }
  if (req.headers.get('x-bridge-contribute') !== '1' || !sameOriginWhenPresent(req)) throw new HttpError(401, 'signin', CLAUDE_WORDS.signin);
  const m = await contributorOf(req, full, env, { fetch: deps.fetch, ...(deps.now ? { now: deps.now } : {}), ...(deps.redis ? { redis: deps.redis } : {}), ...(deps.members ? { members: deps.members } : {}), ...(deps.app ? { app: deps.app } : {}) });
  if (!m) throw new HttpError(401, 'signin', CLAUDE_WORDS.signin);
  return { kind: 'member', name: m.name, admin: m.role === 'admin', canEdit: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Services

interface Services {
  redis: Redis;
  keys: ClaudeKeyStore;
}

function services(env: ClaudeEnv, deps: ClaudeDeps): Services | null {
  const key = secretsKey(env.BRIDGE_SECRETS_KEY);
  const kvUrl = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const kvToken = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  const redis = deps.redis ?? (kvUrl && kvToken ? redisRest(kvUrl, kvToken, deps.fetch, STORAGE_DOWN) : null);
  if (!key || !redis) return null;
  return { redis, keys: claudeKeyStore(redis, key, deps.random ?? ((n) => randomBytes(n))) };
}

/** The permissions of the token a run reads and writes with, and nothing more (the same as /api/ship). */
export const RUN_PERMISSIONS = { contents: 'write', pull_requests: 'write' } as const;

function runDeps(env: ClaudeEnv, deps: ClaudeDeps, svc: Services): RunDeps {
  const now = deps.now ?? Date.now;
  const appId = env.GITHUB_APP_ID?.trim();
  const pem = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const app = deps.writeApp ?? deps.app ?? (appId && pem ? githubApp(appId, pem, deps.fetch, now, { permissions: { ...RUN_PERMISSIONS }, require: { ...RUN_PERMISSIONS }, userAgent: 'bridge-claude' }) : null);
  return {
    redis: svc.redis,
    fetch: deps.fetch,
    now,
    ...(deps.random ? { random: deps.random } : {}),
    appToken: async (owner, repo) => (app ? app.installationToken(owner, repo) : null),
    claudeKey: (repo) => svc.keys.reveal(repo),
    runsPerHour: envInt(env.CLAUDE_RUNS_PER_HOUR, 5) || 5,
    ...(deps.ask ? { ask: deps.ask } : {}),
  };
}

/** Where Studio reviews a run's pull request, as a full address the Figma plugin can open. */
function withLinks(v: RunView, req: Request, env: ClaudeEnv, owner: string, repo: string): RunView & { reviewUrl?: string } {
  if (!v.review) return v;
  let origin = new URL(req.url).origin;
  try {
    if (env.PUBLIC_SITE_URL?.trim()) origin = new URL(env.PUBLIC_SITE_URL.trim()).origin;
  } catch {
    /* the request's own origin */
  }
  return { ...v, reviewUrl: `${origin}/studio/${owner}/${repo}/${v.review}` };
}

/** Asks Anthropic whether the key works (the models list: free, reads nothing of the team). */
async function keyWorks(f: FetchLike, apiKey: string): Promise<boolean> {
  let res: Response;
  try {
    res = await f(ANTHROPIC_MODELS_URL, { method: 'GET', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } });
  } catch {
    throw new HttpError(502, 'claude_unreachable', CLAUDE_WORDS.claudeDown);
  }
  if (res.ok) return true;
  if (res.status === 401 || res.status === 403) return false;
  throw new HttpError(502, 'claude_unreachable', CLAUDE_WORDS.claudeDown);
}

async function capTries(redis: Redis, repo: string, now: number): Promise<void> {
  const k = `bridge:claude:connect-tries:${repo}:${Math.floor(now / 3_600_000)}`;
  const [n] = await redis.pipe([['INCRBY', k, 1], ['EXPIRE', k, 3600]]);
  if (Number(n) > CONNECT_TRIES_PER_HOUR) throw new HttpError(429, 'limit', CLAUDE_WORDS.tooManyTries, {}, { 'Retry-After': '3600' });
}

// ---------------------------------------------------------------------------------------------------------------
// Handler

export async function handleClaude(req: Request, env: ClaudeEnv, deps: ClaudeDeps): Promise<Response> {
  const bearerCall = /^Bearer\s/i.test(req.headers.get('authorization') ?? '');
  const cors = (r: Response) => {
    if (!bearerCall && req.method !== 'OPTIONS') return r;
    for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
    return r;
  };
  try {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    const now = (deps.now ?? Date.now)();
    if (req.method === 'GET') {
      const q = new URL(req.url).searchParams;
      const { owner, repo, full } = parseRepo(q.get('repo'));
      const svc = services(env, deps);
      const who = await teamCaller(req, owner, repo, full, env, deps);
      if (q.has('run') || q.has('runs')) {
        if (!svc) return cors(fail(503, 'not_configured', CLAUDE_WORDS.notConfigured));
        if (q.has('runs')) return cors(json(200, { runs: (await listRuns(svc.redis, full, now)).map((r) => withLinks(runView(r), req, env, owner, repo)) }));
        const id = q.get('run') ?? '';
        const run: StoredRun | null = q.get('peek') === '1' ? await getRun(svc.redis, full, id) : await advanceRun(runDeps(env, deps, svc), full, id);
        if (!run) return cors(fail(404, 'not_found', 'This Claude run is not there anymore. Ask Claude again.'));
        return cors(json(200, { run: withLinks(runView(run), req, env, owner, repo) }));
      }
      if (!svc) return cors(json(200, { available: false, connected: false, canManage: who.admin }));
      const c = await svc.keys.connection(full);
      return cors(json(200, { available: true, ...c, canManage: who.admin }));
    }
    if (req.method !== 'POST') return cors(json(405, { error: 'method', message: 'Use GET or POST.' }, { Allow: 'GET, POST, OPTIONS' }));
    if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return cors(fail(415, 'content_type', 'Send JSON.'));
    if (!bearerCall && !sameOriginWhenPresent(req)) return cors(fail(403, 'origin', CLAUDE_WORDS.origin));
    const body = await readBody(req, MAX_BODY);
    const { owner, repo, full } = parseRepo(body.repo);
    const svc = services(env, deps);
    if (!svc) return cors(fail(503, 'not_configured', CLAUDE_WORDS.notConfigured));
    switch (body.action) {
      case 'connect': {
        const who = await teamCaller(req, owner, repo, full, env, deps);
        if (!who.admin) return cors(fail(403, 'forbidden', CLAUDE_WORDS.adminOnly));
        const apiKey = typeof body.key === 'string' ? body.key.trim() : '';
        if (!API_KEY.test(apiKey)) return cors(fail(400, 'bad_key', CLAUDE_WORDS.badKey));
        await capTries(svc.redis, full, now);
        if (!(await keyWorks(deps.fetch, apiKey))) return cors(fail(400, 'key_rejected', CLAUDE_WORDS.keyRejected));
        const c = await svc.keys.connect(full, apiKey, who.name, now);
        return cors(json(200, c));
      }
      case 'fix': {
        const who = await teamCaller(req, owner, repo, full, env, deps);
        if (!who.canEdit) return cors(fail(403, 'forbidden', CLAUDE_WORDS.notOnTeam));
        const { run, existing } = await startRun(runDeps(env, deps, svc), { repo: full, component: body.component, startedBy: who.name });
        return cors(json(200, { run: withLinks(runView(run), req, env, owner, repo), existing }));
      }
      case 'disconnect': {
        const who = await teamCaller(req, owner, repo, full, env, deps);
        if (!who.admin) return cors(fail(403, 'forbidden', CLAUDE_WORDS.adminOnly));
        await svc.keys.disconnect(full);
        return cors(json(200, { connected: false }));
      }
      default:
        return cors(fail(400, 'bad_request', 'Say what to do: connect, disconnect or fix.'));
    }
  } catch (e) {
    if (e instanceof HttpError) return cors(json(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers));
    return cors(fail(502, 'unreachable', 'Something went wrong. Try again in a minute.'));
  }
}

const envFromProcess = (): ClaudeEnv => ({
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  LIBRARY_SESSION_SECRET: process.env.LIBRARY_SESSION_SECRET,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  BRIDGE_SECRETS_KEY: process.env.BRIDGE_SECRETS_KEY,
  CLAUDE_RUNS_PER_HOUR: process.env.CLAUDE_RUNS_PER_HOUR,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
});

const realFetch: FetchLike = (url, init) => fetch(url, init);
const handle = (request: Request) => handleClaude(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
