// The demo's Studio home for a visitor (components/ds/studio/DemoHome.tsx): the visitor steps into the DS lead's
// seat, so the home shows the lead's day as the signed-in home words it ("Ann asks for your review"), from the demo
// repository's activity (scripts/demo-home.ts readDemoActivity). Nothing is made up. Pure, covered by
// demo-home.test.ts.
import { requesterOf } from '@bridge-ds/core';
import { CLAUDE, changeNeed, person, requesterPerson, type BranchCard, type NeedRow, type Person } from './home-model';
import { isGuidanceChange } from './overview-todo';
import { oneLineTitle } from './markdown';
import { humanTitle } from './pr-title';
import { agentMade, workNature } from './work-nature';
import { waitsOnMe } from './waiting-on';
import { shortTitle, suggestionNeed } from './suggestions-view';
import { studioHref } from './team-path';
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
const guidanceBranch = (p: DemoPull) => isGuidanceChange(p.head?.ref ?? '', undefined);
const labelNames = (p: DemoPull) => (p.labels ?? []).map((l) => l.name.toLowerCase());
/** An exploration (labelled, or on an explore/ branch): a product screen tried with Claude AI, never merged as is. */
export const isExploration = (p: DemoPull) => labelNames(p).includes('exploration') || /^explore\//.test(p.head?.ref ?? '');
/** The product a branch belongs to, from its "product: account" label: "Account". */
export function productOf(p: DemoPull): string | null {
  const l = labelNames(p).find((x) => x.startsWith('product:'));
  const name = l?.slice('product:'.length).trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : null;
}

export interface LeadOptions {
  /** Before/after of the branches read so far. */
  thumbs?: Map<number, ThumbSpec>;
  /** Display names (GitHub profiles), by lower-case login. */
  people?: Map<string, Person>;
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
 * (lib/waiting-on), in the seat (statuses are never read on the demo). Drafts, explorations, developer work and
 * automation are left out; the Branches "Waiting on me" filter on the demo reads the same rule.
 */
export const waitsOnLead = (p: DemoPull): boolean =>
  !isBotPull(p) &&
  waitsOnMe(
    { author: p.user?.login ?? '', draft: p.draft, exploration: isExploration(p), guidance: guidanceBranch(p), nature: workNature({ title: title(p.title), labels: p.labels ?? null }).nature, who: null },
    { login: null, role: 'reviewer', seat: true },
  );

/**
 * The queue a DS lead sees on the demo, the visitor in their seat: every branch that waits on the lead (waitsOnLead)
 * and every open suggestion, as the Needs you rows of the signed-in home (changeNeed, suggestionNeed). The Review page
 * lists the same rows.
 */
export function leadQueue(pulls: DemoPull[], suggestions: DemoSuggestion[], now: number, opts: LeadOptions = {}): NeedRow[] {
  const changes = pulls
    .filter(waitsOnLead)
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
          thumb: opts.thumbs?.get(p.number) ?? { kind: 'icon', icon: guidance ? 'guidance' : 'branch' },
        },
        now,
        ),
        sample: true,
      };
    });
  const asked = suggestions
    .filter((s) => !s.pull_request)
    .map((s) => ({ ...suggestionNeed({ number: s.number, title: shortTitle(s.title), createdAt: s.created_at }, askerOf({ user: s.user, body: s.body ?? null, labels: null }, opts.people), now), sample: true }));
  return [...changes, ...asked];
}

/**
 * The team's explorations and branches, as the home's branch cards (board D1 "Explorations and branches"): drafts
 * being edited and branches in review. A visitor has no branch of their own; these are the demo team's.
 */
export function teamBranches(pulls: DemoPull[], opts: LeadOptions = {}): BranchCard[] {
  return pulls
    .filter((p) => !isBotPull(p))
    .map((p) => {
      const reviewer = p.requested_reviewers?.[0];
      return {
        number: p.number,
        title: title(p.title),
        href: studioHref(`changes/?pr=${p.number}`),
        stage: p.draft ? 'draft' : 'ready',
        updated: p.updated_at,
        reviewer: reviewer ? who(reviewer, opts.people) : null,
        thumb: opts.thumbs?.get(p.number) ?? { kind: 'icon', icon: guidanceBranch(p) ? 'guidance' : 'branch' },
        // Board D1: "Exploration in Admin demo · Ann", "Library branch · in review", "Library branch · draft".
        statusLine: isExploration(p)
          ? { stage: productOf(p) ? `Exploration in ${productOf(p)}` : 'Exploration', detail: askerOf(p, opts.people).name }
          : { stage: 'Library branch', detail: p.draft ? 'draft' : 'in review' },
      } satisfies BranchCard;
    });
}

/** The logins the home names, to read their display names once (GET /users/{login}). */
export function demoLogins(pulls: DemoPull[], suggestions: DemoSuggestion[]): string[] {
  const all = [
    ...pulls.filter((p) => !isBotPull(p)).flatMap((p) => [requesterOf(p.body)?.login, p.user?.login, ...(p.requested_reviewers ?? []).map((r) => r.login)]),
    ...suggestions.flatMap((s) => [requesterOf(s.body)?.login, s.user?.login]),
  ];
  return [...new Set(all.filter((l): l is string => Boolean(l)).map((l) => l.toLowerCase()))];
}
