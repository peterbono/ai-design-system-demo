// Check the build (board R4): once the developers' pull request on a design copy exploration's task is ready, the
// designer and the product manager of its product say whether the build matches what was approved (the design lead
// too when the exploration sent pieces to the library). Bridge keeps who said what on which commit, server side, so an
// approval falls only when the developer pushes after it, and says where it stands on the pull request's head as the
// "Design check" commit status (api/contribute, actions build-state and build-word).
//
// Key (Upstash Redis, 90 days, refreshed on each word):
//   bridge:build:<owner/repo of the developers>:<pull number>   JSON { words: BuildWord[] }, oldest first, the last 60
// The server copy of what it needs from core and lib/review-state (the API does not import core).
import type { Redis } from './redis.js';
import { canonicalRepo } from '../../src/lib/team-path.js';

export type BuildRole = 'designer' | 'pm' | 'lead';
export type BuildKind = 'looks-right' | 'changes';
/** Needs changes: the build does not match ("build"), or the design itself must change ("design"). */
export type BuildWhy = 'build' | 'design';

export interface BuildWord {
  role: BuildRole;
  /** A GitHub login, when they have one. */
  by?: string;
  byName: string;
  kind: BuildKind;
  why?: BuildWhy;
  text?: string;
  /** The head commit of the developers' pull request it was said on. */
  sha: string;
  at: string;
}

export const DESIGN_CHECK = 'Design check';
export const BUILD_KEEP_S = 90 * 24 * 60 * 60;
const MAX_WORDS = 60;

export const buildKey = (repo: string, pull: number) => `bridge:build:${repo.toLowerCase()}:${pull}`;

/** Who must check, and their names, as the exploration said at its last read: the lists read the state without it. */
export interface BuildNeed {
  pm: boolean;
  lead: boolean;
  names?: { designer?: string; pm?: string };
}

export interface BuildRecord {
  words: BuildWord[];
  need?: BuildNeed;
}

export async function buildRecordOf(redis: Redis, repo: string, pull: number): Promise<BuildRecord> {
  const raw = await redis.cmd('GET', buildKey(repo, pull));
  try {
    const v = typeof raw === 'string' ? (JSON.parse(raw) as { words?: unknown; need?: BuildNeed }) : null;
    const words = Array.isArray(v?.words) ? (v.words as BuildWord[]).filter((w) => w && typeof w.sha === 'string' && typeof w.role === 'string') : [];
    return { words, ...(v?.need && typeof v.need.pm === 'boolean' ? { need: v.need } : {}) };
  } catch {
    return { words: [] };
  }
}

export async function buildWordsOf(redis: Redis, repo: string, pull: number): Promise<BuildWord[]> {
  return (await buildRecordOf(redis, repo, pull)).words;
}

/** The record with one more word (when given) and who must check now. */
export async function saveBuild(redis: Redis, repo: string, pull: number, need: BuildNeed, w?: BuildWord): Promise<BuildWord[]> {
  const was = await buildRecordOf(redis, repo, pull);
  const words = (w ? [...was.words, w] : was.words).slice(-MAX_WORDS);
  await redis.cmd('SET', buildKey(repo, pull), JSON.stringify({ words, need }), 'EX', BUILD_KEEP_S);
  return words;
}

export async function addBuildWord(redis: Redis, repo: string, pull: number, w: BuildWord): Promise<BuildWord[]> {
  return saveBuild(redis, repo, pull, (await buildRecordOf(redis, repo, pull)).need ?? { pm: false, lead: false }, w);
}

/** What the lists show (Being built, Home, Changes): who is still waiting, or who asked for changes, by name. */
export function buildSummary(st: BuildState, names: BuildNeed['names'] = {}): { state: BuildState['state']; waiting: string[]; changesBy: string | null } {
  const nameOf = (r: BuildRow) => r.byName ?? (r.role === 'designer' ? names.designer : r.role === 'pm' ? names.pm : undefined) ?? (r.role === 'pm' ? 'the product manager' : r.role === 'lead' ? 'a design lead' : 'the designer');
  return {
    state: st.state,
    waiting: st.rows.filter((r) => r.required && r.state === 'waiting').map(nameOf),
    changesBy: st.rows.find((r) => r.state === 'changes')?.byName ?? null,
  };
}

/** Where the task is in the developers' repository, back in the exploration: Back to exploring's word (core). */
export const DESIGN_TASK_BACK_COMMENT_SERVER = 'The design team took this back to exploring. It comes back here when they say Done exploring again.';

/**
 * The exploration's body back to running for a new round (core withoutDoneExploring, then withDecision): the developer
 * section goes, the done marker and the lead's yes leave, it records when it runs again, and the reason is a decision of
 * the round. Null without a block.
 */
export function reopenedBody(body: string, d: { at: string; by?: string; byName: string; text: string }): string | null {
  const m = BLOCK.exec(body);
  if (!m) return null;
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(m[1]!) as Record<string, unknown>;
  } catch {
    return null;
  }
  const kept = body.replace(/### For developers[\s\S]*?(?=### |<!-- |$)/, '');
  for (const k of ['doneAt', 'doneSha', 'reopenedBy', 'doneByMember', 'leadOkBy']) delete e[k];
  e.reopenedAt = d.at;
  if (d.by) e.reopenedBy = d.by;
  const before = Array.isArray(e.decisions) ? (e.decisions as { kind?: unknown }[]).filter((x) => x && typeof x === 'object') : [];
  const round = 1 + before.filter((x) => x.kind === 'changes' || x.kind === 'take-back').length;
  e.decisions = [...before, { kind: 'take-back', at: d.at, round, ...(d.by ? { by: d.by } : {}), byName: d.byName, text: d.text }];
  const block = `<!-- ${MARK} ${JSON.stringify(e).replace(/-->/g, '--\\u003e')} -->`;
  const at = kept.search(BLOCK);
  return `${kept.slice(0, at).trim()}\n\n${kept.slice(at).replace(BLOCK, () => block).trim()}`.trim();
}

const MARK = 'bridge-exploration';
const BLOCK = new RegExp(`<!-- ${MARK} (\\{[\\s\\S]*?\\}) -->`);

export interface BuildRow {
  role: BuildRole;
  required: boolean;
  /** Their last word on the head commit, or waiting (nothing on this commit: a push after their word asks again). */
  state: BuildKind | 'waiting';
  byName?: string;
  text?: string;
  why?: BuildWhy;
  at?: string;
}

export interface BuildState {
  state: 'pending' | 'success' | 'failure';
  rows: BuildRow[];
  description: string;
}

/**
 * Where the check stands on `head`: failure as soon as someone asked for changes on it, success once everyone required
 * said it looks right on it, else pending. Words on an older commit count for nothing: the developer pushed since.
 */
export function buildStateOf(words: readonly BuildWord[], head: string, need: { pm: boolean; lead: boolean }): BuildState {
  const roles: BuildRole[] = ['designer', 'pm', 'lead'];
  const rows: BuildRow[] = roles
    .filter((r) => r === 'designer' || (r === 'pm' && need.pm) || r === 'lead')
    .map((role) => {
      const last = [...words].reverse().find((w) => w.role === role && w.sha === head);
      const required = role === 'designer' || (role === 'pm' && need.pm) || (role === 'lead' && need.lead);
      return last ? { role, required, state: last.kind, byName: last.byName, ...(last.text ? { text: last.text } : {}), ...(last.why ? { why: last.why } : {}), at: last.at } : { role, required, state: 'waiting' as const };
    })
    // A lead who is not needed and said nothing stays out of the list.
    .filter((r) => r.required || r.state !== 'waiting');
  const changes = rows.find((r) => r.state === 'changes');
  if (changes) return { state: 'failure', rows, description: `${changes.byName ?? 'Someone'} asked for changes` };
  const waiting = rows.filter((r) => r.required && r.state !== 'looks-right');
  if (!waiting.length) return { state: 'success', rows, description: 'The design team says it looks right' };
  return { state: 'pending', rows, description: `Waiting for ${waiting.map((r) => (r.role === 'pm' ? 'the product manager' : `the ${r.role}`)).join(' and ')}` };
}

/** The developers' task of an exploration: its issue URL, owner/name and number. */
export function taskOfUrl(url: unknown): { repo: string; number: number } | null {
  const m = typeof url === 'string' ? /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?$/.exec(url.trim()) : null;
  // Under its current name: a task link written before the organization or repository was renamed.
  return m ? { repo: canonicalRepo(m[1]!).toLowerCase(), number: Number(m[2]) } : null;
}

/** The newest open pull request of `repo` that links the task, from the task's timeline (lib/review-state devPullOfTimeline). */
export function devPullOfEvents(events: unknown, repo: string): { number: number; url: string; draft: boolean } | null {
  let found: { number: number; url: string; draft: boolean } | null = null;
  for (const e of Array.isArray(events) ? events : []) {
    if (e?.event !== 'cross-referenced') continue;
    const i = e.source?.issue;
    if (!i?.pull_request || i.state !== 'open' || i.pull_request.merged_at) continue;
    if (canonicalRepo(String(i.repository?.full_name ?? '')).toLowerCase() !== canonicalRepo(repo).toLowerCase() || !i.number || typeof i.html_url !== 'string') continue;
    found = { number: i.number, url: i.html_url, draft: i.draft === true };
  }
  return found;
}

/** The comment Bridge posts on the developers' pull request: the words lib/review-state designReviewOf reads. */
export function buildComment(w: Pick<BuildWord, 'kind' | 'why' | 'text' | 'byName' | 'role'>): string {
  const who = `${w.byName} (${w.role === 'pm' ? 'product manager' : w.role === 'lead' ? 'design lead' : 'designer'})`;
  if (w.kind === 'looks-right') return `Design review from Bridge: looks right.\n\n${who}`;
  const what = w.why === 'design' ? `The design must change, a new version comes back from the designer: ${w.text ?? ''}` : (w.text ?? '');
  return `Design review from Bridge: needs changes: ${what.trim()}\n\n${who}`;
}

/** The "Design check" status for a pull request, in the developers' words, the people named (GitHub caps it at 140). */
export function designCheckStatus(st: BuildState, names: BuildNeed['names'] = {}, o: { designChanging?: boolean } = {}): { state: BuildState['state']; description: string } {
  if (o.designChanging) return { state: 'failure', description: 'The design is changing: wait for the new version' };
  const s = buildSummary(st, names);
  const list = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const description = s.state === 'failure' ? `${s.changesBy ?? 'The design team'} asked for changes` : s.state === 'success' ? 'The design team says it looks right' : `Waiting for ${list(s.waiting)}`;
  return { state: s.state, description: description.slice(0, 140) };
}

/** A pull request that changes no explored design: nothing to check. */
export const NO_DESIGN = { state: 'success' as const, description: 'No design to check' };

/** The issues of its own repository a pull request body names: "#12", "Closes #12", or the issue's address. At most 5. */
export function mentionedIssues(body: unknown, repo: string): number[] {
  if (typeof body !== 'string') return [];
  const out = new Set<number>();
  for (const m of body.matchAll(/(?:^|[^\w/&])#(\d{1,9})\b/g)) out.add(Number(m[1]));
  const [o, n] = repo.split('/');
  if (o && n) {
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of body.matchAll(new RegExp(`https://github\\.com/${esc(o)}/${esc(n)}/issues/(\\d{1,9})\\b`, 'gi'))) out.add(Number(m[1]));
  }
  return [...out].filter((x) => x > 0).slice(0, 5);
}
