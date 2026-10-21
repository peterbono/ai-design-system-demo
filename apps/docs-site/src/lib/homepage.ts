// The homepage ("/", pages/index.astro): the pure parts of its behaviour (scripts/homepage.ts), so they are tested.
//   - Hero: a 0-100 "bridge" position between the exploration (100) and the design system (0). Releasing it snaps
//     to one side; 0 means the piece is kept.
//   - Step tabs: three steps per section, arrow keys move between them, the active one advances on its own.
//   - The review queue of the design system lead: approve, undo, pick the next change.
//   - Fixed-size drawings scaled to their column.

/** Spoken value of the hero slider. */
export function heroValueText(v: number): string {
  if (v <= 0) return 'Kept in your design system';
  if (v >= 100) return 'All exploration';
  if (v < 50) return 'Mostly design system';
  if (v > 50) return 'Mostly exploration';
  return 'Half exploration, half design system';
}

/** Where the bridge settles when released: the side it is closer to (the middle goes back to the exploration). */
export function heroSnap(v: number): 0 | 100 {
  return v < 50 ? 0 : 100;
}

/** Keys move the bridge all the way, as one decision: left or down keeps the piece, right or up gives it back. */
export function heroKeyTarget(key: string): 0 | 100 | null {
  if (['ArrowLeft', 'ArrowDown', 'Home', 'PageDown'].includes(key)) return 0;
  if (['ArrowRight', 'ArrowUp', 'End', 'PageUp'].includes(key)) return 100;
  return null;
}

/** The step a key moves to in a vertical tab list of `count` steps (wrapping), or null for other keys. */
export function stepForKey(key: string, current: number, count = 3): number | null {
  if (key === 'ArrowDown' || key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** How long each step shows before the next one, in ms. */
export const STEP_MS = 4500;

/** Advances a step timer: the new elapsed time and the step to show. Paused sections do not move. */
export function stepTick(elapsed: number, dt: number, current: number, paused: boolean, count = 3): { elapsed: number; step: number } {
  if (paused) return { elapsed, step: current };
  const next = elapsed + Math.min(64, Math.max(0, dt));
  return next >= STEP_MS ? { elapsed: 0, step: (current + 1) % count } : { elapsed: next, step: current };
}

/** Scale of a fixed-size drawing (`base` px wide) in a column `width` px wide. */
export function fitScale(width: number, base: number): number {
  return width > 0 && base > 0 ? Number((width / base).toFixed(4)) : 1;
}

/** The closing panorama (1440 x 292) centred in a band `width` px wide, never smaller than 62%. */
export function panoramaFit(width: number): { x: number; scale: number; height: number } {
  const scale = Math.max(width / 1440, 0.62);
  return { x: (width - 1440 * scale) / 2, scale, height: 292 * scale + 40 };
}

/** "Questions teams ask.": only what is true today. */
export const FAQ: { id: string; question: string; answer: string }[] = [
  {
    id: 'code-connect',
    question: 'We already use Figma Code Connect. Why Bridge?',
    answer: 'Code Connect links Figma components to code that already exists. Bridge brings what your explorations create into the design system, reviewed in the product, then the code and your Figma kit follow.',
  },
  { id: 'git', question: 'Do I need to know Git?', answer: 'No. Studio speaks Figma words: branch, review, merge. Claude AI and your developers handle the rest.' },
  {
    id: 'developers',
    question: 'Do our developers have to change how they work?',
    answer: 'No. They keep GitHub, their editor and their tools. Changes from Bridge reach them as regular pull requests, with the checks already run.',
  },
  {
    id: 'existing',
    question: 'Does it work with our existing design system?',
    answer: 'Bridge reads a design system that lives in code on GitHub, with DTCG tokens. Run npx @bridge-ds/cli init in your repo to set it up.',
  },
  { id: 'open-source', question: 'Is Bridge open source?', answer: 'Yes. MIT licensed and free. The code is on GitHub and contributions are welcome.' },
];

export interface QueueItem {
  id: string;
  title: string;
  who: string;
  kind: string;
}

/** The three changes waiting on the design system lead in the demo queue. */
export const QUEUE: QueueItem[] = [
  { id: 'bg', title: 'Darker default background', who: 'Claude AI', kind: 'Token change' },
  { id: 'ph', title: 'Profile header', who: 'Ann', kind: 'New component' },
  { id: 'fr', title: 'Focus ring offset', who: 'Claude AI', kind: 'Token change' },
];

/** The queue after approving `id`: what is still waiting and which change to show next (null when none is left). */
export function approveInQueue(items: QueueItem[], done: ReadonlySet<string>, id: string): { done: Set<string>; selected: string | null } {
  const next = new Set(done).add(id);
  const left = items.filter((q) => !next.has(q.id));
  return { done: next, selected: left[0]?.id ?? null };
}

/** The queue after undoing the approval of `id`: it waits again and is shown. */
export function undoInQueue(done: ReadonlySet<string>, id: string): { done: Set<string>; selected: string } {
  const next = new Set(done);
  next.delete(id);
  return { done: next, selected: id };
}
