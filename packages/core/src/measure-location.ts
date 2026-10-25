// Where the measure lives, and what Bridge says when there is none. The measure (`bridge specs --measure`:
// measured-specs.json and its story shots in measured-shots/) is data, not code: the automatic measure workflow
// (templates/bridge-measure.yml) publishes it to the requests branch, next to the plugin's figma-fidelity.json, so it
// never adds review noise. A measure committed at the repo root on purpose still wins.
// Every reader looks in the same two places, in the same order: the Claude fix tools (MCP, CLI), the Figma plugin's
// pull and its "Ask Claude to fix it", and Studio.
//
// Pure and browser safe.

import { DEFAULT_MEASURED_SPECS_FILE } from './figma-fix-run';
import { REQUESTS_BRANCH } from './requests';

/** The data branch the automatic measure publishes to: the requests branch the plugin already writes to. */
export const MEASURE_BRANCH = REQUESTS_BRANCH;
/** The story shots folder `bridge specs --measure --shots` writes next to measured-specs.json. */
export const MEASURED_SHOTS_DIR = 'measured-shots';
/** The workflow that keeps the measure fresh, in the team's repo. */
export const MEASURE_WORKFLOW_FILE = '.github/workflows/bridge-measure.yml';

/** The one action that turns the measure on, as Studio and the plugin name it. */
export const MEASURE_SETUP_ACTION = 'Set up automatic measure';
/** What a designer reads when there is no measure yet: calm, and the next step. */
export const MEASURE_MISSING_TEXT = `Bridge hasn't measured your components yet. A developer turns it on once: ${MEASURE_SETUP_ACTION}.`;

/** How a developer turns it on, in lines (the copied request, the MCP tools, the CLI). */
export function measureSetupSteps(repo?: string): string[] {
  return [
    `${MEASURE_SETUP_ACTION}${repo ? ` for ${repo}` : ''}, once:`,
    `- In Bridge Studio: Settings, For developers, ${MEASURE_SETUP_ACTION}. It opens a pull request that adds ${MEASURE_WORKFLOW_FILE}.`,
    `- Or in the repository: npx @bridge-ds/cli measure setup, then commit ${MEASURE_WORKFLOW_FILE}.`,
    `Once it is merged, the workflow measures the Storybook each time it changes and publishes ${DEFAULT_MEASURED_SPECS_FILE} to the ${MEASURE_BRANCH} branch.`,
  ];
}

/** Where a measure was found: the repo at the ref read, or the measure branch. */
export interface FoundMeasure {
  text: string;
  /** Its path, the same in both places. */
  path: string;
  /** Undefined: the repo (at the ref the reader works on); else the branch it came from. */
  branch?: string | undefined;
}

/** Reads one file: from the repo at the reader's ref, or from a named branch. Undefined when it is not there. */
export interface MeasureFiles {
  repo(path: string): Promise<string | null | undefined>;
  /** Undefined when the reader cannot reach GitHub (local, no token): only the repo is read then. */
  branch?: ((path: string, branch: string) => Promise<string | null | undefined>) | undefined;
}

/**
 * The measure, where the readers agree it lives: `path` in the repo first (a measure committed on purpose), else on
 * the measure branch (the automatic measure). Undefined when neither has it. A branch read that fails (no access, the
 * network) counts as not there: the caller then says the measure is missing, calmly.
 */
export async function findMeasure(files: MeasureFiles, path: string = DEFAULT_MEASURED_SPECS_FILE): Promise<FoundMeasure | undefined> {
  const local = await files.repo(path);
  if (local) return { text: local, path };
  if (!files.branch) return undefined;
  const remote = await files.branch(path, MEASURE_BRANCH).catch(() => undefined);
  return remote ? { text: remote, path, branch: MEASURE_BRANCH } : undefined;
}

/** "measured-specs.json" or "measured-specs.json on bridge-requests". */
export const measureFromWords = (m: Pick<FoundMeasure, 'path' | 'branch'>) => (m.branch ? `${m.path} on ${m.branch}` : m.path);

/** The folder a measure's shot paths are relative to: the folder of measured-specs.json ('' at the root). */
export const measureDir = (path: string) => (path.includes('/') ? path.replace(/\/[^/]*$/, '') : '');

/** Thrown by readers when there is no measure: the message is the designer sentence, the steps follow for a developer. */
export class MeasureMissingError extends Error {
  readonly code = 'measure-missing';
  readonly steps: string[];
  constructor(repo?: string, extra: string[] = []) {
    const steps = [...measureSetupSteps(repo), ...extra];
    super([MEASURE_MISSING_TEXT, '', ...steps].join('\n'));
    this.name = 'MeasureMissingError';
    this.steps = steps;
  }
}
