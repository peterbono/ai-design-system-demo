// The demo's Studio home for a visitor without an account (components/ds/studio/DemoHome.tsx, rules in
// lib/demo-home.ts): the DS lead's queue and the team's branches in progress, read-only.
//
// Every fact about the demo's activity goes through one function, readDemoActivity: two GitHub reads (open branches,
// open suggestions) that the demo's activity snapshot answers (bridge-data branch, raw host, no API quota) when its
// recorded reads match these URLs exactly, kept by ghGet's cache when GitHub stops answering. Display names and the
// before/after thumbnails of what is
// shown first are read after, and only add to the page.
import { SUGGESTION_LABEL } from '@bridge-ds/core';
import { ghGet, RateLimitError, readRepo } from './github-session';
import { personOf, thumbOf } from './home-data';
import { currentViewer } from './github-session';
import { siteConfig } from './repo-context';
import { demoLogins, leadQueue, teamBranches, type DemoPull, type DemoSuggestion } from '../lib/demo-home';
import { AVATARS_SHOWN, contrastNeed, person, guidanceNeed, NEEDS_SHOWN, sortBranches, sortNeeds, type BranchCard, type NeedRow, type Person } from '../lib/home-model';
import type { ThumbSpec } from '../lib/branch-thumb';
import { isSampleTeam } from '../lib/demo';
import { demoApprovals } from './demo-approvals';

/** What the demo home needs to know about the demo's activity, wherever it comes from. */
export interface DemoActivity {
  /** Open branches (pull requests), drafts included. */
  open: DemoPull[];
  /** Open suggestions. */
  suggestions: DemoSuggestion[];
  /** Display names by lower-case login, when the source carries them (a snapshot can); read from GitHub otherwise. */
  names?: Record<string, string>;
}

/**
 * The demo's activity: the one data source of the demo home. Rejects with GitHub's error (RateLimitError when the
 * anonymous reads ran out) when nothing could be read.
 */
export async function readDemoActivity(repo: { owner: string; repo: string } = readRepo()): Promise<DemoActivity> {
  const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
  const [open, suggestions] = await Promise.all([
    ghGet<DemoPull[]>(`${base}/pulls?state=open&per_page=100`),
    ghGet<DemoSuggestion[]>(`${base}/issues?state=open&labels=${encodeURIComponent(SUGGESTION_LABEL)}&per_page=50&sort=created&direction=desc`).catch(() => ({ data: [] as DemoSuggestion[] })),
  ]);
  return { open: open.data, suggestions: suggestions.data };
}

export interface DemoHomeData {
  loading: boolean;
  /** The lead's queue, sorted as the signed-in home sorts it. */
  needs: NeedRow[];
  /** The team's explorations and branches. */
  branches: BranchCard[];
  /**
   * The persona whose seat the visitor takes (bridge.config.json "demo": { "viewer", "role" }), for a visitor without
   * an account. Null when the settings name none: the home greets without a name.
   */
  lead: Person | null;
  /** The persona's role ("DS lead"), when the settings give one. */
  role: string | null;
  /** GitHub could not be read: what to tell the visitor. */
  failed: string | null;
}

/** Repo facts from the build or the team's model: drafted guidance waiting for review, failing contrast checks. */
export interface DemoStatic {
  guidance: { name: string; href: string; since: string | null }[];
  contrastFail: number;
}

/** Cards shown before the branch filter folds the rest away: their thumbnails are read. */
const CARDS_SHOWN = 4;

export async function loadDemoHome(stat: DemoStatic, onUpdate: (d: DemoHomeData) => void): Promise<void> {
  const now = Date.now();
  const staticNeeds = (): NeedRow[] => [...(contrastNeed(stat.contrastFail) ? [contrastNeed(stat.contrastFail)!] : []), ...stat.guidance.map((g) => guidanceNeed(g, now))].map((r) => ({ ...r, sample: true }));
  // The persona: only on a demo repository (this loader runs nowhere else) and only for a visitor without an account.
  const persona = currentViewer() ? undefined : siteConfig().demo;
  const lead: Person | null = persona ? { login: `~${persona.viewer.toLowerCase()}`, name: persona.viewer, avatar: null } : null;
  const role = persona?.role ?? null;
  onUpdate({ loading: true, needs: sortNeeds(staticNeeds()), branches: [], lead, role, failed: null });
  let activity: DemoActivity;
  try {
    activity = await readDemoActivity();
  } catch (err) {
    onUpdate({
      loading: false,
      needs: sortNeeds(staticNeeds()),
      branches: [],
      lead,
      role,
      failed: err instanceof RateLimitError ? 'GitHub is busy right now. The queue comes back in a few minutes.' : 'GitHub could not be reached. Reload the page to try again.',
    });
    return;
  }
  const thumbs = new Map<number, ThumbSpec>();
  const people = new Map<string, Person>();
  const { owner, repo } = readRepo();
  // Approve tried on the sample team during this visit: those branches no longer wait on the lead.
  const opts = { thumbs, people, approved: isSampleTeam(`${owner}/${repo}`) ? demoApprovals() : new Set<number>() };
  const needs = () => sortNeeds([...staticNeeds(), ...leadQueue(activity.open, activity.suggestions, now, opts)]);
  const branches = () => sortBranches(teamBranches(activity.open, opts));
  const paint = () => onUpdate({ loading: false, needs: needs(), branches: branches(), lead, role, failed: null });
  paint();

  // Display names: from the source when it has them, else once per person shown (the avatars and the first rows).
  const logins = demoLogins(activity.open, activity.suggestions);
  const named = activity.names ?? {};
  await Promise.all(
    [...new Set(logins)].slice(0, AVATARS_SHOWN + NEEDS_SHOWN).map(async (l) => people.set(l, named[l] ? person(l, named[l], `https://github.com/${l}.png?size=64`) : await personOf(l))),
  );
  paint();

  // The before/after of what shows first only (three rows, the first cards): each costs reads, and they are scarce.
  const wanted = new Set<number>([
    ...needs()
      .slice(0, NEEDS_SHOWN)
      .filter((r) => r.key.startsWith('change-'))
      .map((r) => r.number!),
    ...branches()
      .slice(0, CARDS_SHOWN)
      .map((b) => b.number),
  ]);
  const read = activity.open.filter((p): p is DemoPull & { head: { ref: string; sha: string }; base: { ref: string; sha: string } } => wanted.has(p.number) && Boolean(p.head?.sha && p.base?.sha));
  let queued = false;
  await Promise.all(
    read.map(async (p) => {
      try {
        thumbs.set(p.number, await thumbOf(p, /^docs\//.test(p.head.ref)));
      } catch {
        return;
      }
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        paint();
      });
    }),
  );
  paint();
}
