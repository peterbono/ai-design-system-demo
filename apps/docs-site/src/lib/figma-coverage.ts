// Which components are in Figma: the coverage list `npm run specs` writes into packages/react/component-specs.json
// (generated, drafted with Claude, not supported yet with the generator's reason, or a layout helper with nothing to draw). The Studio
// Components page shows it as a quiet "In Figma" column. Same data as the DS Bridge plugin's Pull tab.

import type { SpecCoverage } from '@bridge-ds/core';
import { exists, readJson } from './repo';

export const SPECS_FILE = 'packages/react/component-specs.json';

/** Component folder name -> coverage entry; empty when the repo has no specs file or an older one without coverage. */
export function loadFigmaCoverage(): Map<string, SpecCoverage> {
  if (!exists(SPECS_FILE)) return new Map();
  const file = readJson<{ coverage?: SpecCoverage[] }>(SPECS_FILE);
  return new Map((file.coverage ?? []).map((c) => [c.name, c]));
}

/** The cell for a component: a short word and, for the ones not in Figma, the reason as a tooltip. Undefined: no data. */
export function figmaCell(entry: SpecCoverage | undefined): { label: string; title?: string } | undefined {
  if (!entry) return undefined;
  if (entry.status === 'generated') return { label: 'Yes' };
  if (entry.status === 'drafted') return { label: 'Drafted', title: 'Drafted with Claude where the code cannot be read on its own: in Figma, check it against the code.' };
  if (entry.status === 'layout') return { label: 'Auto layout', title: 'A layout helper: nothing to draw, use auto layout in Figma.' };
  return { label: 'Not yet', ...(entry.reason ? { title: `Not supported yet: ${entry.reason}` } : {}) };
}
