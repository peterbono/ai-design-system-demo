// Studio onboarding: the six steps that connect a design system to Bridge, as a checklist (components/ds/studio/
// Onboarding.tsx). Pure rules and words, covered by onboarding.test.ts. No DOM, no fetch.
//
//   1. Sign in with GitHub          done once the viewer is known.
//   2. Your design system           this Studio is built for one repository (bridge.config.json at build time), so
//                                   it is connected from the start. The Storybook quick start is not wired yet: the
//                                   step shows it as coming, never as working.
//   3. Products                     the apps listed in bridge.config.json `products`, found with the repo.
//   4. How changes reach your code  done when bridge.config.json sets `changes`; waiting while the pull request that
//                                   sets it is open; otherwise the current step (suggestions by default).
//   5. Figma plugin, 6. Claude AI   nothing on GitHub says they are set up: the viewer marks them done in this
//                                   browser, and "Later is fine" until then.
// Every step after sign-in can wait: the first run opens on step 4 only while `changes` is unset, and "Do this later"
// moves the rest into a compact "Finish connecting" checklist on the home.
import type { ChangesMode } from '@bridge-ds/core';
import { CHANGES_SHORT } from './settings-view';

export type StepId = 'signin' | 'library' | 'products' | 'changes' | 'figma' | 'claude';

/** done, the one step open now, waiting on a review, or one that can wait. */
export type StepState = 'done' | 'current' | 'waiting' | 'later';

export const STEP_IDS: readonly StepId[] = ['signin', 'library', 'products', 'changes', 'figma', 'claude'];

/** The steps Bridge asks for on the first run. Products come with the repo; the others say "Later is fine". */
const CORE: readonly StepId[] = ['signin', 'library', 'changes'];

export const STEP_TITLE: Record<StepId, string> = {
  signin: 'Sign in with GitHub',
  library: 'Your design system',
  products: 'Products',
  changes: 'How changes reach your code',
  figma: 'Figma plugin',
  claude: 'Claude AI (MCP)',
};

/** The line under a step that is not done yet: what it is for. */
export const STEP_LINE: Record<StepId, string> = {
  signin: 'Who you are on GitHub',
  library: 'Storybook URL or the repository',
  products: 'The apps that use your library',
  changes: 'Suggestions or pull requests',
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
  /** Product names from bridge.config.json `products`. */
  products: string[];
  /** `changes` as bridge.config.json says it; null when the key is absent. */
  changes: ChangesMode | null;
  /** The open pull request that sets `changes`, proposed from this browser. */
  proposed?: { pr: number; mode: ChangesMode } | null;
  /** Steps the viewer marked done in this browser (Figma plugin, Claude AI). */
  marked?: readonly StepId[];
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

const MARKABLE: readonly StepId[] = ['figma', 'claude'];

function changesStep(f: OnboardingFacts): Pick<Step, 'detail' | 'state' | 'status' | 'pr'> {
  if (f.changes) return { detail: CHANGES_SHORT[f.changes], state: 'done', status: 'Chosen' };
  if (f.proposed) return { detail: `${CHANGES_SHORT[f.proposed.mode]}, waiting for review`, state: 'waiting', status: `In review, #${f.proposed.pr}`, pr: f.proposed.pr };
  return { detail: STEP_LINE.changes, state: 'later', status: 'Later is fine' };
}

/** The six steps with their state. The current step is the first core step not done, once signed in. */
export function onboardingSteps(f: OnboardingFacts): Step[] {
  const marked = new Set((f.marked ?? []).filter((m) => MARKABLE.includes(m)));
  const steps: Step[] = STEP_IDS.map((id, i) => {
    const base = { id, n: i + 1, title: STEP_TITLE[id] };
    switch (id) {
      case 'signin':
        return f.login
          ? { ...base, detail: `Signed in as @${f.login}`, state: 'done', status: 'Done' }
          : { ...base, detail: STEP_LINE.signin, state: 'later', status: 'To do' };
      case 'library':
        return { ...base, detail: f.storybook ? 'Storybook and' : 'Repository', code: f.repo, state: 'done', status: 'Connected' };
      case 'products':
        return f.products.length
          ? { ...base, detail: f.products.join(', '), state: 'done', status: 'Connected' }
          : { ...base, detail: STEP_LINE.products, state: 'later', status: 'Found with the repo' };
      case 'changes':
        return { ...base, ...changesStep(f) };
      default:
        return marked.has(id)
          ? { ...base, detail: 'Set up, you said so', state: 'done', status: 'Done' }
          : { ...base, detail: STEP_LINE[id], state: 'later', status: 'Later is fine' };
    }
  });
  const current = currentStepId(steps);
  return steps.map((s) => (s.id === current ? { ...s, state: 'current', status: 'Current' } : s));
}

function currentStepId(steps: Step[]): StepId | null {
  if (steps[0]!.state !== 'done') return 'signin';
  return steps.find((s) => CORE.includes(s.id) && s.state === 'later')?.id ?? null;
}

export const doneCount = (steps: Step[]) => steps.filter((s) => s.state === 'done').length;

/** "4 of 6 connected" */
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

export const ONBOARDING_KEY = 'bridge.onboarding';

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
