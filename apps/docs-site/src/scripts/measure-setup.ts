// Settings, Claude, Measure of your components (components/ds/studio/MeasureSetting.tsx): reads whether Bridge measured
// the team's components (the last commit of measured-specs.json on the measure branch, and the workflow on the default
// branch), and "Set up automatic measure": a pull request that adds the workflow, with the reader's own token. The
// workflow comes from the team's bridge.config.json as it is on the default branch (core measureWorkflowYaml), the
// same file `bridge measure setup` writes. Words: lib/measure-setting.ts.
import {
  classifyRisk,
  DEFAULT_MEASURED_SPECS_FILE,
  GitHubError,
  MEASURE_BRANCH,
  MEASURE_WORKFLOW_FILE,
  measureWorkflowOptionsFromConfig,
  measureWorkflowYaml,
} from '@bridge-ds/core';
import { measureSetupProposal, measureState, type MeasureState } from '../lib/measure-setting';
import { getToken, readRepo, studioClient } from './github-session';

const missing = (e: unknown) => e instanceof GitHubError && (e.status === 404 || e.status === 409 || e.status === 422);

/** Where the team's measure stands. Reads only: works signed out on a public repository. */
export async function readMeasureState(): Promise<MeasureState> {
  const repo = readRepo();
  const gh = studioClient(`${repo.owner}/${repo.repo}`, getToken());
  const last = await gh
    .listCommits({ sha: MEASURE_BRANCH, path: DEFAULT_MEASURED_SPECS_FILE, perPage: 1 })
    .then((c) => c[0], (e) => (missing(e) ? undefined : Promise.reject(e)));
  if (last) return measureState(last, true);
  const workflow = await gh.readFile(MEASURE_WORKFLOW_FILE, repo.defaultBranch).catch(() => undefined);
  return measureState(undefined, workflow !== undefined);
}

/** The workflow for this team, from its bridge.config.json on the default branch (defaults without one). */
export async function measureWorkflowForTeam(): Promise<{ yaml: string; storybook?: string | undefined; config: Record<string, any> | undefined }> {
  const repo = readRepo();
  const gh = studioClient(`${repo.owner}/${repo.repo}`, getToken());
  const text = await gh.readFile('bridge.config.json', repo.defaultBranch).catch(() => undefined);
  let config: Record<string, any> | undefined;
  try {
    config = text ? (JSON.parse(text) as Record<string, any>) : undefined;
  } catch {
    config = undefined;
  }
  const options = { ...measureWorkflowOptionsFromConfig(config), defaultBranch: repo.defaultBranch };
  return { yaml: measureWorkflowYaml(options), storybook: options.storybookUrl, config };
}

/**
 * "Set up automatic measure": the workflow on a new branch and a pull request to the default branch. Throws GitHub's
 * error as is: a refusal to write a workflow (no Workflows permission) is told apart by the caller (isWorkflowRefusal).
 */
export async function openMeasureSetup(): Promise<{ number: number; url: string }> {
  const token = getToken();
  if (!token) throw new Error('signin');
  const repo = readRepo();
  const { yaml, storybook, config } = await measureWorkflowForTeam();
  const governance = (config?.governance ?? {}) as { branchPrefix?: string; protectedBranches?: string[] };
  const prefix = governance.branchPrefix ?? 'bridge/';
  const gh = studioClient(`${repo.owner}/${repo.repo}`, token, {
    protectedBranches: [...new Set([...(governance.protectedBranches ?? []), 'main', 'master', repo.defaultBranch])],
    branchPrefix: prefix || undefined,
  });
  const risk = classifyRisk({ files: [{ path: MEASURE_WORKFLOW_FILE, status: 'added' }] });
  const p = measureSetupProposal({ prefix, date: new Date(), storybook, tierLabel: `Tier ${risk.tier}${risk.reasons[0] ? ` (${risk.reasons[0]})` : ''}` });
  let branch = p.branch;
  for (let i = 2; await gh.getBranchSha(branch); i++) branch = `${p.branch}-${i}`;
  await gh.commitToNewBranch({ base: repo.defaultBranch, branch, message: p.message, files: [{ path: MEASURE_WORKFLOW_FILE, content: yaml }] });
  const pr = await gh.createPullRequest({ title: p.title, head: branch, base: repo.defaultBranch, body: p.body, draft: false });
  await gh.addLabels(pr.number, ['source: bridge-web', `tier-${risk.tier}`]).catch(() => false);
  return pr;
}
