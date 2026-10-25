// The demo's Studio home for a visitor without an account (components/ds/studio/DemoHome.tsx, rules in
// lib/demo-home.ts): the DS lead's queue and the team's explorations, read-only.
//
// Every fact about the demo's activity goes through one function, readDemoActivity: two GitHub reads (open branches,
// open suggestions) that the demo's activity snapshot answers (bridge-data branch, raw host, no API quota) when its
// recorded reads match these URLs exactly, kept by ghGet's cache when GitHub stops answering. Display names and the
// before/after thumbnails of what is
// shown first are read after, and only add to the page.
import { productsOf, SUGGESTION_LABEL, type ProductConfig } from '@bridge-ds/core';
import { ghGet, RateLimitError, readRepo } from './github-session';
import { personOf, previewOf, thumbOf } from './home-data';
import { currentViewer } from './github-session';
import { siteConfig } from './repo-context';
import { demoLogins, leadQueue, teamExplorations, type DemoPull, type DemoSuggestion } from '../lib/demo-home';
import { AVATARS_SHOWN, contrastNeed, person, guidanceNeed, NEEDS_SHOWN, sortNeeds, type NeedRow, type Person } from '../lib/home-model';
import type { ExplorationCard } from '../lib/home-explorations';
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
  /** The team's explorations (library changes wait in the queue and live on Changes). */
  explorations: ExplorationCard[];
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

/** Exploration cards shown before "See all": their explored screens are read. */
const CARDS_SHOWN = 3;

/** The products the demo names ("product: account" reads "Account" when its settings list it). */
function demoProducts(): ProductConfig[] {
  try {
    return productsOf(siteConfig() as { products?: ProductConfig[] });
  } catch {
    return productsOf(null);
  }
}

export async function loadDemoHome(stat: DemoStatic, onUpdate: (d: DemoHomeData) => void): Promise<void> {
  const now = Date.now();
  const staticNeeds = (): NeedRow[] => [...(contrastNeed(stat.contrastFail) ? [contrastNeed(stat.contrastFail)!] : []), ...stat.guidance.map((g) => guidanceNeed(g, now))].map((r) => ({ ...r, sample: true }));
  // The persona: only on a demo repository (this loader runs nowhere else) and only for a visitor without an account.
  const persona = currentViewer() ? undefined : siteConfig().demo;
  const lead: Person | null = persona ? { login: `~${persona.viewer.toLowerCase()}`, name: persona.viewer, avatar: null } : null;
  const role = persona?.role ?? null;
  onUpdate({ loading: true, needs: sortNeeds(staticNeeds()), explorations: [], lead, role, failed: null });
  let activity: DemoActivity;
  try {
    activity = await readDemoActivity();
  } catch (err) {
    onUpdate({
      loading: false,
      needs: sortNeeds(staticNeeds()),
      explorations: [],
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
  const sample = isSampleTeam(`${owner}/${repo}`);
  const previews = new Map<number, ThumbSpec>();
  const opts = { thumbs, people, approved: sample ? demoApprovals() : new Set<number>() };
  const products = demoProducts();
  const needs = () => sortNeeds([...staticNeeds(), ...leadQueue(activity.open, activity.suggestions, now, opts)]);
  const explorations = () => teamExplorations(activity.open, { people, products, previews, sample });
  const paint = () => onUpdate({ loading: false, needs: needs(), explorations: explorations(), lead, role, failed: null });
  paint();

  // Display names: from the source when it has them, else once per person shown (the avatars and the first rows).
  const logins = demoLogins(activity.open, activity.suggestions);
  const named = activity.names ?? {};
  await Promise.all(
    [...new Set(logins)].slice(0, AVATARS_SHOWN + NEEDS_SHOWN).map(async (l) => people.set(l, named[l] ? person(l, named[l], `https://github.com/${l}.png?size=64`) : await personOf(l))),
  );
  paint();

  // The before/after of what shows first only (three rows), and the explored screen of the first cards the site does
  // not ship already: each costs reads, and they are scarce.
  const wanted = new Set<number>(
    needs()
      .slice(0, NEEDS_SHOWN)
      .filter((r) => r.key.startsWith('change-'))
      .map((r) => r.number!),
  );
  const screens = new Set<number>(
    explorations()
      .slice(0, CARDS_SHOWN)
      .filter((c) => c.preview.kind === 'screen' && !c.preview.src)
      .map((c) => c.number),
  );
  type Readable = DemoPull & { head: { ref: string; sha: string }; base: { ref: string; sha: string } };
  const readable = (p: DemoPull): p is Readable => Boolean(p.head?.sha && p.base?.sha);
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  };
  await Promise.all([
    ...activity.open
      .filter((p): p is Readable => wanted.has(p.number) && readable(p))
      .map(async (p) => {
        try {
          thumbs.set(p.number, await thumbOf(p, /^docs\//.test(p.head.ref)));
        } catch {
          return;
        }
        later();
      }),
    ...activity.open
      .filter((p): p is Readable => screens.has(p.number) && readable(p))
      .map(async (p) => {
        const shot = await previewOf(p).catch(() => null);
        if (!shot) return;
        previews.set(p.number, shot);
        later();
      }),
  ]);
  paint();
}
