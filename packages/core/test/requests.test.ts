import { describe, expect, it } from 'vitest';
import { closingIssueNumbers, composeRequestIssue, jiraIssueFields, parseRequestIssue, requestBrief, requestImagePath, requestStatus, validateIntegrations, type ComponentChangeRequest } from '../src/index';

const req: ComponentChangeRequest = {
  component: 'Button',
  kind: 'new-variant',
  title: 'Add a danger ghost variant',
  summary: 'Destructive actions in dense tables need a quieter button.',
  changes: [{ field: 'variant', before: 'primary | secondary | ghost | danger', after: '+ danger-ghost' }],
  figma: { fileKey: 'abc', nodeId: '1:2', nodeName: 'Button / Danger ghost', url: 'https://www.figma.com/design/abc?node-id=1-2' },
  images: ['https://example.com/a.png'],
  source: 'figma',
  requestedBy: 'peterbono',
};

describe('component change requests', () => {
  it('round-trips through the issue body', () => {
    const issue = composeRequestIssue(req, { labels: ['design-system'] });
    expect(issue.title).toBe('Button: add a danger ghost variant');
    expect(issue.labels).toEqual(['component-change', 'request: new-variant', 'source: figma', 'design-system']);
    expect(issue.body).toContain('| variant | primary \\| secondary \\| ghost \\| danger | + danger-ghost |');
    expect(issue.body).not.toMatch(/—/);
    expect(parseRequestIssue(issue.body)).toEqual(req);
  });

  it('ignores issues without a Bridge block', () => {
    expect(parseRequestIssue('Just a bug report')).toBeUndefined();
    expect(parseRequestIssue('<!-- bridge-request {nope -->')).toBeUndefined();
  });

  it('derives the status from the issue and its linked pull requests', () => {
    expect(requestStatus({ state: 'open' })).toBe('requested');
    expect(requestStatus({ state: 'open', linkedPrs: [{ state: 'open' }] })).toBe('in-progress');
    expect(requestStatus({ state: 'closed', linkedPrs: [{ state: 'closed', merged: true }] })).toBe('done');
    expect(requestStatus({ state: 'closed', stateReason: 'completed' })).toBe('done');
    expect(requestStatus({ state: 'closed', stateReason: 'not_planned' })).toBe('declined');
  });

  it('finds the issues a pull request closes', () => {
    expect(closingIssueNumbers('Adds it.\n\nCloses #42, fixes #7 and resolves #42')).toEqual([42, 7]);
    expect(closingIssueNumbers('Refs #3')).toEqual([]);
  });

  it('writes a brief that tells Claude how to close the request', () => {
    const b = requestBrief(req, { issue: 42, files: ['packages/react/src/components/Button/Button.tsx'] });
    expect(b).toContain('Closes #42');
    expect(b).toContain('agent/request-42');
    expect(b).toContain('Button.tsx');
  });

  it('names request images by component and time', () => {
    expect(requestImagePath('Icon Button', new Date('2026-10-17T15:04:05.123Z'))).toBe('.bridge/requests/icon-button-20261017T150405.png');
  });

  it('validates the Jira block and maps a request to Jira fields', () => {
    expect(validateIntegrations({ jira: { baseUrl: 'acme.atlassian.net', project: 'ds' } })).toHaveLength(2);
    expect(validateIntegrations({ jira: { baseUrl: 'https://acme.atlassian.net', project: 'DS' } })).toEqual([]);
    const f = jiraIssueFields(req, { baseUrl: 'https://acme.atlassian.net', project: 'DS', labels: ['design system'] }, 'https://github.com/o/r/issues/42');
    expect(f.project).toEqual({ key: 'DS' });
    expect(f.summary).toBe('Button: add a danger ghost variant');
    expect(f.labels).toEqual(['bridge', 'component-change', 'design-system']);
  });
});
