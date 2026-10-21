// How far Bridge has gone reading a design system, in the words a designer reads (components/ds/studio/LoadProgress
// shows it). Two readers report here: a team page reading its repository (scripts/team-data.ts, through
// scripts/repo-context.ts loadTeamModel and core loadRepoModel), and the Storybook quick start reading index.json.
// Pure: events in, a view out. Never fakes progress: the bar is determinate only while real file counts are known,
// indeterminate otherwise.
import type { RepoModelPhase, RepoModelProgress } from '@bridge-ds/core';

/** What a team load reports, in order: head, then one of cache / snapshot / files..., then ready. */
export type TeamLoadEvent = { step: 'head' } | { step: 'cache' } | { step: 'snapshot' } | { step: 'files'; progress: RepoModelProgress } | { step: 'ready' };

export interface TeamProgress {
  /** The step running now ('cache' is instant: the view is never shown for it). */
  step: TeamLoadEvent['step'];
  /** How the files were read, once known: the saved snapshot, or the files themselves. */
  via: 'snapshot' | 'files' | null;
  /** The latest file counts (via files). */
  files: RepoModelProgress | null;
}

export const TEAM_PROGRESS_START: TeamProgress = { step: 'head', via: null, files: null };

/** Folds one event into the progress so far. */
export function teamProgress(state: TeamProgress, event: TeamLoadEvent): TeamProgress {
  switch (event.step) {
    case 'head':
      return TEAM_PROGRESS_START;
    case 'cache':
      return { ...state, step: 'cache' };
    case 'snapshot':
      return { ...state, step: 'snapshot', via: 'snapshot' };
    case 'files':
      return { step: 'files', via: 'files', files: event.progress };
    case 'ready':
      return { ...state, step: 'ready' };
  }
}

export interface ProgressStepView {
  label: string;
  state: 'done' | 'current';
}

export interface LoadProgressView {
  /** The current step, said once per step (the polite live region): never a count, so it is not chatty. */
  status: string;
  /** The bar's own label, under the step: "Reading tokens 12 of 48". Null when the step says it all. */
  detail: string | null;
  /** The bar: a real fraction, or null (indeterminate) when the total is unknown. */
  value: number | null;
  max: number;
  /** What a screen reader hears for the bar's value. */
  valueText: string | null;
  /** The steps so far, done ones first, then the current one. */
  steps: ProgressStepView[];
  done: boolean;
}

const PHASE_WORD: Record<RepoModelPhase, string> = { tokens: 'tokens', components: 'components', docs: 'docs' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const FIND = { current: 'Finding your design system', done: 'Found your design system' };
const SNAPSHOT = { current: 'Using the saved snapshot', done: 'Used the saved snapshot' };

/** The team load as the progress view shows it. */
export function teamProgressView(p: TeamProgress): LoadProgressView {
  const steps: ProgressStepView[] = [];
  if (p.step === 'head') {
    return { status: FIND.current, detail: null, value: null, max: 1, valueText: null, steps: [{ label: FIND.current, state: 'current' }], done: false };
  }
  steps.push({ label: FIND.done, state: 'done' });
  const total = p.files?.filesTotal ?? 0;
  const readLabel = (done: boolean) => (total ? `${done ? 'Read' : 'Reading'} ${plural(total, 'file')}` : done ? 'Read your files' : 'Reading your files');
  if (p.step === 'ready' || p.step === 'cache') {
    if (p.via === 'snapshot') steps.push({ label: SNAPSHOT.done, state: 'done' });
    else if (p.via === 'files') steps.push({ label: readLabel(true), state: 'done' });
    steps.push({ label: 'Ready', state: 'current' });
    return { status: 'Ready', detail: null, value: 1, max: 1, valueText: 'Done', steps, done: true };
  }
  if (p.step === 'snapshot') {
    steps.push({ label: SNAPSHOT.current, state: 'current' });
    return { status: SNAPSHOT.current, detail: null, value: null, max: 1, valueText: null, steps, done: false };
  }
  // Reading files: the bar is the whole read, the detail the phase in hand.
  const f = p.files!;
  steps.push({ label: readLabel(false), state: 'current' });
  const word = PHASE_WORD[f.phase];
  if (!f.filesTotal) return { status: `Reading ${word}`, detail: null, value: null, max: 1, valueText: null, steps, done: false };
  return {
    status: `Reading ${word}`,
    detail: `Reading ${word} ${f.done} of ${f.total}`,
    value: f.filesDone,
    max: f.filesTotal,
    valueText: `${f.filesDone} of ${plural(f.filesTotal, 'file')} read`,
    steps,
    done: false,
  };
}

/** The Storybook quick start: reading index.json (one request, size unknown), then how many components it holds. */
export type StorybookProgress = { step: 'storybook' } | { step: 'ready'; components: number };

export function storybookProgressView(p: StorybookProgress): LoadProgressView {
  if (p.step === 'storybook') {
    return { status: 'Reading your Storybook', detail: null, value: null, max: 1, valueText: null, steps: [{ label: 'Reading your Storybook', state: 'current' }], done: false };
  }
  return {
    status: 'Ready',
    detail: null,
    value: 1,
    max: 1,
    valueText: 'Done',
    steps: [
      { label: `Found ${plural(p.components, 'component')} in your Storybook`, state: 'done' },
      { label: 'Ready', state: 'current' },
    ],
    done: true,
  };
}
