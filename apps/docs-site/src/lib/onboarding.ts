// Studio onboarding: the seven steps that connect a design system to Bridge, as a checklist (components/ds/studio/
// Onboarding.tsx). Pure rules and words, covered by onboarding.test.ts. No DOM, no fetch.
//
//   1. Sign in with GitHub          done once the viewer is known.
//   2. Your design system           self-hosted: this Studio is built for one repository (bridge.config.json at build
//                                   time), so it is connected from the start. Hosted (a team's Bridge, multi-team plan
//                                   7.2): connected once GitHub says the viewer can use Bridge on the repository;
//                                   "Install Bridge" while it is not set up there. The Storybook quick start reads a
//                                   published Storybook and keeps its address in this browser (lib/workspace.ts).
//   3. How changes reach your code  done when bridge.config.json sets `changes`; waiting while the pull request that
//                                   sets it is open; otherwise the current step (suggestions by default).
//   4. Invite your team             share the team link. Done once the viewer copied it (this browser remembers);
//                                   next after step 3 in the first run, "Later is fine" otherwise.
//   5. Products                     the apps listed in bridge.config.json `products`, found with the repo.
//   6. Figma plugin, 7. Claude AI   nothing on GitHub says they are set up: the viewer marks them done in this
//                                   browser, and "Later is fine" until then.
// Every step after sign-in can wait: the first run opens on step 3 only while `changes` is unset, and "Do this later"
// moves the rest into a compact "Finish connecting" checklist on the home.
// The browser workspace (lib/start.ts, no repository yet) has six steps: no team link to share without a repository,
// so no "Invite your team". Its step 2 is done once a Storybook is added; picking a repository opens that team.
import type { ChangesMode, RepoAccessState } from '@bridge-ds/core';
import { CHANGES_SHORT } from './settings-view';
import { storybookHost } from './workspace';

export type StepId = 'signin' | 'library' | 'changes' | 'team' | 'products' | 'figma' | 'claude';

/** done, the one step open now, waiting on a review, or one that can wait. */
export type StepState = 'done' | 'current' | 'waiting' | 'later';

export const STEP_IDS: readonly StepId[] = ['signin', 'library', 'changes', 'team', 'products', 'figma', 'claude'];

/** The steps Bridge asks for on the first run. Products come with the repo; the others say "Later is fine". */
const CORE: readonly StepId[] = ['signin', 'library', 'changes'];

export const STEP_TITLE: Record<StepId, string> = {
  signin: 'Sign in with GitHub',
  library: 'Your design system',
  products: 'Products',
  changes: 'How changes reach your code',
  team: 'Invite your team',
  figma: 'Figma plugin',
  claude: 'Claude AI (MCP)',
};

/** The line under a step that is not done yet: what it is for. */
export const STEP_LINE: Record<StepId, string> = {
  signin: 'Who you are on GitHub',
  library: 'Storybook URL or the repository',
  products: 'The apps that use your library',
  changes: 'Suggestions or pull requests',
  team: 'Share one link. GitHub decides who gets in.',
  figma: 'Keeps the Figma kit in step with code',
  claude: 'Lets Claude AI build with your library',
};

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
  /** Steps the viewer marked done in this browser (Figma plugin, Claude AI, the team link copied). */
  marked?: readonly StepId[];
  /**
   * A team's Bridge on the hosted site: the viewer's access to the repository (null while GitHub is asked). Absent on
   * the self-hosted site, where the repository is connected at build time.
   */
  hosted?: { access: RepoAccessState | null; admin?: boolean } | null;
  /** The browser workspace: no repository yet (`repo` is empty), six steps. */
  workspace?: boolean;
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

/** Step 2 of the browser workspace: the Storybook added here, or nothing yet. */
function workspaceLibraryStep(f: OnboardingFacts): Pick<Step, 'detail' | 'code' | 'state' | 'status'> {
  return f.quickStart
    ? { detail: 'Storybook', code: storybookHost(f.quickStart.url), state: 'done', status: 'Connected' }
    : { detail: STEP_LINE.library, state: 'later', status: 'To do' };
}

/** The steps of a Studio: seven, or six for the browser workspace (no team link without a repository). */
export const stepIdsFor = (workspace?: boolean): readonly StepId[] => (workspace ? STEP_IDS.filter((id) => id !== 'team') : STEP_IDS);

/** The steps with their state. The current step is the first core step not done, once signed in. */
export function onboardingSteps(f: OnboardingFacts): Step[] {
  const marked = new Set((f.marked ?? []).filter((m) => MARKABLE.includes(m)));
  const steps: Step[] = stepIdsFor(f.workspace).map((id, i) => {
    const base = { id, n: i + 1, title: STEP_TITLE[id] };
    switch (id) {
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
  const current = currentStepId(steps, f.workspace ? WORKSPACE_CORE : CORE);
  // A hosted step 2 keeps its own words (Install Bridge, Ask an admin): they say what to do.
  return steps.map((s) => (s.id === current ? { ...s, state: 'current', status: s.id === 'library' && f.hosted ? s.status : 'Current' } : s));
}

/** The browser workspace asks for sign-in and a design system: the rest comes with the repository. */
const WORKSPACE_CORE: readonly StepId[] = ['signin', 'library'];

function currentStepId(steps: Step[], core: readonly StepId[]): StepId | null {
  if (steps[0]!.state !== 'done') return 'signin';
  return steps.find((s) => core.includes(s.id) && s.state === 'later')?.id ?? null;
}

export const doneCount = (steps: Step[]) => steps.filter((s) => s.state === 'done').length;

/** "4 of 7 connected" */
export const progressLabel = (steps: Step[]) => `${doneCount(steps)} of ${steps.length} connected`;

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
    products: 'products',
    changes: 'how changes reach your code',
    team: 'team invited',
    figma: 'Figma plugin',
    claude: 'Claude AI',
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
}

export const EMPTY_MEMORY: OnboardingMemory = { later: false, hidden: false, marked: [], proposed: null };

/** Reads what was stored, dropping anything malformed. */
export function parseMemory(text: string | null): OnboardingMemory {
  if (!text) return { ...EMPTY_MEMORY };
  try {
    const v = JSON.parse(text) as Partial<OnboardingMemory>;
    const p = v.proposed;
    return {
      later: v.later === true,
      hidden: v.hidden === true,
      marked: Array.isArray(v.marked) ? v.marked.filter((m): m is StepId => MARKABLE.includes(m as StepId)) : [],
      proposed: p && Number.isInteger(p.pr) && p.pr > 0 && (p.mode === 'suggest' || p.mode === 'direct') ? { pr: p.pr, mode: p.mode } : null,
    };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}
