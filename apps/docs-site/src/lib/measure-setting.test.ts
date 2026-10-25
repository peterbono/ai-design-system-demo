// Settings, Claude, Measure of your components: the sentence everyone reads, and the pull request that sets it up.
import { describe, expect, it } from 'vitest';
import { GitHubError } from '@bridge-ds/core';
import { isWorkflowRefusal, MEASURE_WORDS, measureSentence, measureSetupProposal, measureState, newWorkflowUrl } from './measure-setting';

describe('the measure sentence', () => {
  it('measured: the day; set up and waiting: its first run; none: the calm sentence with the next step', () => {
    expect(measureSentence(measureState({ date: '2026-10-25T23:10:00Z' }, true))).toBe('Bridge measured your components on Oct 25, 2026. Claude uses it to fix what differs in Figma.');
    expect(measureSentence(measureState({ date: '2026-10-25T23:10:00Z' }, false))).toBe('Bridge measured your components once, on Oct 25, 2026. A developer keeps it fresh: Set up automatic measure.');
    expect(measureSentence(measureState(undefined, true))).toBe(MEASURE_WORDS.waiting);
    expect(measureSentence(measureState(undefined, false))).toBe("Bridge hasn't measured your components yet. A developer turns it on once: Set up automatic measure.");
    expect(measureSentence({ kind: 'unknown' })).toMatch(/Try again in a minute/);
  });

  it('no command, file or branch in what a designer reads, no em dash anywhere', () => {
    for (const k of ['missing', 'waiting', 'sample', 'what', 'sent', 'needsGitHub'] as const) expect(MEASURE_WORDS[k]).not.toMatch(/npx|json|bridge-requests|—/);
  });
});

describe('Set up automatic measure', () => {
  it('a pull request with the workflow, on a prefixed branch, saying what it does and what to do after', () => {
    const p = measureSetupProposal({ prefix: 'bridge/', date: new Date('2026-10-26T08:00:00Z'), storybook: 'https://sb.acme.dev', tierLabel: 'Tier 3 (guardrail)' });
    expect(p.branch).toBe('bridge/measure-setup-20261026');
    expect(p.title).toBe('ci: set up the automatic measure for Claude');
    expect(p.body).toMatch(/Adds `\.github\/workflows\/bridge-measure\.yml`/);
    expect(p.body).toMatch(/after each deploy of https:\/\/sb\.acme\.dev/);
    expect(p.body).toMatch(/`bridge-requests` branch, only when the measure changed/);
    expect(p.body).toMatch(/Actions, Bridge measure, Run workflow/);
    expect(p.body).toMatch(/Risk: Tier 3 \(guardrail\)\.$/);
    expect(measureSetupProposal({ prefix: '', date: new Date('2026-10-26T08:00:00Z'), tierLabel: 'Tier 3' }).body).toMatch(/building Storybook in the run/);
  });

  it('tells a refusal to write workflows from other errors', () => {
    expect(isWorkflowRefusal(new GitHubError(403, 'Forbidden', 'refusing to allow a GitHub App to create or update workflow `.github/workflows/bridge-measure.yml` without `workflows` permission'))).toBe(true);
    expect(isWorkflowRefusal(new GitHubError(404, 'Not found', 'refusing to allow an OAuth App to create or update workflow without workflow scope'))).toBe(true);
    expect(isWorkflowRefusal(new GitHubError(403, 'Forbidden', 'Resource not accessible by integration'))).toBe(false);
    expect(isWorkflowRefusal(new Error('network'))).toBe(false);
  });

  it('GitHub new file page: filled in when it fits, else the name alone', () => {
    const repo = { owner: 'acme', repo: 'ds', defaultBranch: 'main' };
    expect(newWorkflowUrl(repo, 'name: x\n')).toEqual({ url: 'https://github.com/acme/ds/new/main?filename=.github%2Fworkflows%2Fbridge-measure.yml&value=name%3A%20x%0A', filled: true });
    expect(newWorkflowUrl(repo, 'x'.repeat(9000))).toEqual({ url: 'https://github.com/acme/ds/new/main?filename=.github%2Fworkflows%2Fbridge-measure.yml', filled: false });
  });
});
