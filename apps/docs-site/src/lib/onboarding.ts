// Studio onboarding: the eight steps that connect a design system to Bridge, as a checklist (components/ds/studio/
// Onboarding.tsx). Pure rules and words, covered by onboarding.test.ts. No DOM, no fetch.
//
//   1. Sign in with GitHub          done once the viewer is known.
//   2. Your design system           self-hosted: this Studio is built for one repository (bridge.config.json at build
//                                   time), so it is connected from the start. Hosted (a team's Bridge, multi-team plan
//                                   7.2): connected once GitHub says the viewer can use Bridge on the repository;
//                                   "Install Bridge" while it is not set up there. The Storybook quick start reads a
//                                   published Storybook and keeps its address in this browser (lib/workspace.ts).
//   3. Name your team               bridge.config.json `name`, the name the team goes by in Studio, the Library and
//                                   invitations. A light step: one field prefilled from the repository, saved as a
//                                   config pull request; waiting while that pull request is open; "Later is fine".
//   4. How changes reach your code  done when bridge.config.json sets `changes`; waiting while the pull request that
//                                   sets it is open; otherwise the current step (suggestions by default).
//   5. Invite your team             share the team link. Done once the viewer copied it (this browser remembers);
//                                   next after step 4 in the first run, "Later is fine" otherwise.
//   6. Products                     the apps listed in bridge.config.json `products`, found with the repo.
//   7. Figma plugin, 8. Claude AI   nothing on GitHub says they are set up: the viewer marks them done in this
//                                   browser, and "Later is fine" until then.
// Every step after sign-in can wait: the first run opens on step 4 only while `changes` is unset, and "Do this later"
// moves the rest into a compact "Finish connecting" checklist on the home.
// The browser workspace (lib/start.ts, no repository yet) has six steps: no team link to share without a repository,
// so no "Name your team" nor "Invite your team". Its step 2 is done once a Storybook is added; picking a repository opens that team.
// Signed in with a Bridge account (Entry, board E6), the workspace is "Create your team": step 1 is "Your team" (a
// name, and whether people with the work domain can find it), step 2 takes a Storybook or connects GitHub to link the
// repository, then products, how changes reach the code, the Figma plugin and Claude AI. Only step 1 is needed today.
import type { ChangesMode, RepoAccessState } from '@bridge-ds/core';
import { CHANGES_SHORT } from './settings-view';
import { storybookHost } from './workspace';
import { TEAM_NAME_WORDS } from './team-name';

export type StepId = 'signin' | 'library' | 'name' | 'changes' | 'team' | 'products' | 'figma' | 'claude' | 'create';

/** done, the one step open now, waiting on a review, or one that can wait. */
export type StepState = 'done' | 'current' | 'waiting' | 'later';

export const STEP_IDS: readonly StepId[] = ['signin', 'library', 'name', 'changes', 'team', 'products', 'figma', 'claude'];

/** "Create your team" (board E6): the browser workspace of a Bridge account. */
export const CREATE_STEP_IDS: readonly StepId[] = ['create', 'library', 'products', 'changes', 'figma', 'claude'];

/** Every step an address (?setup=) or this browser may name. */
export const ANY_STEP_IDS: readonly StepId[] = [...STEP_IDS, 'create'];

/** The steps Bridge asks for on the first run. Products come with the repo; the others say "Later is fine". */
const CORE: readonly StepId[] = ['signin', 'library', 'changes'];

export const STEP_TITLE: Record<StepId, string> = {
  signin: 'Sign in with GitHub',
  library: 'Your design system',
  name: TEAM_NAME_WORDS.stepTitle,
  products: 'Products',
  changes: 'How changes reach your code',
  team: 'Invite your team',
  figma: 'Figma plugin',
  claude: 'Claude AI (MCP)',
  create: 'Your team',
};

/** The line under a step that is not done yet: what it is for. */
export const STEP_LINE: Record<StepId, string> = {
  signin: 'Who you are on GitHub',
  library: 'Storybook URL or the repository',
  name: TEAM_NAME_WORDS.stepLine,
  products: 'The apps that use your library',
  changes: 'Suggestions or pull requests',
  team: 'Share one link. GitHub decides who gets in.',
  figma: 'Keeps the Figma kit in step with code',
  claude: 'Lets Claude AI build with your library',
  create: 'A name, and who can find it',
};

/** Step 2 of "Create your team": GitHub only comes back to link the repository. */
const CREATE_LIBRARY_LINE = 'Storybook URL, or connect GitHub to link your repo';

export interface OnboardingFacts {
  /** GitHub login once signed in. */
  login: string | null;
  /** "owner/name" this Studio is built for. */
  repo: string;
  /** The deployed Storybook from bridge.config.json, when there is one. */
  storybook: string | null;
  /** The Storybook added in this browser with the quick start, and the components found there. */
  quickStart?: { url: string; components: number } | null;
  /** Product names from bridge.config.json `products`. */
  products: string[];
  /** `changes` as bridge.config.json says it; null when the key is absent. */
  changes: ChangesMode | null;
  /** The open pull request that sets `changes`, proposed from this browser. */
  proposed?: { pr: number; mode: ChangesMode } | null;
  /** The team's display name as bridge.config.json says it (`name`); null when the key is absent. */
  teamName?: string | null;
  /** The open pull request that sets `name`, proposed from this browser. */
  named?: { pr: number; name: string } | null;
  /** Steps the viewer marked done in this browser (Figma plugin, Claude AI, the team link copied). */
  marked?: readonly StepId[];
  /**
   * A team's Bridge on the hosted site: the viewer's access to the repository (null while GitHub is asked). Absent on
   * the self-hosted site, where the repository is connected at build time.
   */
  hosted?: { access: RepoAccessState | null; admin?: boolean } | null;
  /** The browser workspace: no repository yet (`repo` is empty), six steps. */
  workspace?: boolean;
  /** The browser workspace of a Bridge account ("Create your team"): the team name typed on step 1, once saved. */
  account?: { teamName: string | null } | null;
}

export interface Step {
  id: StepId;
  n: number;
  title: string;
  /** Done: what is connected ("Signed in as @ann"); otherwise what the step is for. */
  detail: string;
  /** Mono part of the detail, shown after it (the repository name). */
  code?: string;
  state: StepState;
  /** Words on the right of the row: Done, Connected, Current, In review, Later is fine. */
  status: string;
  /** The open pull request behind a waiting step. */
  pr?: number;
}

const MARKABLE: readonly StepId[] = ['team', 'figma', 'claude'];

/** Step 2 on a team's Bridge: what GitHub says about the viewer and the repository. */
function hostedLibraryStep(f: OnboardingFacts, access: RepoAccessState | null, admin: boolean): Pick<Step, 'detail' | 'code' | 'state' | 'status'> {
  const lead = f.storybook || f.quickStart ? 'Storybook and' : 'Repository';
  switch (access) {
    case null:
      return { detail: 'Checking your access to', code: f.repo, state: 'later', status: 'Checking' };
    case 'reader':
    case 'writer':
    case 'admin':
      return { detail: lead, code: f.repo, state: 'done', status: 'Connected' };
    case 'outside-contributor':
      return { detail: 'Read only on', code: f.repo, state: 'done', status: 'Read only' };
    case 'not-installed':
      return { detail: 'Bridge is not set up on', code: f.repo, state: 'later', status: admin ? 'Install Bridge' : 'Ask an admin' };
    default:
      return { detail: 'No access to', code: f.repo, state: 'later', status: 'No access' };
  }
}

function changesStep(f: OnboardingFacts): Pick<Step, 'detail' | 'state' | 'status' | 'pr'> {
  if (f.changes) return { detail: CHANGES_SHORT[f.changes], state: 'done', status: 'Chosen' };
  if (f.proposed) return { detail: `${CHANGES_SHORT[f.proposed.mode]}, waiting for review`, state: 'waiting', status: `In review, #${f.proposed.pr}`, pr: f.proposed.pr };
  return { detail: STEP_LINE.changes, state: 'later', status: 'Later is fine' };
}

function nameStep(f: OnboardingFacts): Pick<Step, 'detail' | 'state' | 'status' | 'pr'> {
  if (f.teamName) return { detail: f.teamName, state: 'done', status: 'Named' };
  if (f.named) return { detail: `${f.named.name}, waiting for review`, state: 'waiting', status: `In review, #${f.named.pr}`, pr: f.named.pr };
  return { detail: STEP_LINE.name, state: 'later', status: 'Later is fine' };
}

/** Step 2 of the browser workspace: the Storybook added here, or nothing yet ("Next" after "Your team"). */
function workspaceLibraryStep(f: OnboardingFacts): Pick<Step, 'detail' | 'code' | 'state' | 'status'> {
  if (f.quickStart) return { detail: 'Storybook', code: storybookHost(f.quickStart.url), state: 'done', status: 'Connected' };
  return f.account ? { detail: CREATE_LIBRARY_LINE, state: 'later', status: 'Next' } : { detail: STEP_LINE.library, state: 'later', status: 'To do' };
}

/**
 * The steps of a Studio: eight, or six for the browser workspace (no team to name nor link without a repository),
 * "Create your team" for a Bridge account's workspace.
 */
export const stepIdsFor = (workspace?: boolean, account?: boolean): readonly StepId[] =>
  workspace ? (account ? CREATE_STEP_IDS : STEP_IDS.filter((id) => id !== 'team' && id !== 'name')) : STEP_IDS;

/** The steps with their state. The current step is the first core step not done, once signed in. */
export function onboardingSteps(f: OnboardingFacts): Step[] {
  const marked = new Set((f.marked ?? []).filter((m) => MARKABLE.includes(m)));
  const create = Boolean(f.workspace && f.account);
  const steps: Step[] = stepIdsFor(f.workspace, create).map((id, i) => {
    const base = { id, n: i + 1, title: STEP_TITLE[id] };
    switch (id) {
      case 'create': {
        const name = f.account?.teamName?.trim();
        return name ? { ...base, detail: name, state: 'done', status: 'Done' } : { ...base, detail: STEP_LINE.create, state: 'later', status: 'To do' };
      }
      case 'signin':
        return f.login
          ? { ...base, detail: `Signed in as @${f.login}`, state: 'done', status: 'Done' }
          : { ...base, detail: STEP_LINE.signin, state: 'later', status: 'To do' };
      case 'library':
        if (f.workspace) return { ...base, ...workspaceLibraryStep(f) };
        return f.hosted
          ? { ...base, ...hostedLibraryStep(f, f.hosted.access, f.hosted.admin === true) }
          : { ...base, detail: f.storybook || f.quickStart ? 'Storybook and' : 'Repository', code: f.repo, state: 'done', status: 'Connected' };
      case 'products':
        return f.products.length
          ? { ...base, detail: f.products.join(', '), state: 'done', status: 'Connected' }
          : { ...base, detail: STEP_LINE.products, state: 'later', status: 'Found with the repo' };
      case 'name':
        return { ...base, ...nameStep(f) };
      case 'changes':
        return { ...base, ...changesStep(f) };
      case 'team':
        return marked.has('team')
          ? { ...base, detail: 'Team link shared', state: 'done', status: 'Done' }
          : { ...base, detail: STEP_LINE.team, state: 'later', status: 'Later is fine' };
      default:
        return marked.has(id)
          ? { ...base, detail: 'Set up, you said so', state: 'done', status: 'Done' }
          : { ...base, detail: STEP_LINE[id], state: 'later', status: 'Later is fine' };
    }
  });
  const current = currentStepId(steps, create ? CREATE_CORE : f.workspace ? WORKSPACE_CORE : CORE);
  // A hosted step 2 keeps its own words (Install Bridge, Ask an admin): they say what to do.
  return steps.map((s) => (s.id === current ? { ...s, state: 'current', status: s.id === 'library' && f.hosted ? s.status : 'Current' } : s));
}

/** The browser workspace asks for sign-in and a design system: the rest comes with the repository. */
const WORKSPACE_CORE: readonly StepId[] = ['signin', 'library'];
/** "Create your team": the team first, then the design system. */
const CREATE_CORE: readonly StepId[] = ['create', 'library'];

function currentStepId(steps: Step[], core: readonly StepId[]): StepId | null {
  if (steps[0]!.state !== 'done') return steps[0]!.id;
  return steps.find((s) => core.includes(s.id) && s.state === 'later')?.id ?? null;
}

/** The address with ?setup= on `step`, the rest of the query kept: a reload opens the same step. */
export function withSetupStep(search: string, step: StepId): string {
  const q = new URLSearchParams(search);
  q.set('setup', step);
  return `?${q.toString()}`;
}

export const doneCount = (steps: Step[]) => steps.filter((s) => s.state === 'done').length;

/** "4 of 8 connected"; "0 of 6 done" for "Create your team". */
export const progressLabel = (steps: Step[]) => `${doneCount(steps)} of ${steps.length} ${steps[0]?.id === 'create' ? 'done' : 'connected'}`;

/** The first run opens full screen only for a signed-in viewer with a core step left, until "Do this later". */
export function showsFirstRun(steps: Step[], opts: { later: boolean }): boolean {
  return steps[0]!.state === 'done' && !opts.later && steps.some((s) => s.state === 'current');
}

/** The compact checklist shows while a step is left, until the viewer hides it. */
export const showsChecklist = (steps: Step[], opts: { hidden: boolean }) => steps[0]!.state === 'done' && !opts.hidden && doneCount(steps) < steps.length;

/** The first-run title for the step that is open. */
export function firstRunTitle(name: string | null, step: StepId): string {
  if (step === 'changes') return 'Almost there. Choose how changes reach your code.';
  return name ? `Welcome, ${name}. Let's connect your design system.` : "Welcome. Let's connect your design system.";
}

/** The compact checklist's summary of what is done, in one sentence: "Signed in, design system, products and ...". */
export function doneSummary(steps: Step[]): string | null {
  const WORD: Record<StepId, string> = {
    signin: 'signed in',
    library: 'design system',
    name: 'team named',
    products: 'products',
    changes: 'how changes reach your code',
    team: 'team invited',
    figma: 'Figma plugin',
    claude: 'Claude AI',
    create: 'team created',
  };
  const words = steps.filter((s) => s.state === 'done').map((s) => WORD[s.id]);
  if (!words.length) return null;
  const text = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0]!;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------------------------------------------
// What this browser remembers (per viewer conveniences only; the repository stays the source of truth)

/** The key before onboarding was kept per repository; it belonged to the build repository (the demo). */
export const ONBOARDING_KEY = 'bridge.onboarding';

/** What this browser remembers of one repository's onboarding: bridge.onboarding.<owner>/<repo> (lower case). */
export const onboardingKey = (repo: string) => `${ONBOARDING_KEY}.${repo.toLowerCase()}`;

/**
 * The stored text of one repository's onboarding, moving the old shared key onto `legacyRepo` (the build repository
 * of the self-hosted site) the first time it is read. `storage` is localStorage, swapped in tests.
 */
export function readMemoryText(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, repo: string, legacyRepo: string | null): string | null {
  const own = storage.getItem(onboardingKey(repo));
  if (own !== null) return own;
  if (!legacyRepo || legacyRepo.toLowerCase() !== repo.toLowerCase()) return null;
  const old = storage.getItem(ONBOARDING_KEY);
  if (old === null) return null;
  storage.setItem(onboardingKey(repo), old);
  storage.removeItem(ONBOARDING_KEY);
  return old;
}

export interface OnboardingMemory {
  /** "Do this later" on the first run. */
  later: boolean;
  /** "Hide checklist" on the home. */
  hidden: boolean;
  marked: StepId[];
  proposed: { pr: number; mode: ChangesMode } | null;
  /** The pull request that names the team, opened from this browser. */
  named: { pr: number; name: string } | null;
}

export const EMPTY_MEMORY: OnboardingMemory = { later: false, hidden: false, marked: [], proposed: null, named: null };

/** Reads what was stored, dropping anything malformed. */
export function parseMemory(text: string | null): OnboardingMemory {
  if (!text) return { ...EMPTY_MEMORY };
  try {
    const v = JSON.parse(text) as Partial<OnboardingMemory>;
    const p = v.proposed;
    const n = v.named;
    return {
      later: v.later === true,
      hidden: v.hidden === true,
      marked: Array.isArray(v.marked) ? v.marked.filter((m): m is StepId => MARKABLE.includes(m as StepId)) : [],
      proposed: p && Number.isInteger(p.pr) && p.pr > 0 && (p.mode === 'suggest' || p.mode === 'direct') ? { pr: p.pr, mode: p.mode } : null,
      named: n && Number.isInteger(n.pr) && n.pr > 0 && typeof n.name === 'string' && n.name.trim() ? { pr: n.pr, name: n.name.trim() } : null,
    };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}
