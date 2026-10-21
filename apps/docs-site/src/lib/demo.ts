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
  hello: "You're exploring the Bridge demo",
  line: 'Browse everything and try the editor. Saving a change needs your own design system.',
  connect: 'Connect your design system',
  launcherToggle: "Already on Bridge? Open your team's",
  waitingNone: 'Nothing waits for a review right now.',
  glance: 'The library at a glance',
  recent: 'Recent changes',
  recentSub: 'What the team merged lately.',
  seeAll: 'See all branches',
  dialogTitle: 'Make it yours',
  keepExploring: 'Keep exploring',
  stepSignIn: 'Sign in with GitHub',
  stepSignInLine: 'Bridge works as you on GitHub. Your sign-in stays in this browser.',
  stepConnect: 'Connect your design system',
  stepConnectLine: 'Point Bridge at its GitHub repository. Your team opens the same link.',
  noDs: 'No design system yet? Keep exploring the demo.',
} as const;

/** What the visitor tried to do, as "to <verb>" reads it, when a gated action does not say. */
export const DEFAULT_WRITE = 'save changes';

/**
 * The dialog's lead. From an action (`action`, "create branches"): what the demo allows, and what that action needs.
 * From "Connect your design system" (no action): the two steps ahead.
 */
export function makeItYoursLead(action?: string | null): string {
  const verb = (action ?? '').trim();
  if (!verb) return 'Bring your own design system into Bridge in two steps. The demo stays here whenever you want to look around.';
  return `In the demo you can look around and try everything. To ${verb}, connect your own design system: it takes two steps.`;
}

/** "3 changes and 1 usage draft wait for a review." over the rows of the demo's zone. */
export function demoWaitingLine(changes: number, drafts = 0): string {
  const parts = [changes ? `${changes} ${changes === 1 ? 'change' : 'changes'}` : '', drafts ? `${drafts} usage ${drafts === 1 ? 'draft' : 'drafts'}` : ''].filter(Boolean);
  if (!parts.length) return DEMO_WORDS.waitingNone;
  return `${parts.join(' and ')} ${changes + drafts === 1 ? 'waits' : 'wait'} for a review.`;
}
