// Which components are in Figma: the coverage list `npm run specs` writes into packages/react/component-specs.json
// (generated, drafted with Claude, not supported yet with the generator's reason, or a layout helper with nothing to draw). The Studio
// Components page shows it as a quiet "In Figma" column. Same data as the DS Bridge plugin's Pull tab.

import { parseComponentSpecs, type ComponentSpecsFile, type SpecCoverage } from '@bridge-ds/core';
import { exists, readJson, readText } from './repo';

export const SPECS_FILE = 'packages/react/component-specs.json';

/** The component specs file, parsed; null when the repo has none or it does not parse. */
export function loadComponentSpecs(): ComponentSpecsFile | null {
  if (!exists(SPECS_FILE)) return null;
  try {
    return parseComponentSpecs(readText(SPECS_FILE));
  } catch {
    return null;
  }
}

/** Component folder name -> coverage entry; empty when the repo has no specs file or an older one without coverage. */
export function loadFigmaCoverage(): Map<string, SpecCoverage> {
  if (!exists(SPECS_FILE)) return new Map();
  const file = readJson<{ coverage?: SpecCoverage[] }>(SPECS_FILE);
  return new Map((file.coverage ?? []).map((c) => [c.name, c]));
}

// The words of each state live in @bridge-ds/core (component-spec.ts), shared with the MCP server and the CLI.
export { figmaCell } from '@bridge-ds/core';
