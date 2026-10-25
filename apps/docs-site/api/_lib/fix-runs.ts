// Claude fix runs on Bridge's server (api/claude, docs/FIGMA-FIXES.md "Claude runs it for the team"): the same loop as
// `bridge fix <component> --with-claude`, with the team's connected key, the Bridge GitHub App for reads and writes,
// and the steps of @bridge-ds/core (fix-engine.gen.js is core's own code, bundled: nothing is forked).
//
// Vercel functions on this project run at most 300 s (fluid compute, the default limit). Three Claude rounds plus the
// pull request can take longer, so a run moves in steps: each request does at most one Claude round (and, after the
// last one, opens the pull request), keeps the state in Redis, and answers where it stands. Whoever watches the run
// (the Figma plugin, Studio) asks again until it is ready, no-fix or failed. A lease keeps two requests from working on
// one run at once; a run nobody asks about waits where it stands.
//
// Keys (Upstash Redis, the same database as the team keys; repository lower case):
//   bridge:claude:run:<repo>:<id>             the run (StoredRun), 7 days
//   bridge:claude:runs:<repo>                 sorted set of run ids by start time (ms); older than 7 days are dropped
//   bridge:claude:active:<repo>:<component>   the id of the component's run in progress (one at a time), 1 hour at most
//   bridge:claude:lease:<repo>:<id>           a request is working on it, 280 s at most
//   bridge:claude:started:<repo>:<hour>       runs started this hour (the team's cap), 1 hour
// Nothing here logs, and no answer carries the key, a stack or a GitHub error.

import { randomBytes } from 'node:crypto';
import * as engine from './fix-engine.gen.js';
import type { BridgeConfig, FigmaFidelityRun, FigmaFixesFile, FixLoopState, GapCaseForInput, MeasuredSpecsFile } from './fix-engine.gen.js';
import { HttpError, type FetchLike } from './http.js';
import type { Redis } from './redis.js';

export type RunStatus = 'queued' | 'running' | 'ready' | 'no-fix' | 'failed';
const FINAL: readonly RunStatus[] = ['ready', 'no-fix', 'failed'];

export interface StoredRun {
  v: 1;
  id: string;
  /** owner/repo, lower case. */
  repo: string;
  component: string;
  status: RunStatus;
  /** The loop between rounds (core FixLoopState); null until the first round. */
  loop: FixLoopState | null;
  /** The commit the rounds read (the default branch then), and the requests branch the plugin's run was read from. */
  ref: { base: string; sha: string; requests: string | null } | null;
  /** Who asked, by name. */
  startedBy: string;
  createdAt: string;
  updatedAt: string;
  /** Claude did not answer in a row (busy, overloaded): the run gives up after MAX_RETRIES. */
  retries: number;
  pr?: { number: number; url: string; draft: boolean };
  /** What Claude's fix does, one plain sentence per fix (each fix's reason). */
  applied?: string[];
  /** no-fix and failed: one sentence for the designer. */
  reason?: string;
  /** The cause in developer words (Studio's "For developers" fold), never shown to a designer. */
  developer?: string;
}

/** What the plugin and Studio read: the status in designer words, never the key, a stack or a GitHub error. */
export interface RunView {
  id: string;
  component: string;
  status: RunStatus;
  /** The tag: "Claude is on it", "Claude's fix is ready", "No fix found", "Not finished". */
  label: string;
  /** One sentence. */
  sentence: string;
  /** running: the round Claude is on (1 to maxRounds). */
  round?: number;
  maxRounds: number;
  startedBy: string;
  createdAt: string;
  updatedAt: string;
  /** ready: the draft pull request, and where to review it in Studio (a path under the team's Studio). */
  pr?: { number: number; url: string; draft: boolean };
  review?: string;
  applied?: string[];
  reason?: string;
  developer?: string;
  /** Not final: ask again (GET ?run=) after about this many seconds. */
  retryAfter?: number;
}

export const RUN_TTL_S = 7 * 24 * 60 * 60;
const ACTIVE_TTL_S = 60 * 60;
const LEASE_TTL_S = 280;
const MAX_RETRIES = 3;
const CLAUDE_TIMEOUT_MS = 150_000;
const MAX_TOKENS = 4000;
export const DEFAULT_RUNS_PER_HOUR = 5;
/** Who drafted the change, in the pull request body and commit; the `source:` label Studio changes use. */
export const RUN_SOURCE = 'bridge-web';
export const RUN_TOOL = "Bridge with the team's connected Claude (source: bridge-web)";

const lc = (s: string) => s.trim().toLowerCase();
export const runKey = (repo: string, id: string) => `bridge:claude:run:${lc(repo)}:${id}`;
export const runsKey = (repo: string) => `bridge:claude:runs:${lc(repo)}`;
export const activeKey = (repo: string, component: string) => `bridge:claude:active:${lc(repo)}:${component.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
const leaseKey = (repo: string, id: string) => `bridge:claude:lease:${lc(repo)}:${id}`;
const startedKey = (repo: string, now: number) => `bridge:claude:started:${lc(repo)}:${Math.floor(now / 3_600_000)}`;

// ---------------------------------------------------------------------------------------------------------------
// Words (settled rule "Claude copy must be true": Claude proposes, a person on the team reviews, nothing ships alone)

export const RUN_WORDS = {
  onIt: 'Claude is on it',
  ready: "Claude's fix is ready",
  noFix: 'No fix found',
  failed: 'Not finished',
  queued: (c: string) => `Claude is starting on ${c}.`,
  running: (c: string, n: number, max: number) => `Claude is on ${c}: round ${n} of ${max}.`,
  readySentence: (c: string) => `Claude's fix brings ${c} closer to the code. Someone on your team reviews it, then it reaches Figma.`,
  noFixSentence: (c: string) => `Claude could not find a fix that brings ${c} closer to the code. It stays as it is.`,
  nothing: (c: string) => `Nothing differs on ${c} in the latest check, so there is nothing for Claude to fix.`,
  notConnected: "Claude is not connected for your team. An admin connects it in Settings.",
  keyRejected: "Claude did not accept your team's key. An admin connects Claude again in Settings.",
  account: "Claude could not run on your team's Anthropic account. An admin checks it in the Claude Console.",
  busy: 'Claude is busy right now. Ask again in a few minutes.',
  setup: 'Claude cannot fix this component yet. A developer sets it up; nothing to do on your side.',
  write: "Bridge could not open Claude's fix for review. Ask again in a few minutes.",
  already: (c: string) => `Claude is already on ${c}.`,
  tooMany: (n: number) => `Your team asked Claude for ${n} fixes this hour. Ask again in an hour.`,
  badComponent: 'Say which component, by its name.',
} as const;

export function runView(r: StoredRun): RunView {
  const max = engine.FIX_LOOP_MAX_ROUNDS;
  const base = { id: r.id, component: r.component, status: r.status, maxRounds: max, startedBy: r.startedBy, createdAt: r.createdAt, updatedAt: r.updatedAt };
  switch (r.status) {
    case 'queued':
      return { ...base, label: RUN_WORDS.onIt, sentence: RUN_WORDS.queued(r.component), retryAfter: 2 };
    case 'running': {
      const n = Math.min(max, (r.loop?.round ?? 0) + 1);
      return { ...base, label: RUN_WORDS.onIt, sentence: RUN_WORDS.running(r.component, n, max), round: n, retryAfter: r.retries ? 20 : 2 };
    }
    case 'ready':
      return { ...base, label: RUN_WORDS.ready, sentence: RUN_WORDS.readySentence(r.component), ...(r.pr ? { pr: r.pr, review: `changes/?pr=${r.pr.number}` } : {}), applied: r.applied ?? [] };
    case 'no-fix':
      return { ...base, label: RUN_WORDS.noFix, sentence: r.reason ?? RUN_WORDS.noFixSentence(r.component), reason: r.reason ?? RUN_WORDS.noFixSentence(r.component), ...(r.developer ? { developer: r.developer } : {}) };
    default:
      return { ...base, label: RUN_WORDS.failed, sentence: r.reason ?? RUN_WORDS.busy, reason: r.reason ?? RUN_WORDS.busy, ...(r.developer ? { developer: r.developer } : {}) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Store

function parseRun(raw: unknown): StoredRun | null {
  if (typeof raw !== 'string') return null;
  try {
    const r = JSON.parse(raw) as StoredRun;
    return r && r.v === 1 && typeof r.id === 'string' && typeof r.component === 'string' && typeof r.status === 'string' ? r : null;
  } catch {
    return null;
  }
}

export async function getRun(redis: Redis, repo: string, id: string): Promise<StoredRun | null> {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const r = parseRun(await redis.cmd('GET', runKey(repo, id)));
  return r && r.repo === lc(repo) ? r : null;
}

async function putRun(redis: Redis, r: StoredRun): Promise<void> {
  const cmds: (string | number)[][] = [['SET', runKey(r.repo, r.id), JSON.stringify(r), 'EX', RUN_TTL_S]];
  if (FINAL.includes(r.status)) cmds.push(['DEL', activeKey(r.repo, r.component)]);
  await redis.pipe(cmds);
}

/** The team's runs of the last 7 days, newest first (at most 20). */
export async function listRuns(redis: Redis, repo: string, now: number): Promise<StoredRun[]> {
  const [, ids] = await redis.pipe([
    ['ZREMRANGEBYSCORE', runsKey(repo), '-inf', now - RUN_TTL_S * 1000],
    ['ZRANGE', runsKey(repo), 0, -1],
  ]);
  const list = (Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []).reverse().slice(0, 20);
  if (!list.length) return [];
  const raw = (await redis.cmd('MGET', ...list.map((id) => runKey(repo, id)))) as unknown[] | null;
  return list.map((_, i) => parseRun(raw?.[i])).filter((r): r is StoredRun => Boolean(r));
}

// ---------------------------------------------------------------------------------------------------------------
// Start

export interface RunDeps {
  redis: Redis;
  fetch: FetchLike;
  now: () => number;
  random?: (n: number) => Uint8Array;
  /** An installation token of the Bridge app for one repository (contents and pull requests write), or null. */
  appToken: (owner: string, repo: string) => Promise<string | null>;
  /** The team's Claude key in clear, or null when none is connected. Server side only. */
  claudeKey: (repo: string) => Promise<string | null>;
  /** Runs a team may start per hour. */
  runsPerHour?: number;
  /** Tests: Claude for a key (default: the Messages API, model FIX_LOOP_MODEL). */
  ask?: (apiKey: string) => (prompt: string) => Promise<string>;
}

const COMPONENT = /^[A-Za-z][A-Za-z0-9 ._-]{0,79}$/;

/**
 * Starts a run for one component, or answers the run already in progress for it (`existing: true`). Refuses when the
 * team has not connected Claude, and past the team's runs per hour. The first round runs on the next request.
 */
export async function startRun(d: RunDeps, x: { repo: string; component: unknown; startedBy: string }): Promise<{ run: StoredRun; existing: boolean }> {
  const component = typeof x.component === 'string' ? x.component.trim() : '';
  if (!COMPONENT.test(component)) throw new HttpError(400, 'bad_request', RUN_WORDS.badComponent);
  const repo = lc(x.repo);
  if (!(await d.claudeKey(repo))) throw new HttpError(409, 'not_connected', RUN_WORDS.notConnected);
  const activeId = await d.redis.cmd('GET', activeKey(repo, component));
  if (typeof activeId === 'string') {
    const prev = await getRun(d.redis, repo, activeId);
    if (prev && !FINAL.includes(prev.status)) return { run: prev, existing: true };
  }
  const now = d.now();
  const cap = d.runsPerHour ?? DEFAULT_RUNS_PER_HOUR;
  const [n] = await d.redis.pipe([['INCRBY', startedKey(repo, now), 1], ['EXPIRE', startedKey(repo, now), 3600]]);
  if (Number(n) > cap) {
    await d.redis.cmd('INCRBY', startedKey(repo, now), -1);
    throw new HttpError(429, 'limit', RUN_WORDS.tooMany(cap), {}, { 'Retry-After': '3600' });
  }
  const id = Buffer.from((d.random ?? ((k) => randomBytes(k)))(8)).toString('hex');
  // One run per component: a second ask while this one runs gets this one.
  const took = await d.redis.cmd('SET', activeKey(repo, component), id, 'NX', 'EX', ACTIVE_TTL_S);
  if (took === null) {
    const other = await d.redis.cmd('GET', activeKey(repo, component));
    const prev = typeof other === 'string' ? await getRun(d.redis, repo, other) : null;
    await d.redis.cmd('INCRBY', startedKey(repo, now), -1);
    if (prev) return { run: prev, existing: true };
    throw new HttpError(409, 'busy', RUN_WORDS.already(component));
  }
  const at = new Date(now).toISOString();
  const run: StoredRun = { v: 1, id, repo, component, status: 'queued', loop: null, ref: null, startedBy: x.startedBy, createdAt: at, updatedAt: at, retries: 0 };
  await d.redis.pipe([
    ['SET', runKey(repo, id), JSON.stringify(run), 'EX', RUN_TTL_S],
    ['ZADD', runsKey(repo), now, id],
  ]);
  return { run, existing: false };
}

// ---------------------------------------------------------------------------------------------------------------
// One step

/** A failed call to the Messages API, by status (0: network or timeout). */
export class ClaudeCallError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ClaudeCallError';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ClaudeCallError(0, 'Claude did not answer in time.')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** The Messages API with the team's key; the key goes to api.anthropic.com only. A refused or cut reply reads as empty. */
export function anthropicAsk(f: FetchLike, apiKey: string): (prompt: string) => Promise<string> {
  return async (prompt) => {
    const req = engine.anthropicRequest({ apiKey, prompt, model: engine.FIX_LOOP_MODEL, maxTokens: MAX_TOKENS });
    let res: Response;
    try {
      res = await withTimeout(f(req.url, { method: req.init.method, headers: req.init.headers, body: req.init.body }), CLAUDE_TIMEOUT_MS);
    } catch (e) {
      throw e instanceof ClaudeCallError ? e : new ClaudeCallError(0, 'Claude did not answer.');
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: unknown } };
    if (!res.ok) throw new ClaudeCallError(res.status, typeof body.error?.message === 'string' ? body.error.message.slice(0, 300) : `Anthropic API ${res.status}`);
    try {
      return engine.anthropicReplyText(body);
    } catch {
      // Declined or cut off: the round counts, and the next one is told to answer with fix objects only.
      return '';
    }
  };
}

const transient = (s: number) => s === 0 || s === 408 || s === 409 || s === 429 || s >= 500;

const NO_RETRY = { attempts: 1, baseDelayMs: 0, sleep: async () => {} };
type CoreFetch = ConstructorParameters<typeof engine.GitHubClient>[2];
const coreFetch = (f: FetchLike): CoreFetch => ((url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  f(url, { method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body !== undefined ? { body: init.body } : {}) })) as CoreFetch;

/** A file of the repository at a ref (the raw media type: no 1 MB limit), or null when it is not there. */
async function readFile(f: FetchLike, token: string, owner: string, repo: string, path: string, ref: string): Promise<string | null> {
  let res: Response;
  try {
    res = await f(`https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-claude', 'X-GitHub-Api-Version': '2022-11-28' },
    });
  } catch {
    throw new StepError('github', 'GitHub did not answer while Bridge read the files.');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new StepError('github', `GitHub answered ${res.status} reading ${path}.`);
  return res.text();
}

async function ghJson(f: FetchLike, token: string, path: string): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await f(`https://api.github.com${path}`, { method: 'GET', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-claude', 'X-GitHub-Api-Version': '2022-11-28' } });
  } catch {
    throw new StepError('github', 'GitHub did not answer.');
  }
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** A step that cannot go on: `kind` picks the designer sentence, `developer` says why. */
class StepError extends Error {
  constructor(
    readonly kind: 'setup' | 'github',
    readonly developer: string,
  ) {
    super(developer);
  }
}

interface Files {
  input: GapCaseForInput;
  config: BridgeConfig;
  fixesPath: string;
}

async function loadFiles(d: RunDeps, token: string, owner: string, repo: string, component: string, ref: { sha: string; requests: string | null }): Promise<Files> {
  const read = (path: string, at: string) => readFile(d.fetch, token, owner, repo, path, at);
  const [measuredText, fixesText, configText, runLocal] = await Promise.all([
    read(engine.DEFAULT_MEASURED_SPECS_FILE, ref.sha),
    read(engine.DEFAULT_FIGMA_FIXES_FILE, ref.sha),
    read('bridge.config.json', ref.sha),
    read(engine.DEFAULT_FIDELITY_RUN_FILE, ref.sha),
  ]);
  if (!measuredText) throw new StepError('setup', `No ${engine.DEFAULT_MEASURED_SPECS_FILE} on the default branch: measure the stories first (bridge specs --measure --variants --shots).`);
  let measured: MeasuredSpecsFile;
  let fixes: FigmaFixesFile | undefined;
  let config: BridgeConfig;
  try {
    measured = engine.parseMeasuredSpecsFile(measuredText);
  } catch (e) {
    throw new StepError('setup', `${engine.DEFAULT_MEASURED_SPECS_FILE} does not read: ${(e as Error).message}.`);
  }
  try {
    fixes = fixesText ? engine.parseFigmaFixes(fixesText) : undefined;
  } catch (e) {
    throw new StepError('setup', `${engine.DEFAULT_FIGMA_FIXES_FILE} is invalid: ${(e as Error).message}. Fix it first (bridge fixes check).`);
  }
  try {
    config = configText ? engine.loadConfig(configText) : ({ governance: engine.DEFAULT_GOVERNANCE } as unknown as BridgeConfig);
  } catch (e) {
    throw new StepError('setup', `bridge.config.json is invalid: ${(e as Error).message}.`);
  }
  let run: FigmaFidelityRun | undefined;
  const runText = runLocal ?? (ref.requests ? await read(engine.DEFAULT_FIDELITY_RUN_FILE, ref.requests) : null);
  if (runText) {
    try {
      run = engine.parseFidelityRun(runText);
    } catch {
      run = undefined;
    }
  }
  return { input: { component, measured, fixes, run }, config, fixesPath: engine.DEFAULT_FIGMA_FIXES_FILE };
}

/** The default branch and its head, and the requests branch the plugin writes its Check fidelity run to. */
async function pin(d: RunDeps, token: string, owner: string, repo: string): Promise<{ base: string; sha: string; requests: string | null }> {
  const r = await ghJson(d.fetch, token, `/repos/${owner}/${repo}`);
  if (r.status !== 200 || typeof r.data?.default_branch !== 'string') throw new StepError('github', `GitHub answered ${r.status} reading the repository.`);
  const base = r.data.default_branch as string;
  const head = await ghJson(d.fetch, token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  if (head.status !== 200 || typeof head.data?.object?.sha !== 'string') throw new StepError('github', `GitHub answered ${head.status} reading ${base}.`);
  const req = await ghJson(d.fetch, token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(engine.REQUESTS_BRANCH)}`);
  return { base, sha: head.data.object.sha, requests: req.status === 200 && typeof req.data?.object?.sha === 'string' ? req.data.object.sha : null };
}

const lcName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const storyOf = (m: MeasuredSpecsFile, component: string) => m.stories.some((s) => lcName(s.title.split('/').at(-1) ?? '') === lcName(component));

const finish = (r: StoredRun, status: 'ready' | 'no-fix' | 'failed', extra: Partial<StoredRun> = {}): StoredRun => ({ ...r, ...extra, status });

/**
 * One step of a run: the first request pins the commit and checks there is a gap; each request then does one Claude
 * round; after the last round (or once every difference is resolved) the same request opens the draft pull request.
 * Never throws: whatever stops it becomes no-fix or failed, in designer words, with the cause for developers.
 */
export async function stepRun(d: RunDeps, run: StoredRun): Promise<StoredRun> {
  const [owner, repo] = run.repo.split('/') as [string, string];
  let r: StoredRun = { ...run };
  try {
    const token = await d.appToken(owner, repo);
    if (!token) return finish(r, 'failed', { reason: RUN_WORDS.setup, developer: 'The Bridge GitHub App is not installed on this repository with Contents and Pull requests: Read and write, or the server has no app keys (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY).' });
    const apiKey = await d.claudeKey(r.repo);
    if (!apiKey) return finish(r, 'failed', { reason: RUN_WORDS.notConnected });
    if (!r.ref) r.ref = await pin(d, token, owner, repo);
    const files = await loadFiles(d, token, owner, repo, r.component, r.ref);
    const kase = engine.gapCaseFor(files.input);
    const gap = kase.gap;
    if (!kase.spec && !storyOf(files.input.measured, r.component))
      return finish(r, 'failed', { reason: RUN_WORDS.setup, developer: `No measured story of ${r.component} in ${engine.DEFAULT_MEASURED_SPECS_FILE}: measure it (bridge specs --measure --variants --shots --only ${r.component}).` });
    if (!r.loop) {
      if (!gap.variants.length) return finish(r, 'no-fix', { reason: RUN_WORDS.nothing(r.component) });
      r.loop = engine.startFixLoop(r.component);
    }
    if (!r.loop.done) {
      const ask = (d.ask ?? ((k: string) => anthropicAsk(d.fetch, k)))(apiKey);
      try {
        r.loop = (await engine.fixLoopRound(files.input, r.loop, ask, gap)).state;
        r.retries = 0;
        r.status = 'running';
      } catch (e) {
        const s = e instanceof ClaudeCallError ? e.status : 0;
        const why = e instanceof ClaudeCallError ? `Anthropic API ${s || 'unreachable'}: ${e.message}` : 'Claude did not answer.';
        if (s === 401 || s === 403) return finish(r, 'failed', { reason: RUN_WORDS.keyRejected, developer: why });
        if (!transient(s)) return finish(r, 'failed', { reason: RUN_WORDS.account, developer: why });
        r.retries += 1;
        if (r.retries > MAX_RETRIES) return finish(r, 'failed', { reason: RUN_WORDS.busy, developer: why });
        r.status = 'running';
        return r;
      }
      if (!r.loop.done) return r;
    }
    return await propose(d, r, token, owner, repo);
  } catch (e) {
    if (e instanceof StepError) return finish(r, 'failed', { reason: e.kind === 'setup' ? RUN_WORDS.setup : RUN_WORDS.write, developer: e.developer });
    return finish(r, 'failed', { reason: RUN_WORDS.write, developer: e instanceof Error ? e.message.slice(0, 300) : 'Unexpected error.' });
  }
}

/** The closest fixes as a draft pull request (core figmaFixesProposal, the same change the CLI and MCP open). */
async function propose(d: RunDeps, r: StoredRun, token: string, owner: string, repo: string): Promise<StoredRun> {
  // The default branch may have moved during the rounds: the change is made on its head, and the referee runs again.
  const ref = await pin(d, token, owner, repo);
  const files = await loadFiles(d, token, owner, repo, r.component, ref);
  const gap = engine.gapCaseFor(files.input).gap;
  const outcome = engine.fixLoopOutcome(gap, r.loop!, (files.input.fixes?.fixes ?? []).map((f) => f.id));
  if (outcome.kind === 'status') return finish(r, 'no-fix', { reason: RUN_WORDS.noFixSentence(r.component), developer: `No round came closer in ${engine.FIX_LOOP_MAX_ROUNDS} rounds (values referee).` });
  let p: ReturnType<typeof engine.figmaFixesProposal>;
  try {
    p = engine.figmaFixesProposal({ ...files.input, proposed: outcome.fixes, summary: `${outcome.summary} Asked by ${r.startedBy}.`, config: files.config, fixesPath: files.fixesPath, tool: RUN_TOOL, source: RUN_SOURCE });
  } catch (e) {
    return finish(r, 'no-fix', { reason: RUN_WORDS.noFixSentence(r.component), developer: (e as Error).message });
  }
  if (p.status === 'blocked') return finish(r, 'no-fix', { reason: RUN_WORDS.noFixSentence(r.component), developer: p.why });
  const base = files.config.repo?.defaultBranch ?? ref.base;
  const gh = new engine.GitHubClient(`${owner}/${repo}`, token, coreFetch(d.fetch), NO_RETRY, {
    protectedBranches: [...new Set([base, ...files.config.governance.protectedBranches])],
    branchPrefix: files.config.governance.branchPrefix,
    etags: false,
  });
  let branch = p.branchStem;
  for (let i = 2; await gh.getBranchSha(branch); i++) branch = `${p.branchStem}-${i}`;
  await gh.commitToNewBranch({ base, branch, message: p.message, files: p.fileContents });
  const pr = await gh.createPullRequest({ base, head: branch, title: p.title, body: p.prBody, draft: p.draft });
  await gh.addLabels(pr.number, p.labels);
  return finish(r, 'ready', { ref, pr: { number: pr.number, url: pr.url, draft: pr.draft }, applied: p.fixes.map((f) => f.reason) });
}

/**
 * Moves a run one step when it is not final and no other request works on it, and answers where it stands. A final
 * run, or one another request holds, is answered as stored.
 */
export async function advanceRun(d: RunDeps, repo: string, id: string): Promise<StoredRun | null> {
  const run = await getRun(d.redis, repo, id);
  if (!run || FINAL.includes(run.status)) return run;
  const took = await d.redis.cmd('SET', leaseKey(repo, id), '1', 'NX', 'EX', LEASE_TTL_S);
  if (took === null) return run;
  try {
    const next = await stepRun(d, run);
    const out = { ...next, updatedAt: new Date(d.now()).toISOString() };
    await putRun(d.redis, out);
    return out;
  } finally {
    await d.redis.cmd('DEL', leaseKey(repo, id)).catch(() => 0);
  }
}
