// Studio, Being built: Claude's fixes (components/ds/studio/ClaudeFixes.tsx). The runs of the team's connected Claude
// (api/claude, docs/FIGMA-FIXES.md "Claude runs it for the team"), in designer words. Pure, so tests read it.
//
// True copy (settled rule "Claude copy must be true"): Claude proposes, someone on the team reviews, nothing ships on its
// own. The status words come from the server (RunView label and sentence) so the plugin and Studio say the same thing;
// a designer never reads `developer`.

export type ClaudeRunStatus = 'queued' | 'running' | 'ready' | 'no-fix' | 'failed';

/** What Studio keeps of a run the server answered (api/_lib/fix-runs.ts RunView). */
export interface ClaudeRun {
  id: string;
  component: string;
  status: ClaudeRunStatus;
  label: string;
  sentence: string;
  startedBy: string;
  createdAt: string;
  /** ready: the Studio path of the review ("changes/?pr=91"). */
  review: string | null;
  /** Not final: ask again after about this many seconds. */
  retryAfter: number;
}

export const CLAUDE_FIXES_WORDS = {
  title: "Claude's fixes",
  intro: "Fixes your team's Claude proposes for components that differ in Figma. Someone on your team reviews each one.",
  see: "See Claude's fix",
  listLabel: "Claude's fixes",
} as const;

const STATUSES: readonly ClaudeRunStatus[] = ['queued', 'running', 'ready', 'no-fix', 'failed'];
export const isFinal = (s: ClaudeRunStatus) => s === 'ready' || s === 'no-fix' || s === 'failed';

/** A run as the server sent it, or null when it does not read (never trusts more than it shows). */
export function parseRun(v: unknown): ClaudeRun | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[a-f0-9]{16}$/.test(r.id)) return null;
  if (typeof r.component !== 'string' || !STATUSES.includes(r.status as ClaudeRunStatus)) return null;
  const review = typeof r.review === 'string' && /^changes\/\?pr=\d{1,10}$/.test(r.review) ? r.review : null;
  return {
    id: r.id,
    component: r.component,
    status: r.status as ClaudeRunStatus,
    label: typeof r.label === 'string' ? r.label : '',
    sentence: typeof r.sentence === 'string' ? r.sentence : '',
    startedBy: typeof r.startedBy === 'string' ? r.startedBy : '',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    review,
    retryAfter: typeof r.retryAfter === 'number' && r.retryAfter > 0 ? Math.min(60, r.retryAfter) : 3,
  };
}

/** The one status tag after the text: in progress info, ready success, the rest neutral or a calm warning. */
export function runPill(r: Pick<ClaudeRun, 'status' | 'label'>): { label: string; tone: 'info' | 'success' | 'neutral' | 'warning' } {
  const tone = r.status === 'ready' ? 'success' : r.status === 'failed' ? 'warning' : r.status === 'no-fix' ? 'neutral' : 'info';
  return { label: r.label, tone };
}

/** The component's slug in Studio Components (?c=): TextInput -> text-input. */
export const componentSlug = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Where a row goes: the review of Claude's fix when it is ready, else the component in Studio. */
export const runRoute = (r: Pick<ClaudeRun, 'review' | 'component'>) => r.review ?? `components/?c=${encodeURIComponent(componentSlug(r.component))}`;

/** The row's line: the sentence, and who asked. */
export const runLine = (r: Pick<ClaudeRun, 'sentence' | 'startedBy'>) => (r.startedBy ? `${r.sentence} Asked by ${r.startedBy}.` : r.sentence);

/** At most this many rows; the newest first (the server's order). */
export const MAX_ROWS = 5;
/** More ready fixes than this: no row links, the rows open the review themselves (Bridge review rows rule). */
export const MAX_ROW_LINKS = 3;
