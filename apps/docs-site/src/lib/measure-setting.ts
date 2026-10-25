// Studio, Settings, Claude: the measure of the team's components, which lets Claude fix what differs in Figma. One
// sentence for everyone (measured on a day, set up and waiting for its first run, or not yet), and in the developer
// fold "Set up automatic measure": a pull request that adds the workflow (core measureWorkflowYaml), or, when GitHub
// does not let Bridge write workflows, the file filled in on GitHub. Words and small rules; pure, so tests read them.

import { MEASURE_BRANCH, MEASURE_MISSING_TEXT, MEASURE_SETUP_ACTION, MEASURE_WORKFLOW_FILE } from '@bridge-ds/core';
import { shortDay } from './claude-connector';

export const MEASURE_WORDS = {
  label: 'Measure of your components',
  missing: MEASURE_MISSING_TEXT,
  waiting: 'The automatic measure is set up. Its first run measures your components; Claude can fix them after that.',
  sample: 'On the sample team, the components are not measured.',
  checking: 'Checking the measure.',
  unknown: 'Bridge could not check the measure right now. Try again in a minute.',
  action: MEASURE_SETUP_ACTION,
  busy: 'Opening the pull request',
  what: `${MEASURE_SETUP_ACTION} adds one workflow to your repository. It measures your Storybook each time it changes and publishes the measure for Claude. Someone on your team reviews it like any change.`,
  sent: 'Sent for review. Once it is merged, run it once from GitHub Actions (Bridge measure, Run workflow), or wait for the next Storybook change.',
  needsGitHub: 'GitHub lets only people add workflows from here. Commit it from GitHub: the file is filled in.',
  openOnGitHub: 'Open on GitHub',
  copy: 'Copy the workflow',
  copied: 'Workflow copied',
  signIn: 'Sign in with GitHub to set it up.',
} as const;

export type MeasureState = { kind: 'measured'; at: string; auto: boolean } | { kind: 'waiting' } | { kind: 'missing' } | { kind: 'unknown' };

/** "Bridge measured your components on Oct 25, 2026. Claude uses it to fix what differs in Figma." */
export function measureSentence(s: MeasureState): string {
  switch (s.kind) {
    case 'measured':
      return s.auto
        ? `Bridge measured your components on ${shortDay(s.at)}. Claude uses it to fix what differs in Figma.`
        : `Bridge measured your components once, on ${shortDay(s.at)}. A developer keeps it fresh: ${MEASURE_SETUP_ACTION}.`;
    case 'waiting':
      return MEASURE_WORDS.waiting;
    case 'missing':
      return MEASURE_WORDS.missing;
    default:
      return MEASURE_WORDS.unknown;
  }
}

/** From what GitHub said: the last commit of the measure on its branch, and whether the workflow is on the default branch. */
export function measureState(lastMeasure: { date: string } | undefined, workflow: boolean): MeasureState {
  if (lastMeasure) return { kind: 'measured', at: lastMeasure.date, auto: workflow };
  return workflow ? { kind: 'waiting' } : { kind: 'missing' };
}

/** The pull request that adds the workflow: branch, commit message, title and body. */
export function measureSetupProposal(o: { prefix: string; date: Date; storybook?: string | undefined; tierLabel: string }) {
  const stamp = o.date.toISOString().slice(0, 10).replace(/-/g, '');
  const how = o.storybook ? `after each deploy of ${o.storybook}` : 'on each push that changes it, building Storybook in the run';
  return {
    branch: `${o.prefix}measure-setup-${stamp}`,
    title: 'ci: set up the automatic measure for Claude',
    message: `ci: set up the automatic measure for Claude\n\nAdds ${MEASURE_WORKFLOW_FILE} (Studio, Settings, ${MEASURE_SETUP_ACTION}).`,
    body: [
      `Adds \`${MEASURE_WORKFLOW_FILE}\`, from Studio (Settings, Claude, ${MEASURE_SETUP_ACTION}).`,
      '',
      `It measures what your Storybook draws (\`bridge specs --measure\`, headless Chrome) ${how}, every Monday as a fallback, and by hand. It publishes \`measured-specs.json\` and the story shots to the \`${MEASURE_BRANCH}\` branch, only when the measure changed. The Claude fix tools, the Figma plugin ("Ask Claude to fix it") and Studio read it there.`,
      '',
      `Token: only the run's \`GITHUB_TOKEN\`, with \`contents: write\` to push \`${MEASURE_BRANCH}\`. No secret to add. Your default branch is never written.`,
      '',
      'After merging: Actions, Bridge measure, Run workflow, for the first measure.',
      '',
      `Risk: ${o.tierLabel}.`,
    ].join('\n'),
  };
}

/** GitHub refused to write a workflow file: the GitHub App or token has no Workflows permission. */
export const isWorkflowRefusal = (err: unknown) => {
  const e = err as { status?: number; message?: string; detail?: string } | null;
  const text = `${e?.message ?? ''} ${e?.detail ?? ''}`;
  return /workflow/i.test(text) && (e?.status === 403 || e?.status === 404 || e?.status === 422 || /refusing|permission|scope/i.test(text));
};

/**
 * GitHub's "new file" page with the workflow filled in (the person commits it there, as a pull request). The content
 * rides in the address only when it stays short enough for every browser; otherwise the name alone, with Copy.
 */
export function newWorkflowUrl(repo: { owner: string; repo: string; defaultBranch: string }, yaml: string): { url: string; filled: boolean } {
  const base = `https://github.com/${repo.owner}/${repo.repo}/new/${encodeURIComponent(repo.defaultBranch)}?filename=${encodeURIComponent(MEASURE_WORKFLOW_FILE)}`;
  const full = `${base}&value=${encodeURIComponent(yaml)}`;
  return full.length <= 8000 ? { url: full, filled: true } : { url: base, filled: false };
}
