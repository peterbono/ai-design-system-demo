// The Bridge demo: which design systems are the public demo, and the words a visitor reads there. Pure: no DOM, no
// fetch, covered by demo.test.ts.
//
// A visitor without an account (or signed in without write access) explores the demo freely: the Studio home shows
// the demo's real data read-only (components/ds/studio/DemoHome.tsx), and every action that would write to the demo
// opens "Make it yours" instead (components/ds/studio/MakeItYours.tsx, scripts/demo-gate.ts). Someone who can
// write to the demo repository (its owner) keeps the normal Studio.

/**
 * The design systems that are the public demo, lower case "owner/repo": the self-hosted site's own repository and
 * the demo team on the hosted site (/studio/peterbono/bridge-demo-ds/). The one place to change what "demo" means.
 */
export const DEMO_REPOS: readonly string[] = ['peterbono/ai-design-system-demo', 'peterbono/bridge-demo-ds'];

/** True for a demo design system ("owner/repo", any case). */
export const isDemoRepo = (repo: string | null | undefined): boolean => DEMO_REPOS.includes((repo ?? '').trim().toLowerCase());

/**
 * The visitor explores the demo: it is a demo repository and they cannot write to it. Signed in, `write` stays
 * unknown (null) until GitHub answers; until then the Studio behaves as usual, so its owner is never stopped.
 */
export function exploresDemo(x: { repo: string | null | undefined; signedIn: boolean; write: boolean | null }): boolean {
  if (!isDemoRepo(x.repo)) return false;
  if (!x.signedIn) return true;
  return x.write === false;
}

// ---------------------------------------------------------------------------------------------------------------
// The words

export const DEMO_WORDS = {
  /** The banner over every Studio page of the demo (board D1). */
  bannerTitle: 'Demo workspace.',
  bannerText: 'Read-only, sample data from our open-source design system.',
  seeOnGitHub: 'See it on GitHub',
  useOwn: 'Use your own repo',
  /** The home's branches (board D1). */
  branches: 'Explorations and branches',
  /** A write action in the demo (board D2). */
  dialogTitle: 'Sign in with GitHub to do this for real.',
  dialogLead: 'In the demo, nothing is saved.',
  dialogNote: 'You pick the repos Bridge can see. It starts read-only and asks again before it writes anything.',
  keepExploring: 'Keep exploring',
} as const;

/** What a write action in the demo does, as its data-demo-write says it, when it does not say ("save changes"). */
export const DEFAULT_WRITE = 'save changes';

/**
 * The waiting line of the demo (board D1b), the visitor in the DS lead's seat: "8 changes need your review." then
 * who waits, on whom: "Ann and Claude AI are waiting on Dana, who leads this design system." `people` is
 * home-model waitingSentence over everyone but the lead.
 */
export function demoWaiting(n: number, people: { names: string; rest: string } | null, lead: string | null): { count: string; rest: string } {
  const count = `${n} ${n === 1 ? 'change needs' : 'changes need'} your review.`;
  const on = lead ? `on ${lead}, who leads this design system.` : 'on the lead of this design system.';
  if (!people) return { count, rest: lead ? ` ${lead} leads this design system.` : '' };
  return { count, rest: ` ${people.names}${people.rest.replace(/on you\.$/, on)}` };
}

// ---------------------------------------------------------------------------------------------------------------
// The tour of the demo home (board D1): three steps, each anchored where it points

export type TourAt = 'rows' | 'more' | 'branches';

const DEMO_TOUR: Record<TourAt, { title: string; text: string }> = {
  rows: {
    title: 'Changes wait for the lead',
    text: 'Each row is a change a teammate or Claude AI opened. Bridge shows it before and after, so the lead reviews the look, not the code.',
  },
  more: {
    title: 'The whole queue, one by one',
    text: 'Review all opens every change in turn: approve, ask for changes, and move on to the next.',
  },
  branches: {
    title: 'Work in progress stays apart',
    text: 'Explorations try a product screen with Claude AI; branches change the library. Nothing reaches it until it is reviewed and merged.',
  },
};

/** One step's words; the first names the persona's role when the settings give one ("Changes wait for the DS lead"). */
export function demoTour(at: TourAt, role?: string | null): { title: string; text: string } {
  const w = DEMO_TOUR[at];
  return at === 'rows' && role ? { ...w, title: `Changes wait for the ${role}` } : w;
}

/** The steps the page can point at, in order: the grouped row only when there is one. */
export function tourSteps(x: { rows: boolean; more: boolean; branches: boolean }): TourAt[] {
  return (['rows', 'more', 'branches'] as const).filter((s) => x[s]);
}
