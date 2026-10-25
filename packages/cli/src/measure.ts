// bridge measure setup: writes the automatic measure workflow (.github/workflows/bridge-measure.yml) into the team's
// repo, from the one generator in core (measureWorkflowYaml). The workflow measures the team's Storybook each time it
// changes and publishes the measure to the bridge-requests branch, where the Claude fix tools, the Figma plugin and
// Studio read it. Nothing is committed: the developer commits it, or Studio opens it as a pull request.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CONFIG_FILE, MEASURE_BRANCH, MEASURE_WORKFLOW_FILE, measureWorkflowOptionsFromConfig, measureWorkflowYaml, type MeasureWorkflowOptions } from '@bridge-ds/core';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';

export const MEASURE_HELP = `bridge measure setup: keep the measure of your components fresh, automatically

Usage:
  bridge measure setup [--storybook <url> | --build] [--deploy-name storybook] [--build-command "npm run build-storybook"]
                       [--dir storybook-static] [--paths "src/**,.storybook/**"] [--force] [--print] [--json]
      Writes ${MEASURE_WORKFLOW_FILE}: a GitHub Actions workflow that measures your Storybook
      (bridge specs --measure, headless Chrome) each time it changes, and publishes measured-specs.json and
      the story shots to the ${MEASURE_BRANCH} branch, only when the measure changed. Claude reads it there to
      fix what differs in Figma. It uses only the run's GITHUB_TOKEN.
      --storybook   your deployed Storybook: measured after each deploy of it from the default branch.
                    Default: previews.production.storybook in ${CONFIG_FILE}
      --build       build Storybook in the run instead (a private Storybook, or none deployed)
      --deploy-name a word of the deploy's status name, to follow the Storybook's deploy (default storybook)
      --paths       what changes the Storybook (default: from ${CONFIG_FILE}, else src, packages, .storybook)
      --force       replace the workflow if it exists; --print writes it to stdout instead of the file
Then commit it (a pull request), merge, and run it once: Actions, Bridge measure, Run workflow.

Exit codes: 0 written (or already there), 2 usage error.`;

const flag = (a: RequestArgs, k: string) => {
  const v = a.flags[k]?.[a.flags[k]!.length - 1];
  return v === 'true' ? undefined : v;
};
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

/** `bridge measure <sub>`. */
export async function runMeasure(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const sub = a._[1];
  if (has(a, 'help') || !sub || sub === 'help') return io.print(MEASURE_HELP), sub || has(a, 'help') ? 0 : 2;
  if (sub !== 'setup') throw new RequestUsageError(`bridge measure ${sub}: unknown. Did you mean bridge measure setup?\n\n${MEASURE_HELP}`);

  const cfgPath = join(root, CONFIG_FILE);
  let config: unknown;
  if (existsSync(cfgPath)) {
    try {
      config = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      throw new RequestUsageError(`${CONFIG_FILE} is not valid JSON: ${(e as Error).message}. Fix it, or pass --storybook and --paths.`);
    }
  }
  const storybook = flag(a, 'storybook');
  if (storybook !== undefined && !/^https:\/\/\S+$/.test(storybook)) throw new RequestUsageError('--storybook is the address of your deployed Storybook, starting with https://. To build it in the run instead, use --build.');
  if (has(a, 'storybook') && storybook === undefined) throw new RequestUsageError('--storybook needs the address of your deployed Storybook (https://...).');
  const fromConfig = measureWorkflowOptionsFromConfig(config);
  const paths = flag(a, 'paths')?.split(',').map((p) => p.trim()).filter(Boolean);
  const options: MeasureWorkflowOptions = {
    ...fromConfig,
    ...(has(a, 'build') ? { storybookUrl: undefined } : storybook ? { storybookUrl: storybook } : {}),
    ...(flag(a, 'deploy-name') ? { deployName: flag(a, 'deploy-name') } : {}),
    ...(flag(a, 'build-command') ? { buildCommand: flag(a, 'build-command') } : {}),
    ...(flag(a, 'dir') ? { storybookDir: flag(a, 'dir') } : {}),
    ...(paths?.length ? { paths } : {}),
  };
  const yaml = measureWorkflowYaml(options);
  const how = options.storybookUrl ? `after each deploy of ${options.storybookUrl}` : 'on each push that changes it, building Storybook in the run';
  if (has(a, 'print')) return io.print(yaml), 0;

  const out = join(root, MEASURE_WORKFLOW_FILE);
  const exists = existsSync(out);
  const same = exists && readFileSync(out, 'utf8') === yaml;
  if (exists && !same && !has(a, 'force')) {
    const r = { status: 'exists', file: MEASURE_WORKFLOW_FILE };
    if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), 0;
    io.print(`${MEASURE_WORKFLOW_FILE} is already there, kept as it is (--force to replace it, --print to compare).`);
    return 0;
  }
  if (!same) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, yaml);
  }
  const next = [
    `Commit ${MEASURE_WORKFLOW_FILE} (a pull request) and merge it.`,
    'Then run it once: Actions, Bridge measure, Run workflow. It takes a few minutes per component family.',
    `After that it measures ${how}, and publishes the measure to the ${MEASURE_BRANCH} branch when it changed.`,
  ];
  if (has(a, 'json')) return io.print(JSON.stringify({ status: same ? 'unchanged' : exists ? 'replaced' : 'written', file: MEASURE_WORKFLOW_FILE, storybook: options.storybookUrl ?? null, next }, null, 2)), 0;
  io.print(`${same ? 'Already up to date' : exists ? 'Replaced' : 'Wrote'} ${MEASURE_WORKFLOW_FILE}: it measures your Storybook ${how}.`);
  for (const line of next) io.print(`- ${line}`);
  return 0;
}
