// "Where it stands" on the exploration page (components/ds/studio/WhereItStands.tsx): the handover notes of an
// exploration (@bridge-ds/core exploration-notes.ts), in the words the page shows, and the edit form's values back
// into an update. Designers never read a technical word here: no file, no branch, no commit.
import { notesCounts, notesEmpty, type EdgeCase, type ExplorationNotes, type NotesUpdate } from '@bridge-ds/core';

export const NOTES_WORDS = {
  title: 'Where it stands',
  next: 'Next step',
  noNext: 'No next step written yet.',
  context: 'Context',
  decisions: 'Decisions',
  edgeCases: 'Edge cases',
  questions: 'Open questions',
  covered: 'Covered',
  open: 'Still open',
  show: 'Show details',
  hide: 'Hide details',
  edit: 'Edit',
  write: 'Write it yourself',
  save: 'Save',
  cancel: 'Cancel',
  addCase: 'Add an edge case',
  removeCase: 'Remove this edge case',
  /** The empty state: how the notes fill themselves, quietly. */
  empty: 'Nothing noted yet. When someone works on it in Claude, the decisions, edge cases and next step fill in here, so anyone can carry on.',
  saved: 'Saved. Whoever opens it next starts from here.',
  linesHint: 'One per line.',
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 decisions · 3 of 5 edge cases covered · 1 open question"; empty when nothing is counted. */
export function notesCountLine(n: ExplorationNotes): string {
  const c = notesCounts(n);
  return [
    c.decisions ? plural(c.decisions, 'decision', 'decisions') : '',
    c.edgeCases ? `${c.covered} of ${plural(c.edgeCases, 'edge case', 'edge cases')} covered` : '',
    c.questions ? plural(c.questions, 'open question', 'open questions') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** True when the collapsed view holds everything (no details to open). */
export const notesHaveDetails = (n: ExplorationNotes): boolean => Boolean(n.context || n.decisions.length || n.edgeCases.length || n.openQuestions.length);

export { notesEmpty };

/** The edge cases grouped by component, in first-seen order, for one checklist per component. */
export function edgeCaseGroups(cases: readonly EdgeCase[]): { component: string; cases: EdgeCase[] }[] {
  const out: { component: string; cases: EdgeCase[] }[] = [];
  for (const e of cases) {
    const g = out.find((x) => x.component.toLowerCase() === e.component.toLowerCase());
    if (g) g.cases.push(e);
    else out.push({ component: e.component, cases: [e] });
  }
  return out;
}

/** What the edit form holds: the lists as one line each. */
export interface NotesDraft {
  context: string;
  nextStep: string;
  decisions: string;
  openQuestions: string;
  edgeCases: EdgeCase[];
}

export const draftOf = (n: ExplorationNotes): NotesDraft => ({
  context: n.context,
  nextStep: n.nextStep,
  decisions: n.decisions.join('\n'),
  openQuestions: n.openQuestions.join('\n'),
  edgeCases: n.edgeCases.map((e) => ({ ...e })),
});

const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean);

/**
 * The update the form saves (written with replace: the person saw each section whole). Only the sections that changed
 * are named, so a section Claude updated meanwhile is never written over by an untouched one.
 */
export function updateOfDraft(before: ExplorationNotes, d: NotesDraft): NotesUpdate {
  const u: NotesUpdate = {};
  if (d.context.trim() !== before.context.trim()) u.context = d.context.trim();
  if (d.nextStep.trim() !== before.nextStep.trim()) u.nextStep = d.nextStep.trim();
  const decisions = lines(d.decisions);
  if (decisions.join('\n') !== before.decisions.join('\n')) u.decisions = decisions;
  const questions = lines(d.openQuestions);
  if (questions.join('\n') !== before.openQuestions.join('\n')) u.openQuestions = questions;
  const cases = d.edgeCases
    .map((e) => ({ component: e.component.trim() || 'General', state: e.state.trim(), covered: e.covered, ...(e.note?.trim() ? { note: e.note.trim() } : {}) }))
    .filter((e) => e.state);
  const key = (x: readonly EdgeCase[]) => JSON.stringify(x.map((e) => [e.component, e.state, e.covered, e.note ?? '']));
  if (key(cases) !== key(before.edgeCases)) u.edgeCases = cases;
  return u;
}
