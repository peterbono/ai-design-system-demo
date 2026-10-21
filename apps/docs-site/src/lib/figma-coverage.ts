// Which components are in Figma: the coverage list `npm run specs` writes into packages/react/component-specs.json
// (generated, drafted with Claude, not supported yet with the generator's reason, or a layout helper with nothing to draw). The Studio
// Components page shows it as a quiet "In Figma" column. Same data as the DS Bridge plugin's Pull tab.

import type { ComponentSpecsFile, SpecCoverage } from '@bridge-ds/core';
import { repoModel } from './model';

/** Repo-relative specs file: bridge.config.json components.specs, else packages/react/component-specs.json. */
export const SPECS_FILE = repoModel.specs.path;

/** The component specs file, parsed (by the repo model); null when the repo has none or it does not parse. */
export const loadComponentSpecs = (): ComponentSpecsFile | null => repoModel.specs.file;

const coverage = new Map(repoModel.specs.coverage.map((c) => [c.name, c]));

/** Component folder name -> coverage entry; empty when the repo has no specs file or an older one without coverage. */
export const loadFigmaCoverage = (): Map<string, SpecCoverage> => coverage;

// The words of each state live in @bridge-ds/core (component-spec.ts), shared with the MCP server and the CLI.
export { figmaCell } from '@bridge-ds/core';
