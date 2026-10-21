// The demo's Studio home for a visitor without an account (components/ds/studio/DemoHome.tsx, rules in
// lib/demo-home.ts): what waits for a review and what was merged lately, read from the demo repository anonymously.
// Three GitHub reads per visit (open branches, recently closed branches, open suggestions), kept by ghGet's cache
// when GitHub stops answering (anonymous visitors get 60 reads an hour), plus the before/after of the first rows.
// The repository is the page's: the self-hosted site's own, or the team in the address (readRepo).
import { SUGGESTION_LABEL } from '@bridge-ds/core';
import { ghGet, RateLimitError, readRepo } from './github-session';
import { thumbOf } from './home-data';
import { demoWaitingRows, recentChanges, type DemoPull, type DemoSuggestion, type RecentChange } from '../lib/demo-home';
import { guidanceNeed, NEEDS_SHOWN, type NeedRow } from '../lib/home-model';
import type { ThumbSpec } from '../lib/branch-thumb';

export interface DemoHomeData {
  loading: boolean;
  waiting: NeedRow[];
  /** Null when GitHub could not be read. */
  recent: RecentChange[] | null;
  /** GitHub could not be read: what to tell the visitor. */
  failed: string | null;
}

/** Usage guidance Claude drafted, waiting for a review (repo facts, read at build or from the team's model). */
export type DemoGuidance = { name: string; href: string; since: string | null }[];

export async function loadDemoHome(guidance: DemoGuidance, onUpdate: (d: DemoHomeData) => void): Promise<void> {
  const now = Date.now();
  const drafts = (): NeedRow[] => guidance.map((g) => ({ ...guidanceNeed(g, now), waitsOnYou: false }));
  onUpdate({ loading: true, waiting: [], recent: [], failed: null });
  const { owner, repo } = readRepo();
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const [open, closed, suggestions] = await Promise.allSettled([
    ghGet<DemoPull[]>(`${base}/pulls?state=open&per_page=100`),
    ghGet<DemoPull[]>(`${base}/pulls?state=closed&sort=updated&direction=desc&per_page=30`),
    ghGet<DemoSuggestion[]>(`${base}/issues?state=open&labels=${encodeURIComponent(SUGGESTION_LABEL)}&per_page=50`),
  ]);
  const pulls = open.status === 'fulfilled' ? open.value.data : [];
  const thumbs = new Map<number, ThumbSpec>();
  const paint = () =>
    onUpdate({
      loading: false,
      waiting: [...demoWaitingRows(pulls, suggestions.status === 'fulfilled' ? suggestions.value.data : [], now, thumbs), ...drafts()],
      recent: closed.status === 'fulfilled' ? recentChanges(closed.value.data, now) : null,
      failed:
        open.status === 'rejected'
          ? open.reason instanceof RateLimitError
            ? 'GitHub is busy right now. The branches come back in a few minutes.'
            : 'GitHub could not be reached. Reload the page to try again.'
          : null,
    });
  paint();
  // The before/after of the rows shown first only: each costs a few reads, and anonymous reads are scarce.
  const first = demoWaitingRows(pulls, [], now)
    .slice(0, NEEDS_SHOWN)
    .map((r) => pulls.find((p) => p.number === r.number))
    .filter((p): p is DemoPull & { head: { ref: string; sha: string }; base: { ref: string; sha: string } } => Boolean(p?.head?.sha && p.base?.sha));
  await Promise.all(
    first.map(async (p) => {
      try {
        thumbs.set(p.number, await thumbOf(p, /^docs\//.test(p.head.ref)));
        paint();
      } catch {
        /* the icon stays */
      }
    }),
  );
}
