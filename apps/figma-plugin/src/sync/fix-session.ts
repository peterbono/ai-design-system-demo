// While the team's Claude fixes a component, what it is doing: the real steps Bridge records from Claude's calls to the
// Bridge connector (docs/FIGMA-FIXES.md, "Work in progress: fix sessions", Contract). When the read is not available
// (offline, the site down), the plugin falls back to watching GitHub for the fix (claude-connector.ts findFix) and the
// row says "Waiting for Claude".

export const FIX_SESSION_PATH = '/api/fix-sessions';

/** One step, in designer words: `label` is shown as is ("Claude read the differences (12)"). */
export interface SessionStep {
  label: string;
  /** current: the last step while working; failed: refused, stopped, quiet. */
  status: 'done' | 'current' | 'failed';
  kind?: 'read' | 'try' | 'proposed' | 'refused' | 'stopped' | 'quiet' | undefined;
  at: string;
  /** Who triggered it (a name). */
  by?: string | undefined;
  round?: number | undefined;
}

/** SessionView of the contract, with only what the designer reads. */
export interface FixSession {
  component: string;
  /** waiting: no session yet for this component. */
  state: 'waiting' | 'working' | 'ready' | 'stopped';
  startedAt: string | null;
  updatedAt: string | null;
  /** Seconds since it started (to the last step once ready, stopped or quiet). */
  elapsed: number;
  /** Working, but no step for 10 minutes: "Claude went quiet" (the state stays working; a new step resumes it). */
  quiet: boolean;
  /** stopped: Claude's reason, without "Claude stopped: ". */
  reason?: string | undefined;
  pr?: { number: number; url: string } | undefined;
  round?: number | undefined;
  maxRounds: number;
  steps: SessionStep[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const STATES = ['waiting', 'working', 'ready', 'stopped'] as const;
const STEP_STATUS = ['done', 'current', 'failed'] as const;
const KINDS = ['read', 'try', 'proposed', 'refused', 'stopped', 'quiet'] as const;

/** The contract's SessionView, keeping only what the designer reads (never anything else the server adds). */
export function parseSession(x: unknown): FixSession | undefined {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o.component !== 'string' || !(STATES as readonly string[]).includes(String(o.state))) return undefined;
  const steps = Array.isArray(o.steps)
    ? o.steps.flatMap((s): SessionStep[] => {
        const r = s as Record<string, unknown>;
        if (typeof r?.label !== 'string' || !(STEP_STATUS as readonly string[]).includes(String(r.status))) return [];
        return [
          {
            label: r.label,
            status: r.status as SessionStep['status'],
            ...((KINDS as readonly string[]).includes(String(r.kind)) ? { kind: r.kind as SessionStep['kind'] } : {}),
            at: str(r.at),
            ...(typeof r.by === 'string' ? { by: r.by } : {}),
            ...(typeof r.round === 'number' ? { round: r.round } : {}),
          },
        ];
      })
    : [];
  const pr = o.pr as { number?: unknown; url?: unknown } | undefined;
  return {
    component: o.component,
    state: o.state as FixSession['state'],
    startedAt: typeof o.startedAt === 'string' ? o.startedAt : null,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
    elapsed: typeof o.elapsed === 'number' && Number.isFinite(o.elapsed) ? o.elapsed : 0,
    quiet: o.quiet === true,
    ...(typeof o.reason === 'string' && o.reason ? { reason: o.reason.replace(/^Claude stopped:\s*/i, '') } : {}),
    ...(pr && typeof pr.url === 'string' ? { pr: { number: Number(pr.number), url: pr.url } } : {}),
    ...(typeof o.round === 'number' ? { round: o.round } : {}),
    maxRounds: typeof o.maxRounds === 'number' ? o.maxRounds : 3,
    steps,
  };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The session for a component, or undefined when the read is not available (the row falls back to the GitHub watch). */
export async function readFixSession(f: Fetch, origin: string, token: string, repo: string, component: string): Promise<FixSession | undefined> {
  try {
    const res = await f(`${origin}${FIX_SESSION_PATH}?repo=${encodeURIComponent(repo)}&component=${encodeURIComponent(component)}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return undefined;
    const body = (await res.json().catch(() => undefined)) as { session?: unknown } | undefined;
    return parseSession(body?.session);
  } catch {
    return undefined;
  }
}

/** "4 min", "1 h 5 min", "just started", from the session's own elapsed seconds. */
export function elapsedText(seconds: number): string {
  const min = Math.floor(seconds / 60);
  if (min < 1) return 'just started';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** The row's head, in one line. Quiet comes from the server's flag, never as a stop. */
export function sessionHead(s: FixSession | undefined, component: string): { kind: 'waiting' | 'working' | 'ready' | 'stopped' | 'quiet'; text: string } {
  if (!s || s.state === 'waiting' || (s.state === 'working' && !s.steps.length && !s.quiet)) return { kind: 'waiting', text: 'Waiting for Claude' };
  if (s.state === 'ready') return { kind: 'ready', text: "Claude's fix is ready" };
  if (s.state === 'stopped') return { kind: 'stopped', text: `${FIX_ROW_WORDS.cantFix}${s.reason ?? FIX_ROW_WORDS.noCloser}` };
  // Claude did something, then nothing more reached Bridge: its last reply is in the chat. Not "went quiet": that is
  // for an ask nothing ever came back from.
  if (s.quiet) return { kind: 'quiet', text: FIX_ROW_WORDS.unfinished };
  const round = s.round ? `, round ${s.round} of up to ${s.maxRounds}` : '';
  return { kind: 'working', text: `Claude is working on ${component} · ${elapsedText(s.elapsed)}${round}` };
}

/** An ask nothing came back from for this long (no step at all): "Claude went quiet", not an endless wait. */
export const NOTHING_BACK_MS = 30 * 60 * 1000;

export const FIX_ROW_WORDS = {
  cantFix: "Claude can't fix this one: ",
  noCloser: 'no fix brought it closer to the code.',
  unfinished: "Claude didn't finish this one",
  unfinishedHint: 'Its last reply is in your Claude chat. Open Claude again to pick it up.',
  quiet: 'Claude went quiet',
  quietHint: 'Nothing came back from Claude for this one.',
  cantFixHead: "Claude can't fix this one",
  noMeasure: "Claude can't fix this one yet",
  noMeasureHint: "Bridge hasn't measured it in code. A developer measures it once, then Claude can compare it.",
  inFile: "Claude's fix is in this file. Compare with code to check it.",
  approved: "Claude's fix is approved. Check for updates brings it into this file.",
  notKept: "Claude's fix was not kept. Nothing changes in this file.",
} as const;

/**
 * Where one row of Claude's fixes stands, one status: from the session Bridge recorded, Claude's fix on GitHub and what
 * became of it (approved and brought into this file, approved, not kept), and the measure.
 */
export type FixRowKind = 'waiting' | 'working' | 'ready' | 'quiet' | 'unfinished' | 'cant-fix' | 'no-measure' | 'approved' | 'in-file' | 'not-kept';

export interface FixRowInput {
  session?: FixSession | undefined;
  /** Claude's fix, open for review on GitHub. */
  openPr?: { number: number; url: string } | undefined;
  /** What became of the fix's pull request once closed: merged (approved) or closed without merging (not kept). */
  outcome?: { state: 'merged' | 'closed'; mergedAt?: string | undefined } | undefined;
  /** When this file last brought in the design system (Check for updates, applied). */
  lastPullAt?: string | undefined;
  askedAt?: string | undefined;
  /** false: the measure the plugin read has no story of this component; undefined: not known. */
  measured?: boolean | undefined;
  now: number;
}

/** Finished: nothing left to do for this row in Claude (the row stays one calm line). */
export const FINISHED_ROWS: readonly FixRowKind[] = ['in-file', 'not-kept'];

export function fixRow(component: string, i: FixRowInput): { kind: FixRowKind; text: string; hint?: string } {
  const s = i.session;
  // Bridge recorded that it has no measure of it (the gap case could not be read): said the plugin's way, with its step.
  if (s?.state === 'stopped' && /hasn't measured/i.test(s.reason ?? '')) return { kind: 'no-measure', text: FIX_ROW_WORDS.noMeasure, hint: FIX_ROW_WORDS.noMeasureHint };
  // The head says it in a few words; Claude's reason, the designer's next step, reads under it.
  if (s?.state === 'stopped') {
    const why = s.reason ?? FIX_ROW_WORDS.noCloser;
    return { kind: 'cant-fix', text: FIX_ROW_WORDS.cantFixHead, hint: why.charAt(0).toUpperCase() + why.slice(1) };
  }
  if (i.outcome?.state === 'merged') {
    const inFile = !!i.lastPullAt && !!i.outcome.mergedAt && Date.parse(i.lastPullAt) >= Date.parse(i.outcome.mergedAt);
    return inFile ? { kind: 'in-file', text: FIX_ROW_WORDS.inFile } : { kind: 'approved', text: FIX_ROW_WORDS.approved };
  }
  if (i.outcome?.state === 'closed') return { kind: 'not-kept', text: FIX_ROW_WORDS.notKept };
  if (i.openPr || s?.state === 'ready') return { kind: 'ready', text: "Claude's fix is ready" };
  const started = s && s.state === 'working' && (s.steps.length > 0 || s.quiet);
  if (!started && i.measured === false) return { kind: 'no-measure', text: FIX_ROW_WORDS.noMeasure, hint: FIX_ROW_WORDS.noMeasureHint };
  if (started && s.quiet) return { kind: 'unfinished', text: FIX_ROW_WORDS.unfinished, hint: FIX_ROW_WORDS.unfinishedHint };
  if (started) return { kind: 'working', text: sessionHead(s, component).text };
  if (i.askedAt && i.now - Date.parse(i.askedAt) > NOTHING_BACK_MS) return { kind: 'quiet', text: FIX_ROW_WORDS.quiet, hint: FIX_ROW_WORDS.quietHint };
  return { kind: 'waiting', text: 'Waiting for Claude' };
}

/** The section's summary, in one sentence: "9 fixes in this file, 10 need drawing in Figma, 8 waiting." */
type SummaryRow = { kind: FixRowKind; text: string; hint?: string | undefined };
export function fixRowsSummary(rows: readonly SummaryRow[]): string {
  const count = (f: (r: SummaryRow) => boolean) => rows.filter(f).length;
  const drawing = (r: SummaryRow) => r.kind === 'cant-fix' && /missing in Figma/i.test(r.hint ?? '');
  const parts: [number, string][] = [
    [count((r) => r.kind === 'ready'), 'ready for review'],
    [count((r) => r.kind === 'approved'), 'approved'],
    [count((r) => r.kind === 'in-file'), ''],
    [count(drawing), 'drawing'],
    [count((r) => r.kind === 'cant-fix' && !drawing(r)), "Claude can't fix"],
    [count((r) => r.kind === 'no-measure'), 'not measured yet'],
    [count((r) => r.kind === 'working'), 'in progress'],
    [count((r) => r.kind === 'waiting'), 'waiting'],
    [count((r) => r.kind === 'quiet' || r.kind === 'unfinished'), "didn't finish"],
    [count((r) => r.kind === 'not-kept'), 'not kept'],
  ];
  const words = parts
    .filter(([k]) => k > 0)
    .map(([k, w]) => (w === '' ? `${k} ${k === 1 ? 'fix' : 'fixes'} in this file` : w === 'drawing' ? `${k} ${k === 1 ? 'needs' : 'need'} drawing in Figma` : `${k} ${w}`));
  return words.length ? `${words.join(', ')}.` : '';
}
