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

export async function buildWordsOf(redis: Redis, repo: string, pull: number): Promise<BuildWord[]> {
  const raw = await redis.cmd('GET', buildKey(repo, pull));
  try {
    const v = typeof raw === 'string' ? (JSON.parse(raw) as { words?: unknown }) : null;
    return Array.isArray(v?.words) ? (v.words as BuildWord[]).filter((w) => w && typeof w.sha === 'string' && typeof w.role === 'string') : [];
  } catch {
    return [];
  }
}

export async function addBuildWord(redis: Redis, repo: string, pull: number, w: BuildWord): Promise<BuildWord[]> {
  const words = [...(await buildWordsOf(redis, repo, pull)), w].slice(-MAX_WORDS);
  await redis.cmd('SET', buildKey(repo, pull), JSON.stringify({ words }), 'EX', BUILD_KEEP_S);
  return words;
}

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
