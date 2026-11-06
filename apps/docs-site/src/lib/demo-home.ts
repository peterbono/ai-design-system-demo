// The demo's Studio home for a visitor (components/ds/studio/DemoHome.tsx): the visitor steps into the DS lead's
// seat, so the home shows the lead's day as the signed-in home words it ("Ann asks for your review"), from the demo
// repository's activity (scripts/demo-home.ts readDemoActivity). Nothing is made up. Pure, covered by
// demo-home.test.ts.
import { isGuardedExploration, parseNeededBy, requesterOf } from '@bridge-ds/core';
import { CLAUDE, changeNeed, person, requesterPerson, type NeedRow, type Person } from './home-model';
import { isGuidanceChange } from './overview-todo';
import { oneLineTitle } from './markdown';
import { humanTitle } from './pr-title';
import { agentMade, workNature } from './work-nature';
import { waitsOnMe } from './waiting-on';
import { shortTitle, suggestionNeed } from './suggestions-view';
import { homeExplorations, type ExplorationCard } from './home-explorations';
import { sampleChangeOrigin, sampleExplorationPreview } from './demo';
import { changeOrigin } from './product-branch';
import type { ProductConfig } from '@bridge-ds/core';
import type { ThumbSpec } from './branch-thumb';

/** The fields of a pull request the demo home reads (GET /repos/{o}/{r}/pulls, or the activity snapshot). */
export interface DemoPull {
  number: number;
  title: string;
  user: { login: string; avatar_url?: string; type?: string } | null;
  draft?: boolean;
  created_at: string;
  updated_at: string;
  body?: string | null;
  labels?: { name: string }[] | null;
  requested_reviewers?: { login: string }[] | null;
  head?: { ref: string; sha?: string };
  base?: { ref: string; sha?: string };
  /** Read from the closed list: "closed", and when it was merged. */
  state?: string;
  merged_at?: string | null;
}

/** The fields of a suggestion the demo home reads (GET /repos/{o}/{r}/issues?labels=bridge-suggestion). */
export interface DemoSuggestion {
  number: number;
  title: string;
  user: { login: string; avatar_url?: string } | null;
  created_at: string;
  body?: string | null;
  pull_request?: unknown;
  /** Its labels: the kind of suggestion ("suggestion: docs") and its product, when it has one. */
  labels?: (string | { name: string })[] | null;
}

/** A pull request opened by automation (the release bot, Dependabot): not a design change. */
export const isBotPull = (p: Pick<DemoPull, 'user'>): boolean => !p.user || p.user.type === 'Bot' || /\[bot\]$|^app\//i.test(p.user.login);

const avatar = (u: { login: string; avatar_url?: string }) => u.avatar_url ?? `https://github.com/${u.login}.png?size=64`;
const title = (t: string) => oneLineTitle(humanTitle(t));
/** A usage guidance branch (docs/<component>-...): the lead checks the guidance, not a design. */
const guidanceBranch = (p: Pick<DemoPull, 'head'>) => isGuidanceChange(p.head?.ref ?? '', undefined);
/**
 * A running exploration (core isGuardedExploration: the `exploration` label, or an open draft on an explore/ branch
 * whose label is missing): a product screen tried with Claude AI, never reviewed as is. An exploration promoted to
 * review ("Review it like any change", ready for review, label removed) is in review like any change, as Changes lists
 * it: it waits on the lead.
 */
export const isExploration = (p: Pick<DemoPull, 'state' | 'draft' | 'labels' | 'head' | 'body'>) =>
  isGuardedExploration({ state: p.state ?? 'open', draft: p.draft, labels: p.labels ?? [], headRef: p.head?.ref, body: p.body });

export interface LeadOptions {
  /** Before/after of the branches read so far. */
  thumbs?: Map<number, ThumbSpec>;
  /** Display names (GitHub profiles), by lower-case login. */
  people?: Map<string, Person>;
  /** Branches the visitor approved during this visit (Approve tried, lib/demo.ts DEMO_APPROVED_KEY): out of the queue. */
  approved?: ReadonlySet<number>;
  /** The sample team: its changes say the exploration they come from (lib/demo.ts SAMPLE_CHANGE_ORIGINS). */
  sample?: boolean;
}

function who(u: { login: string; avatar_url?: string } | null, people?: Map<string, Person>): Person {
  return u ? (people?.get(u.login.toLowerCase()) ?? person(u.login, null, avatar(u))) : person('ghost', null, null);
}

/** Who made a change: Claude AI for agent work, else the GitHub account. */
export function authorOf(p: Pick<DemoPull, 'user' | 'body' | 'labels'>, people?: Map<string, Person>): Person {
  return agentMade({ body: p.body ?? null, labels: p.labels ?? null }) ? CLAUDE : who(p.user, people);
}

/** Who asked for it: the requester Bridge recorded in the body ("Requested by Ann Leroy."), else the author. */
export function askerOf(p: Pick<DemoPull, 'user' | 'body' | 'labels'>, people?: Map<string, Person>): Person {
  const r = requesterOf(p.body);
  return (r && requesterPerson(r, (l) => who({ login: l }, people))) ?? authorOf(p, people);
}

/**
 * Whether a branch waits on the DS lead whose seat the visitor takes: the one rule of every "waiting on me" surface
 * (lib/waiting-on), in the seat (statuses are never read on the demo). Drafts (being built), running explorations,
 * developer work, closed branches and automation are left out. The demo's home (leadQueue), Changes > Waiting on me
 * (scripts/reviews.ts) and the Changes badge (leadWaitingCount) all read it.
 */
export const waitsOnLead = (p: Pick<DemoPull, 'user' | 'title' | 'draft' | 'labels' | 'head' | 'body' | 'state' | 'merged_at'>): boolean =>
  !isBotPull(p) &&
  waitsOnMe(
    {
      author: p.user?.login ?? '',
      draft: p.draft,
      labels: p.labels,
      exploration: isExploration(p),
      guidance: guidanceBranch(p),
      nature: workNature({ title: title(p.title), labels: p.labels ?? null }).nature,
      ...(p.merged_at ? { lifecycle: 'shipped' as const } : p.state && p.state !== 'open' ? { lifecycle: 'closed' as const } : {}),
      who: null,
    },
    { login: null, role: 'reviewer', seat: true },
  );

/** The suggestions that wait on the lead: every open one (an issue that is a pull request is not a suggestion). */
export const leadSuggestions = <S extends Pick<DemoSuggestion, 'pull_request'>>(suggestions: readonly S[]): S[] => suggestions.filter((s) => !s.pull_request);

/**
 * How many things wait on the lead in the demo seat: the lead's queue (leadQueue: the branches that wait on them and
 * the open suggestions) and the usage guidance drafts. The one number of the demo, so they always agree: the home line
 * ("16 changes and 1 documentation draft need your review."), Changes > Waiting on me and the Changes badge.
 */
export function leadWaitingCount(pulls: DemoPull[], suggestions: DemoSuggestion[], guidance: number, approved?: ReadonlySet<number>): number {
  return leadQueue(pulls, suggestions, 0, approved ? { approved } : {}).length + guidance;
}

/**
 * The queue a DS lead sees on the demo, the visitor in their seat: every branch that waits on the lead (waitsOnLead)
 * and every open suggestion, as the Needs you rows of the signed-in home (changeNeed, suggestionNeed). The Review page
 * lists the same rows.
 */
export function leadQueue(pulls: DemoPull[], suggestions: DemoSuggestion[], now: number, opts: LeadOptions = {}): NeedRow[] {
  const changes = pulls
    .filter((p) => waitsOnLead(p) && !opts.approved?.has(p.number))
    .map((p) => {
      const guidance = guidanceBranch(p);
      return {
        ...changeNeed(
        {
          number: p.number,
          title: title(p.title),
          author: authorOf(p, opts.people),
          asker: askerOf(p, opts.people),
          since: p.created_at,
          task: guidance ? 'guidance' : 'requested',
          origin: changeOrigin(parseNeededBy(p.body) ?? (opts.sample ? sampleChangeOrigin(p.head?.ref) : null))?.name ?? null,
          thumb: opts.thumbs?.get(p.number) ?? { kind: 'icon', icon: guidance ? 'guidance' : 'branch' },
        },
        now,
        ),
        sample: true,
      };
    });
  const asked = leadSuggestions(suggestions)
    .map((s) => ({ ...suggestionNeed({ number: s.number, title: shortTitle(s.title), createdAt: s.created_at }, askerOf({ user: s.user, body: s.body ?? null, labels: null }, opts.people), now), sample: true }));
  return [...changes, ...asked];
}

/**
 * The team's explorations, as the home's exploration cards (lib/home-explorations): the product screens the team tries
 * with Claude AI, from the lead's seat (a visitor has none of their own). Library changes are left out: they wait in
 * the lead's queue (leadQueue) and live on Changes. `previews` holds the explored screens read so far; the sample
 * team's come with the site (lib/demo.ts SAMPLE_EXPLORATION_PREVIEWS).
 */
export function teamExplorations(
  pulls: DemoPull[],
  opts: LeadOptions & {
    products?: readonly ProductConfig[];
    previews?: Map<number, ThumbSpec>;
    sample?: boolean;
    /** The changed files of a running exploration (undefined while read): its card says "Not started" or "Exploring". */
    files?: (p: DemoPull) => readonly string[] | null | undefined;
  } = {},
): ExplorationCard[] {
  return homeExplorations(
    pulls.filter((p) => !isBotPull(p)),
    {
      products: opts.products ?? [],
      author: (p) => askerOf(p, opts.people),
      preview: (p) => {
        const seeded = opts.sample ? sampleExplorationPreview(p.head?.ref) : null;
        return seeded ? { kind: 'screen', src: seeded } : opts.previews?.get(p.number);
      },
      ...(opts.files ? { files: opts.files } : {}),
    },
  );
}

/** The logins the home names, to read their display names once (GET /users/{login}). */
export function demoLogins(pulls: DemoPull[], suggestions: DemoSuggestion[]): string[] {
  const all = [
    ...pulls.filter((p) => !isBotPull(p)).flatMap((p) => [requesterOf(p.body)?.login, p.user?.login, ...(p.requested_reviewers ?? []).map((r) => r.login)]),
    ...suggestions.flatMap((s) => [requesterOf(s.body)?.login, s.user?.login]),
  ];
  return [...new Set(all.filter((l): l is string => Boolean(l)).map((l) => l.toLowerCase()))];
}
