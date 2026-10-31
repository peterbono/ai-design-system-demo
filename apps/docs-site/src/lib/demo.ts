// The demo: which design systems are the public demo, and the words a visitor reads there. Pure: no DOM, no
// fetch, covered by demo.test.ts.
//
// A visitor without an account (or signed in without write access) explores the demo freely: the Studio home shows
// the demo's real data read-only (components/ds/studio/DemoHome.tsx). The sample team has one banner and one call to
// action everywhere, Studio and Library: "Get started", the email sign-in (never GitHub). Approve can be tried and shows
// its result without writing anything; edits stay in this browser as drafts for the visit (scripts/demo-drafts.ts);
// every other action that would write opens the sample-team dialog (components/ds/studio/MakeItYours.tsx,
// scripts/demo-gate.ts). Someone who can write to the demo repository (its owner) keeps the normal Studio.

import type { Owners } from '@bridge-ds/core';
import { isBotLogin, isClaudeLogin } from './people.js';
import { isTeamKey } from './team-path.js';

/**
 * The design systems that are the public demo, lower case "owner/repo": the self-hosted site's own repository and
 * the demo team on the hosted site (/studio/peterbono/bridge-demo-ds/). The one place to change what "demo" means.
 */
export const DEMO_REPOS: readonly string[] = ['peterbono/ai-design-system-demo', 'peterbono/bridge-demo-ds'];

/** True for a demo design system ("owner/repo", any case). */
export const isDemoRepo = (repo: string | null | undefined): boolean => DEMO_REPOS.includes((repo ?? '').trim().toLowerCase());

/**
 * The two demo design systems are not the same thing for a visitor, so they never share a name:
 *   - peterbono/bridge-demo-ds is a simulated team with sample data: "Acme Design" (Dana leads its design system).
 *   - peterbono/ai-design-system-demo is Bridge's own design system, the real one behind this site: "Bridge DS".
 */
export const SAMPLE_REPO = 'peterbono/bridge-demo-ds';
export const SAMPLE_TEAM = 'Acme Design';
/** Matches `name` in the root bridge.config.json (demo.test.ts checks), for pages that name it before its settings are read. */
export const OWN_TEAM = 'Bridge DS';

/** True for the simulated team with sample data ("owner/repo", any case). */
export const isSampleTeam = (repo: string | null | undefined): boolean => (repo ?? '').trim().toLowerCase() === SAMPLE_REPO;

/**
 * The explored screens of the sample team's explorations, by branch: a capture of each branch's own screen code
 * (apps/account on the sample repository, rendered with the library at the branch head), shipped with the site in
 * public/sample/explorations/. The sample team publishes no preview deploys, so the home shows these instead of a
 * sketch. A new sample exploration adds its capture here.
 */
export const SAMPLE_EXPLORATION_PREVIEWS: Readonly<Record<string, string>> = {
  'explore/profile-page': '/sample/explorations/profile-page.png',
  'agent/billing-invoice-status': '/sample/explorations/billing-invoice-status.png',
  'explore/team-seats-and-roles': '/sample/explorations/team-seats-and-roles.png',
  'explore/notification-channels': '/sample/explorations/notification-channels.png',
  'explore/plan-comparison': '/sample/explorations/plan-comparison.png',
};

/** The capture of a sample exploration's screen, by its branch, or null. */
export const sampleExplorationPreview = (branch: string | null | undefined): string | null => (branch ? (SAMPLE_EXPLORATION_PREVIEWS[branch] ?? null) : null);

/** The repository part of "owner/repo" in words: "ai-design-system-demo" reads "Ai design system demo". */
export const humanizeRepo = (repo: string): string => {
  const part = repo.trim().split('/').pop()?.trim() ?? '';
  const words = part.replace(/[-_.\s]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : repo.trim();
};

/**
 * The one name a team goes by everywhere it is named (the team chip and its menu, recent teams, the Library, Settings,
 * the invite page and email): the sample team is always Acme Design; otherwise bridge.config.json `name` when the
 * team set one (`config`, its settings once read), else Bridge for Bridge's own design system, else the repository
 * name in words ("Design system", never "acme/design-system").
 */
export const teamDisplayName = (repo: string, config?: { name?: unknown } | null): string => {
  if (isSampleTeam(repo)) return SAMPLE_TEAM;
  const own = typeof config?.name === 'string' ? config.name.trim().replace(/\s+/g, ' ') : '';
  if (own) return own;
  if (isTeamKey(repo)) return 'Your team';
  if (isDemoRepo(repo)) return OWN_TEAM;
  return humanizeRepo(repo);
};

/** " on Bridge" after a team's name, or nothing when the team is Bridge itself: never "Join Bridge on Bridge". */
export const onBridge = (team: string): string => (team.trim().toLowerCase() === 'bridge' ? '' : ' on Bridge');

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
  /** The one banner of the sample team, on every Studio and Library page (board D1). */
  bannerTitle: `${SAMPLE_TEAM}.`,
  bannerText: 'This is a sample team: your edits stay in this browser and nothing is sent.',
  /** The one call to action of the sample team: the email sign-in (lib/account.ts SIGNIN_PAGE), never GitHub. */
  getStarted: 'Get started',
  /** The same banner on Bridge's own design system, for a guest: its data is real, so it is not called sample data. */
  ownSampleTitle: `${OWN_TEAM}, read only.`,
  ownSampleText: "You're looking at the design system behind Bridge. Nothing here touches your repository.",
  backToWorkspace: 'Back to your workspace',
  /** The same banner for someone who has no workspace yet. */
  connectOwn: 'Connect your design system',
  /** The home's explorations, the team's from the lead's seat (board D1; library changes live on Changes). */
  explorations: 'Recent explorations',
  /** A write action on the sample team (board D2). */
  dialogTitle: 'This is a sample team.',
  dialogLead: 'Nothing is sent from Acme Design. Get started to do this with your own team.',
  /** The same dialog on Bridge's own design system: real data, read only for a visitor, never called the demo. */
  ownDialogTitle: 'Sign in with GitHub to do this.',
  ownDialogLead: 'This is the design system behind Bridge, read only for visitors. Nothing is saved.',
  dialogNote: 'You pick the repos Bridge can see. It starts read-only and asks again before it writes anything.',
  /** The sample-team dialog's note: what happens on a real team. */
  sampleNote: 'With your own team, Bridge reads your design system and sends nothing until you ask.',
  keepExploring: 'Keep exploring',
  /** The account menu's way to the sample team, for a signed-in member (never between real teams in the team menu). */
  tryIt: `Try it · ${SAMPLE_TEAM}`,
} as const;

/**
 * Approve, tried on the sample team (a branch or its review page): the approved state and what happens next, nothing
 * written anywhere. `author` is who asked for the review ("Ann"), when known. `codeBy` names who still checks the code
 * ("Malik", sampleCodeReviewers), when the change needs that check: Settings > Review rules on the sample team.
 * `valuesOnly`: a token value change (core withTokenValueApprovals, decision TV-1) needs no code check, so the design
 * approval sends it on to the library once the automatic checks pass.
 */
export function demoApproved(author?: string | null, codeBy?: string | null, valuesOnly?: boolean): { title: string; next: string; note: string } {
  const who = author?.trim() ? author.trim().split(/\s+/)[0]! : 'the teammate who asked';
  const code = codeBy?.trim();
  return {
    title: 'Approved',
    next: valuesOnly
      ? `On your team, ${who} hears it at once. A token value needs no code check: it reaches the library once the automatic checks pass.`
      : code
        ? `On your team, ${who} hears it at once. ${code} checks the code next, then it ships once the checks pass.`
        : `On your team, ${who} hears it at once, and a developer ships the change once the checks pass.`,
    note: 'Sample data, nothing is sent.',
  };
}

/**
 * Who checks the code on the sample team, by first name ("Malik", "Malik or Kim"): the members who review tech, as its
 * Settings > Review rules and Members say. `team` is lib/invites.ts sampleTeam(lead), passed in (see samplePersonOf).
 */
export function sampleCodeReviewers(team: { members: readonly { name: string; reviews: readonly string[]; you?: boolean }[] }): string | null {
  const names = team.members.filter((m) => !m.you && m.reviews.includes('tech')).map((m) => m.name);
  if (!names.length) return null;
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

/**
 * The approval checklist on the sample team, as its Review rules say: the visitor's seat (Dana) checks the look, the
 * members who review tech check the code. The repository behind it has one owner, whose one review would cover both
 * parts ("Covered by your approval"): on the sample team a code row that is not approved yet waits for `codeBy`
 * ("Waiting for Malik") and never carries the visitor's action. `isCode` tells the code row (a branch's `role` is
 * 'tech', a suggestion's label is "Tech approval").
 */
export function sampleApprovalRows<R extends { state: string; text: string; canAct?: boolean }>(rows: readonly R[], isCode: (r: R) => boolean, codeBy: string | null): R[] {
  if (!codeBy) return [...rows];
  return rows.map((r) => (isCode(r) && r.state === 'waiting' ? { ...r, text: `Waiting for ${codeBy}`, ...('canAct' in r ? { canAct: false } : {}) } : r));
}

/**
 * The who-acts line on the sample team: never the only owner's "your approval covers design and code" (the visitor's
 * seat checks the look only); `codeBy` checks the code next when the change still needs it. `solo` is that sentence
 * (core soloOwnerSentence(login, true)), passed in so this module loads nothing at runtime for the /api functions.
 */
export function sampleTurnSentence(sentence: string, solo: string, codeBy: string | null): string {
  if (!sentence.includes(solo)) return sentence;
  return sentence.replace(solo, codeBy ? `${codeBy} checks the code next.` : '').replace(/\s+$/, '');
}

// ---------------------------------------------------------------------------------------------------------------
// Drafts made on the sample team (token edits, docs edits, a new brand), and the branches approved there, stay in this
// browser for the visit and never mix with a real team's: entering the sample team puts a real draft aside, leaving it for any other page drops the
// sample drafts and brings the real draft back. Pure over a Storage-like store (scripts/demo-drafts.ts runs it).

/** The token and docs draft every Studio page shares (scripts/token-editor.ts). */
export const SHARED_DRAFT_KEY = 'bridge.draft.v1';
/** Where a real draft waits while the visitor is on the sample team. */
export const DEMO_STASH_KEY = 'bridge.draft.v1.before-demo';
/** Set while the visitor is on the sample team: their drafts there are sample drafts. */
export const DEMO_VISIT_KEY = 'bridge.demo.visit';

export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

/** The keys of drafts kept for the sample team only: its brand draft and its per-change drafts. */
const sampleScoped = (k: string) => {
  const low = k.toLowerCase();
  return low.startsWith('bridge.') && low.includes(SAMPLE_REPO) && /draft/.test(low);
};

/**
 * Branches the visitor approved on the sample team (Approve tried, nothing sent), by number: kept for the visit like
 * the sample drafts, so the approved branch leaves the lead's queue and shows Approved on every page, and dropped
 * when the visitor leaves the sample team. Never read off the sample team.
 */
export const DEMO_APPROVED_KEY = 'bridge.demo.approved';

/** The sample team's branches approved during this visit. */
export function demoApprovedSet(store: Pick<DraftStore, 'getItem'>): Set<number> {
  try {
    const v = JSON.parse(store.getItem(DEMO_APPROVED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : []);
  } catch {
    return new Set();
  }
}

/** Approve tried on a sample team branch: remembered for the visit (`approved` false forgets it, for Undo). */
export function markDemoApproved(store: Pick<DraftStore, 'getItem' | 'setItem'>, pr: number, approved = true): void {
  const set = demoApprovedSet(store);
  if (approved) set.add(pr);
  else set.delete(pr);
  store.setItem(DEMO_APPROVED_KEY, JSON.stringify([...set]));
}

/** Keeps sample drafts and real drafts apart. `onSample`: this page is the sample team. Returns what it did. */
export function swapDemoDrafts(store: DraftStore, onSample: boolean): 'entered' | 'left' | 'none' {
  const visiting = store.getItem(DEMO_VISIT_KEY) === '1';
  if (onSample) {
    if (visiting) return 'none';
    const real = store.getItem(SHARED_DRAFT_KEY);
    if (real !== null) store.setItem(DEMO_STASH_KEY, real);
    store.removeItem(SHARED_DRAFT_KEY);
    // A new visit starts with nothing approved (a visit that ended without passing through another page).
    store.removeItem(DEMO_APPROVED_KEY);
    store.setItem(DEMO_VISIT_KEY, '1');
    return 'entered';
  }
  if (!visiting) return 'none';
  const scoped: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && sampleScoped(k)) scoped.push(k);
  }
  for (const k of scoped) store.removeItem(k);
  store.removeItem(DEMO_APPROVED_KEY);
  const real = store.getItem(DEMO_STASH_KEY);
  if (real !== null) store.setItem(SHARED_DRAFT_KEY, real);
  else store.removeItem(SHARED_DRAFT_KEY);
  store.removeItem(DEMO_STASH_KEY);
  store.removeItem(DEMO_VISIT_KEY);
  return 'left';
}

/** The banner's words for a demo repository: the sample team's, or Bridge's own. */
export function demoBanner(repo: string | null | undefined): { title: string; text: string } {
  const w = DEMO_WORDS;
  return isOwnTeam(repo) ? { title: w.ownSampleTitle, text: w.ownSampleText } : { title: w.bannerTitle, text: w.bannerText };
}

/** The write-action dialog's words for a demo repository: the sample team's, or Bridge's own (never "the demo"). */
export function demoDialog(repo: string | null | undefined): { title: string; lead: string } {
  return isOwnTeam(repo) ? { title: DEMO_WORDS.ownDialogTitle, lead: DEMO_WORDS.ownDialogLead } : { title: DEMO_WORDS.dialogTitle, lead: DEMO_WORDS.dialogLead };
}

/** Bridge's own design system: a demo repository that is not the sample team. */
export const isOwnTeam = (repo: string | null | undefined): boolean => isDemoRepo(repo) && !isSampleTeam(repo);

/** What a write action in the demo does, as its data-demo-write says it, when it does not say ("save changes"). */
export const DEFAULT_WRITE = 'save changes';

/**
 * The waiting line of the demo (board D1b), the visitor in the DS lead's seat: "8 changes need your review." then
 * who waits: "Ann and Claude AI are waiting on you." (the visitor is Dana). `people` is
 * home-model waitingSentence over everyone but the lead.
 */
export function demoWaiting(n: number, people: { names: string; rest: string } | null, lead: string | null, drafts = 0): { count: string; rest: string } {
  // What the queue holds, so the line and "Review all · 1 of N" agree: the changes, then Claude AI's documentation
  // drafts when there are any ("15 changes and 1 documentation draft need your review.").
  const what = [n > 0 || !drafts ? `${n} ${n === 1 ? 'change' : 'changes'}` : '', drafts ? `${drafts} documentation ${drafts === 1 ? 'draft' : 'drafts'}` : ''].filter(Boolean).join(' and ');
  const one = n + drafts === 1;
  // No persona (Bridge's own design system, or a demo whose settings name none): the visitor is a visitor, not a
  // reviewer, so nothing "needs your review" and nobody is "waiting on you".
  if (!lead) {
    const count = `${what} ${one ? 'waits' : 'wait'} for review.`;
    return { count, rest: people ? ` ${people.names}${people.rest.replace(/ on you\.$/, ' on a reviewer.')}` : '' };
  }
  const count = `${what} ${one ? 'needs' : 'need'} your review.`;
  if (!people) return { count, rest: ` ${lead} leads this design system.` };
  return { count, rest: ` ${people.names}${people.rest}` };
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
    title: 'Explore with Claude AI',
    text: 'Each card is a product screen the team tries with Claude AI. Bridge spots what the library does not have yet, and the pieces worth keeping go to review.',
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

// ---------------------------------------------------------------------------------------------------------------
// People on the sample team

/**
 * Who a login is on the sample team (History and other plain-script rows, scripts/people.ts): the sample team tells
 * its own story, never the repository's real accounts. `team` is lib/invites.ts sampleTeam(lead), the one source,
 * passed in so this module imports nothing the /api functions would load. A sample member's login ("~ann-leroy", with
 * or without the ~) is that member, name and face; any other human login (the repository's real accounts, such as its
 * owner) is the lead in the visitor's seat (Dana), face seeded by ~dana. Claude and bots are not people: null, they
 * keep their own name ("Claude AI"). The returned `login` is the face seed.
 */
export function samplePersonOf(login: string, team: { members: readonly { login: string; name: string; you?: boolean }[] }): { login: string; name: string } | null {
  const bare = login.trim().replace(/^@/, '');
  if (!bare || isClaudeLogin(bare) || isBotLogin(bare)) return null;
  const { members } = team;
  const key = bare.replace(/^~/, '').toLowerCase();
  const m = members.find((x) => x.login.replace(/^~/, '').toLowerCase() === key) ?? members.find((x) => x.you) ?? members[0];
  return m ? { login: m.login, name: m.name } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Settings on the sample team

/** Who the demo's Settings name: the persona (bridge.config.json "demo"), else the role the demo always tells. */
export const demoLeadName = (persona: { viewer?: string } | null | undefined): string => persona?.viewer?.trim() || 'Your design system lead';

/**
 * The people of the sample team's Settings (components/ds/studio/TeamSettings.tsx): the same people as its Members
 * (`team`: lib/invites.ts sampleTeam, the one source, passed in so this module imports nothing the /api functions
 * would load), never the repository's real accounts. The design owners are the members
 * who review design (Dana, the visitor's seat, and Ann), the tech owners those who review tech (Malik), by their sample
 * logins (~dana...) so each face matches Members. The rules themselves (which group holds each right, the exception
 * on or off, its written reason) stay the repository's. The exception, owners only, names the lead (a design owner).
 * More than one owner: no only-owner line.
 */
export function demoSettingsPeople(
  site: { demo?: { viewer?: string } | undefined },
  team: (lead: string) => { members: readonly { login: string; name: string; reviews: readonly string[] }[] },
): { lead: string; owners: Owners; nameOf: (login: string) => string } {
  const lead = demoLeadName(site.demo);
  const { members } = team(lead);
  const group = (g: 'design' | 'tech') => members.filter((m) => m.reviews.includes(g)).map((m) => m.login);
  const names = new Map(members.map((m) => [m.login.toLowerCase(), m.name]));
  return { lead, owners: { design: group('design'), tech: group('tech') }, nameOf: (login) => names.get(login.trim().toLowerCase()) ?? lead };
}
