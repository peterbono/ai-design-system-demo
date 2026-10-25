// Fix sessions: what the team's Claude does on one component, step by step, while it fixes it through the hosted Bridge
// connector (api/mcp, docs/FIGMA-FIXES.md "Work in progress"). Every step is a real Bridge tool call Claude made, recorded
// when it returns: nothing is guessed, there is no percentage (rounds vary), and when no step comes for a while the
// session says Claude went quiet instead of inventing progress.
//
//   bridge_get_gap_case        "Claude read the differences (N)"          starts a session (or a new one after the last ended)
//   bridge_try_figma_fix       "Claude tried a fix (round n): closer | no change | further away"
//   bridge_propose_figma_fixes "Claude opened its fix for review"         ready, with the pull request and the review link
//                              "Claude stopped: <reason>"                 a status fix (no fix came closer): stopped
//                              "Bridge did not open it: <reason>"         the referee refused it: still working
//
// Keys (Upstash Redis; repository lower case, component as letters and digits):
//   bridge:fix:session:<repo>:<component>   the session (JSON), 7 days after its last step
//   bridge:fix:sessions:<repo>              sorted set of components by last step time (ms)
// Who: the signed-in person of the connector grant (a name, never an email). Nothing here logs.

import type { Redis } from './redis.js';

export type SessionState = 'waiting' | 'working' | 'ready' | 'stopped';

export interface FixStep {
  kind: 'read' | 'try' | 'proposed' | 'refused' | 'stopped' | 'quiet';
  /** One sentence in designer words. */
  text: string;
  at: string;
  /** Who triggered it (the person signed in to the connector). */
  by: string;
  round?: number;
  /** try: the values referee's verdict. */
  verdict?: 'closer' | 'same' | 'worse' | 'invalid';
  /** read: how many differences. */
  differences?: number;
  /** proposed: the draft pull request, and where Studio reviews it (a path under the team's Studio). */
  pr?: { number: number; url: string };
  review?: string;
  /** stopped: the reason Claude gave. */
  reason?: string;
}

export interface FixSession {
  v: 1;
  repo: string;
  component: string;
  startedAt: string;
  updatedAt: string;
  steps: FixStep[];
  /** Where it ended: ready (a fix for review) or stopped (Claude gave up honestly). Null while working. */
  ended: 'ready' | 'stopped' | null;
}

export const SESSION_TTL_S = 7 * 24 * 60 * 60;
/** No step for this long while working: Claude went quiet. */
export const QUIET_AFTER_MS = 10 * 60 * 1000;
const MAX_STEPS = 60;

const lc = (s: string) => s.trim().toLowerCase();
const slug = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');
export const sessionKey = (repo: string, component: string) => `bridge:fix:session:${lc(repo)}:${slug(component)}`;
export const sessionsKey = (repo: string) => `bridge:fix:sessions:${lc(repo)}`;

export const STEP_WORDS = {
  read: (n: number) => `Claude read the differences (${n})`,
  try: (round: number, verdict: 'closer' | 'same' | 'worse' | 'invalid') =>
    verdict === 'invalid' ? `Claude tried a fix (round ${round}): Bridge could not check it` : `Claude tried a fix (round ${round}): ${verdict === 'closer' ? 'closer' : verdict === 'worse' ? 'further away' : 'no change'}`,
  proposed: 'Claude opened its fix for review',
  refused: (why: string) => `Bridge did not open it: ${why}`,
  stopped: (why: string) => `Claude stopped: ${why}`,
  quiet: 'Claude went quiet',
} as const;

function parse(raw: unknown): FixSession | null {
  if (typeof raw !== 'string') return null;
  try {
    const s = JSON.parse(raw) as FixSession;
    return s && s.v === 1 && Array.isArray(s.steps) && typeof s.component === 'string' ? s : null;
  } catch {
    return null;
  }
}

export async function getSession(redis: Redis, repo: string, component: string): Promise<FixSession | null> {
  return parse(await redis.cmd('GET', sessionKey(repo, component)));
}

async function put(redis: Redis, s: FixSession, now: number): Promise<void> {
  await redis.pipe([
    ['SET', sessionKey(s.repo, s.component), JSON.stringify(s), 'EX', SESSION_TTL_S],
    ['ZADD', sessionsKey(s.repo), now, slug(s.component)],
  ]);
}

/** A session as people read it: its state, and "Claude went quiet" when nothing came for QUIET_AFTER_MS. */
export interface SessionView {
  component: string;
  /** waiting: no session for this component yet. Went quiet keeps "working" with `quiet: true` and a last step that says it. */
  state: SessionState;
  startedAt: string | null;
  /** The last real step. */
  updatedAt: string | null;
  /** Seconds from the first step to the last one (or to now while working). */
  elapsed: number;
  /** Each step also carries `label` (= text) and `status` (done, current or failed), as the Figma plugin reads them. */
  steps: (FixStep & { label: string; status: 'done' | 'current' | 'failed' })[];
  /** No step for QUIET_AFTER_MS while working. */
  quiet: boolean;
  /** stopped: the reason, without "Claude stopped: " (the plugin adds it). */
  reason?: string;
  /** ready (and a stopped status fix): the draft pull request. */
  pr?: { number: number; url: string };
  /** The rounds tried so far, of up to maxRounds. */
  round?: number;
  maxRounds: number;
}

/** Rounds per component before Claude proposes an honest status instead (core FIX_LOOP_MAX_ROUNDS). */
export const MAX_ROUNDS = 3;

export function sessionView(s: FixSession | null, component: string, now: number): SessionView {
  if (!s) return { component, state: 'waiting', startedAt: null, updatedAt: null, elapsed: 0, steps: [], quiet: false, maxRounds: MAX_ROUNDS };
  const last = Date.parse(s.updatedAt);
  const start = Date.parse(s.startedAt);
  const quiet = !s.ended && now - last > QUIET_AFTER_MS;
  const raw: FixStep[] = quiet ? [...s.steps, { kind: 'quiet', text: STEP_WORDS.quiet, at: new Date(last + QUIET_AFTER_MS).toISOString(), by: s.steps.at(-1)?.by ?? '' }] : s.steps;
  const failed = (x: FixStep) => x.kind === 'refused' || x.kind === 'quiet' || x.kind === 'stopped' || x.verdict === 'invalid';
  const steps = raw.map((x, i) => ({ ...x, label: x.text, status: failed(x) ? ('failed' as const) : !s.ended && !quiet && i === raw.length - 1 ? ('current' as const) : ('done' as const) }));
  const tries = s.steps.filter((x) => x.kind === 'try').length;
  const end = s.steps.at(-1);
  const pr = [...s.steps].reverse().find((x) => x.pr)?.pr;
  return {
    component: s.component,
    state: s.ended ?? 'working',
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
    elapsed: Math.max(0, Math.round(((s.ended || quiet ? last : now) - start) / 1000)),
    steps,
    quiet,
    ...(s.ended === 'stopped' && end?.reason ? { reason: end.reason } : {}),
    ...(pr ? { pr } : {}),
    ...(tries ? { round: tries } : {}),
    maxRounds: MAX_ROUNDS,
  };
}

/** The team's sessions of the last 7 days, newest first (at most 20). */
export async function listSessions(redis: Redis, repo: string, now: number): Promise<FixSession[]> {
  const [, ids] = await redis.pipe([
    ['ZREMRANGEBYSCORE', sessionsKey(repo), '-inf', now - SESSION_TTL_S * 1000],
    ['ZRANGE', sessionsKey(repo), 0, -1],
  ]);
  const list = (Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []).reverse().slice(0, 20);
  if (!list.length) return [];
  const raw = (await redis.cmd('MGET', ...list.map((c) => `bridge:fix:session:${lc(repo)}:${c}`))) as unknown[] | null;
  return list.map((_, i) => parse(raw?.[i])).filter((s): s is FixSession => Boolean(s));
}

// ---------------------------------------------------------------------------------------------------------------
// Recording, from one tool call and its result

export interface ToolCallRecord {
  repo: string;
  tool: string;
  args: Record<string, unknown>;
  /** The tool's JSON result (the text content parsed), or null when the call failed. */
  result: Record<string, unknown> | null;
  by: string;
  now: number;
}

const FIX_TOOLS = new Set(['bridge_get_gap_case', 'bridge_try_figma_fix', 'bridge_propose_figma_fixes']);
export const recordsSteps = (tool: string) => FIX_TOOLS.has(tool);

/** The step one call adds, or null (a failed call, another tool). Pure: tests read it. */
export function stepOf(c: ToolCallRecord, session: FixSession | null): FixStep | null {
  const r = c.result;
  if (!r || !recordsSteps(c.tool)) return null;
  const at = new Date(c.now).toISOString();
  if (c.tool === 'bridge_get_gap_case') {
    const variants = Array.isArray((r.gap as { variants?: unknown })?.variants) ? ((r.gap as { variants: { differences?: unknown[] }[] }).variants) : [];
    const n = variants.reduce((k, v) => k + (Array.isArray(v.differences) ? v.differences.length : 0), 0);
    return { kind: 'read', text: STEP_WORDS.read(n), at, by: c.by, differences: n };
  }
  if (c.tool === 'bridge_try_figma_fix') {
    const round = (session && !session.ended ? session.steps.filter((s) => s.kind === 'try').length : 0) + 1;
    const verdict = r.status === 'invalid' ? 'invalid' : r.verdict === 'closer' || r.verdict === 'worse' ? r.verdict : 'same';
    return { kind: 'try', text: STEP_WORDS.try(round, verdict), at, by: c.by, round, verdict };
  }
  // bridge_propose_figma_fixes
  const fixes = Array.isArray(c.args.fixes) ? (c.args.fixes as { kind?: unknown; reason?: unknown }[]) : [];
  const statusOnly = fixes.length > 0 && fixes.every((f) => f.kind === 'status');
  if (r.status === 'blocked') {
    const why = typeof r.why === 'string' ? r.why.replace(/\s+/g, ' ').trim() : 'it does not bring the component closer to the code.';
    return { kind: 'refused', text: STEP_WORDS.refused(why), at, by: c.by };
  }
  if (r.status !== 'pr-opened' || typeof r.pr !== 'number' || typeof r.url !== 'string') return null;
  const pr = { number: r.pr, url: r.url };
  const review = `changes/?pr=${r.pr}`;
  if (statusOnly) {
    const reason = typeof fixes[0]?.reason === 'string' ? fixes[0].reason : 'no fix brought it closer to the code.';
    return { kind: 'stopped', text: STEP_WORDS.stopped(reason), at, by: c.by, pr, review, reason };
  }
  return { kind: 'proposed', text: STEP_WORDS.proposed, at, by: c.by, pr, review };
}

/**
 * Records one tool call. bridge_get_gap_case starts a session when there is none or the last one ended; the other two
 * add to a session in progress (or start one: Claude may skip the gap case). Never throws: a step is a nicety, the
 * tool's answer already went back to Claude.
 */
export async function recordToolCall(redis: Redis, c: ToolCallRecord): Promise<FixSession | null> {
  try {
    const component = typeof c.args.component === 'string' ? c.args.component.trim() : '';
    if (!component || !recordsSteps(c.tool) || !c.result) return null;
    const prev = await getSession(redis, c.repo, component);
    // A gap case read after Claude went quiet starts over; read again mid-session, it is one more step.
    const quiet = prev ? c.now - Date.parse(prev.updatedAt) > QUIET_AFTER_MS : false;
    const fresh = !prev || prev.ended !== null || (c.tool === 'bridge_get_gap_case' && quiet);
    const step = stepOf(c, fresh ? null : prev);
    if (!step) return null;
    const at = new Date(c.now).toISOString();
    const base: FixSession = fresh ? { v: 1, repo: c.repo.toLowerCase(), component, startedAt: at, updatedAt: at, steps: [], ended: null } : prev!;
    const s: FixSession = {
      ...base,
      updatedAt: at,
      steps: [...base.steps, step].slice(-MAX_STEPS),
      ended: step.kind === 'proposed' ? 'ready' : step.kind === 'stopped' ? 'stopped' : null,
    };
    await put(redis, s, c.now);
    return s;
  } catch {
    return null;
  }
}
