// The homepage ("/", pages/index.astro): the pure parts of its behaviour (scripts/homepage.ts), so they are tested.
//   - Step tabs: three steps per section, arrow keys move between them, the active one advances on its own.
//   - The closing panorama scaled to its band.

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
    answer: 'Bridge reads a design system that lives in code on GitHub, with tokens in the W3C standard format. A developer sets it up with one command: npx @bridge-ds/cli init.',
  },
  { id: 'open-source', question: 'Is Bridge open source?', answer: 'Yes. MIT licensed and free. The code is on GitHub and contributions are welcome.' },
];
