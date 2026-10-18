import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeRequestIssue, type ComponentChangeRequest } from '@bridge-ds/core';
import {
  freshList,
  implementCommand,
  integrationsFromForm,
  integrationsProblems,
  integrationsProposal,
  jiraKeyFrom,
  linkPulls,
  buildState,
  onItLabel,
  overviewRequestsLine,
  requestImages,
  requestOwner,
  requestStateLine,
  parseList,
  requestFormProblems,
  requestFromForm,
  requestRows,
  requestsSummary,
  REQUESTS_TTL_MS,
  withIntegrations,
  type IssueLike,
  type PullLike,
} from './requests-view';

const req = (over: Partial<ComponentChangeRequest> = {}): ComponentChangeRequest => ({
  component: 'Button',
  kind: 'new-variant',
  title: 'Add a danger ghost variant',
  summary: 'Destructive actions in toolbars.',
  changes: [{ field: 'variant', before: 'ghost', after: 'danger-ghost' }],
  source: 'figma',
  requestedBy: 'designer',
  ...over,
});

function issue(n: number, over: Partial<IssueLike> = {}, r = req()): IssueLike {
  const composed = composeRequestIssue(r);
  return {
    number: n,
    title: composed.title,
    body: composed.body,
    html_url: `https://github.com/o/r/issues/${n}`,
    state: 'open',
    state_reason: null,
    labels: composed.labels.map((name) => ({ name })),
    user: { login: 'bot' },
    created_at: `2026-10-0${n}T10:00:00Z`,
    ...over,
  };
}

const pull = (n: number, body: string, over: Partial<PullLike> = {}): PullLike => ({ number: n, body, state: 'open', merged_at: null, html_url: `https://github.com/o/r/pull/${n}`, ...over });

describe('linkPulls', () => {
  it('links a pull request to every issue its body closes', () => {
    const m = linkPulls([pull(40, 'Closes #1 and fixes #2'), pull(41, 'Resolves #2', { state: 'closed', merged_at: '2026-10-10T00:00:00Z' }), pull(42, 'Refs #3')]);
    expect(m.get(1)).toEqual([{ number: 40, url: 'https://github.com/o/r/pull/40', state: 'open', merged: false, author: null }]);
    expect(m.get(2)?.map((p) => [p.number, p.merged])).toEqual([
      [40, false],
      [41, true],
    ]);
    expect(m.has(3)).toBe(false);
  });

  it('counts a pull request once when the open and closed lists overlap', () => {
    expect(linkPulls([pull(40, 'Closes #1'), pull(40, 'Closes #1')]).get(1)).toHaveLength(1);
  });
});

describe('requestRows', () => {
  it('builds rows with status, kind, requester, linked PR and Jira key, waiting first', () => {
    const issues = [
      issue(1),
      issue(2, { labels: [{ name: 'component-change' }, { name: 'jira: ds-12' }] }),
      issue(3, { state: 'closed', state_reason: 'completed' }),
      issue(4, { state: 'closed', state_reason: 'not_planned' }),
      { ...issue(5), labels: [{ name: 'bug' }] },
    ];
    const rows = requestRows(issues, [pull(40, 'Closes #2')]);
    expect(rows.map((r) => [r.number, r.status])).toEqual([
      [1, 'requested'],
      [2, 'in-progress'],
      [3, 'done'],
      [4, 'declined'],
    ]);
    const first = rows[0]!;
    expect(first).toMatchObject({ component: 'Button', kindLabel: 'New variant', title: 'Add a danger ghost variant', requester: 'designer', statusLabel: 'Requested', tone: 'is-info' });
    expect(rows[1]!.prs[0]!.number).toBe(40);
    expect(rows[1]!.jiraKey).toBe('DS-12');
    expect(rows[2]!.tone).toBe('is-pass');
    expect(rows[3]!.tone).toBe('');
  });

  it('reads an issue without a Bridge block from its title and labels', () => {
    const [row] = requestRows([{ ...issue(7), body: 'Please add it', labels: [{ name: 'component-change' }, { name: 'request: visual' }], title: 'Card: tighter padding' }], []);
    expect(row).toMatchObject({ component: 'Card', title: 'tighter padding', kindLabel: 'Visual change', requester: 'bot', request: null });
  });

  it('a merged closing pull request makes a closed request done', () => {
    const [row] = requestRows([issue(1, { state: 'closed', state_reason: null })], [pull(9, 'fixes #1', { state: 'closed', merged_at: '2026-10-10T00:00:00Z' })]);
    expect(row!.status).toBe('done');
  });
});

describe('summaries', () => {
  const s = (...xs: string[]) => xs.map((status) => ({ status: status as 'requested' }));
  it('says what waits first', () => {
    expect(requestsSummary(s('requested', 'requested', 'requested', 'in-progress', 'done'))).toBe('3 requests waiting, 1 in progress.');
    expect(requestsSummary(s('in-progress'))).toBe('1 in progress.');
    expect(requestsSummary(s('done', 'declined'))).toBe('Nothing waits. 2 requests are done or declined.');
    expect(requestsSummary([])).toBe('No component change request yet.');
  });

  it('gives the Overview a line only when a request waits', () => {
    expect(overviewRequestsLine(s('requested', 'requested', 'in-progress'))).toBe('2 component requests waiting');
    expect(overviewRequestsLine(s('requested'))).toBe('1 component request waiting');
    expect(overviewRequestsLine(s('done'))).toBeNull();
  });

  it('names the Claude command', () => {
    expect(implementCommand(12)).toBe('bridge request implement 12');
  });

  it('keeps a cached list for ten minutes', () => {
    expect(freshList({ at: 1000, data: [] }, 1000 + REQUESTS_TTL_MS - 1)).toBe(true);
    expect(freshList({ at: 1000, data: [] }, 1000 + REQUESTS_TTL_MS)).toBe(false);
    expect(freshList(null, 0)).toBe(false);
  });
});

describe('request form', () => {
  const form = { kind: 'visual', title: ' Tighter padding ', summary: 'Dense tables', changes: [{ field: 'padding', before: '16', after: '12' }, { field: ' ', before: '', after: '' }] };
  it('flags missing fields with how to fix them', () => {
    expect(requestFormProblems({ ...form, kind: 'nope', title: '', summary: '' })).toHaveLength(3);
    expect(requestFormProblems(form)).toEqual([]);
  });
  it('builds a studio request and drops empty change rows', () => {
    expect(requestFromForm('Card', form, 'me')).toEqual({
      component: 'Card',
      kind: 'visual',
      title: 'Tighter padding',
      summary: 'Dense tables',
      changes: [{ field: 'padding', before: '16', after: '12' }],
      source: 'studio',
      requestedBy: 'me',
    });
  });
});

describe('integrations', () => {
  const blank = { baseUrl: '', project: '', issueType: 'Task', jiraLabels: '', requestLabels: '', assignees: '' };
  it('parses lists and logins', () => {
    expect(parseList('a, b ,a,,c')).toEqual(['a', 'b', 'c']);
    expect(parseList('@florian, dev', { logins: true })).toEqual(['florian', 'dev']);
  });

  it('builds the block from the form, Task by default', () => {
    expect(integrationsFromForm({ ...blank, baseUrl: 'https://acme.atlassian.net/', project: 'ds', jiraLabels: 'design-system' })).toEqual({
      jira: { baseUrl: 'https://acme.atlassian.net', project: 'DS', labels: ['design-system'] },
    });
    expect(integrationsFromForm({ ...blank, assignees: '@dev' })).toEqual({ requests: { assignees: ['dev'] } });
  });

  it('validates with the core rules and refuses an empty form', () => {
    expect(integrationsProblems(integrationsFromForm({ ...blank, baseUrl: 'http://x', project: 'D' }))).toHaveLength(2);
    expect(integrationsProblems({})).toHaveLength(1);
    expect(integrationsProblems(integrationsFromForm({ ...blank, baseUrl: 'https://acme.atlassian.net', project: 'DS' }))).toEqual([]);
  });

  it('edits bridge.config.json with a minimal diff', () => {
    const text = readFileSync(join(__dirname, '../../../../bridge.config.json'), 'utf8');
    const next = withIntegrations(text, { jira: { baseUrl: 'https://acme.atlassian.net', project: 'DS' } });
    expect(next.startsWith(text.trimEnd().replace(/\n\}$/, ''))).toBe(true);
    expect(JSON.parse(next).integrations).toEqual({ jira: { baseUrl: 'https://acme.atlassian.net', project: 'DS' } });
    // Replacing it again changes only the block.
    const again = withIntegrations(next, { jira: { baseUrl: 'https://acme.atlassian.net', project: 'WEB' } });
    expect(JSON.parse(again).integrations.jira.project).toBe('WEB');
    expect(again.length).toBe(next.length + 1);
  });

  it('writes a proposal on a prefixed branch', () => {
    const p = integrationsProposal(
      { jira: { baseUrl: 'https://acme.atlassian.net', project: 'DS' } },
      { date: new Date('2026-10-17T00:00:00Z'), prefix: 'bridge/', tierLabel: 'Tier 3', workflowUrl: 'w', secretsUrl: 's' },
    );
    expect(p.branch).toBe('bridge/integrations-jira-20261017');
    expect(p.title).toBe('chore(config): connect Jira DS for component change requests');
    expect(p.body).toContain('JIRA_API_TOKEN');
    expect(p.body).not.toContain('—');
  });
});

describe('jiraKeyFrom', () => {
  it('reads string and object labels', () => {
    expect(jiraKeyFrom(['jira: WEB-7'])).toBe('WEB-7');
    expect(jiraKeyFrom([{ name: 'jira:DS-1' }])).toBe('DS-1');
    expect(jiraKeyFrom([{ name: 'jira' }])).toBeNull();
  });
});

describe('who is on a request', () => {
  it('reads the assignee first, then the author of the open change, else nobody', () => {
    const [waiting] = requestRows([issue(1)], []);
    expect(requestOwner(waiting!)).toBeNull();
    expect(onItLabel(waiting!)).toBe('');
    expect(requestStateLine(waiting!)).toBe('Waiting for a developer to pick it up.');
    expect(buildState(waiting!)).toBe('Not started');

    const [assigned] = requestRows([issue(1, { assignees: [{ login: 'dev' }] })], []);
    expect(onItLabel(assigned!)).toBe('@dev is on it');
    expect(requestStateLine(assigned!)).toBe('In progress by @dev.');

    const [building] = requestRows([issue(1)], [pull(40, 'Closes #1', { user: { login: 'ana' } })]);
    expect(requestOwner(building!)).toBe('ana');
    expect(requestStateLine(building!)).toBe('In progress by @ana.');
    expect(buildState(building!)).toBe('In review');
  });

  it('says who finished it, and keeps declined plain', () => {
    const [done] = requestRows([issue(1, { state: 'closed', state_reason: 'completed' })], [pull(9, 'fixes #1', { state: 'closed', merged_at: '2026-10-10T00:00:00Z', user: { login: 'ana' } })]);
    expect(onItLabel(done!)).toBe('Done by @ana');
    expect(requestStateLine(done!)).toBe('Done by @ana.');
    expect(buildState(done!)).toBe('Shipped');
    const [plain] = requestRows([issue(2, { state: 'closed', state_reason: 'completed' })], []);
    expect(requestStateLine(plain!)).toBe('Done.');
    expect(onItLabel(plain!)).toBe('');
    const [declined] = requestRows([issue(3, { state: 'closed', state_reason: 'not_planned' })], []);
    expect(onItLabel(declined!)).toBe('');
    expect(requestStateLine(declined!)).toBe('Declined: closed on GitHub without a change.');
  });
});

describe('requestImages', () => {
  it('reads two images as the baseline and the frame in Figma', () => {
    const [row] = requestRows([issue(1, {}, req({ images: ['https://x/before.png', 'https://x/after.png'] }))], []);
    expect(requestImages(row!)).toEqual({ pair: { before: 'https://x/before.png', after: 'https://x/after.png' }, single: [], thumb: 'https://x/before.png' });
  });

  it('shows one image on its own, drops non https links, and has no thumb without images', () => {
    const [one] = requestRows([issue(1, {}, req({ images: ['http://x/a.png', 'https://x/b.png'] }))], []);
    expect(requestImages(one!)).toEqual({ pair: null, single: ['https://x/b.png'], thumb: 'https://x/b.png' });
    const [none] = requestRows([issue(2)], []);
    expect(requestImages(none!)).toEqual({ pair: null, single: [], thumb: null });
  });
});
