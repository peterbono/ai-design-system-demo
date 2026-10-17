// Component change requests over an in-memory GitHub: create (issue labeled component-change), list with status from
// linked pull requests ("Closes #n"), and the brief to implement one.
import { describe, expect, it } from 'vitest';
import { composeRequestIssue, type ComponentChangeRequest } from '@bridge-ds/core';
import { BridgeContext, requests } from '../dist/lib.js';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from './helpers.js';

const files = () => readTree(REPO, REAL_PATHS);
const ask = { component: 'Button', kind: 'new-variant' as const, title: 'Add a danger ghost variant', summary: 'Destructive actions in toolbars need a quieter danger button.', changes: [{ field: 'variant', after: 'danger-ghost' }] };

/** Seeds an issue the way Figma or Studio would file it. */
function seed(gh: ReturnType<typeof fakeGitHub>, r: Partial<ComponentChangeRequest> & Pick<ComponentChangeRequest, 'component' | 'title'>, state: { state?: string; state_reason?: string | null } = {}) {
  const issue = composeRequestIssue({ kind: 'visual', summary: 'Why.', changes: [], source: 'figma', ...r });
  const number = 100 + gh.issues.length;
  gh.issues.push({ number, title: issue.title, body: issue.body, state: state.state ?? 'open', state_reason: state.state_reason ?? null, labels: issue.labels.map((name) => ({ name })), user: { login: 'designer' }, html_url: `https://github.com/acme/ds/issues/${number}`, created_at: '2026-10-16T00:00:00Z', updated_at: '2026-10-16T00:00:00Z' });
  return number;
}

function pull(gh: ReturnType<typeof fakeGitHub>, body: string, state: { state: string; merged_at?: string }) {
  const number = gh.pulls.length + 1;
  gh.pulls.push({ number, title: `PR ${number}`, body, draft: false, user: { login: 'dev' }, head: { ref: `agent/request-${number}`, sha: 'x' }, base: { ref: 'main' }, labels: [], html_url: `https://github.com/acme/ds/pull/${number}`, updated_at: '2026-10-16T00:00:00Z', ...state });
}

describe('component change requests', () => {
  it('create: dry run without a token, refused without one, issue labeled component-change and source: mcp with one', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const ro = await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });
    const dry = (await requests.createRequest(ro, { ...ask, dryRun: true })) as any;
    expect(dry.status).toBe('dry-run');
    expect(dry.issue.title).toBe('Button: add a danger ghost variant');
    expect(dry.issue.labels).toEqual(['component-change', 'request: new-variant', 'source: mcp']);
    await expect(requests.createRequest(ro, ask)).rejects.toThrow(/GITHUB_TOKEN/);
    await expect(requests.createRequest(ro, { ...ask, kind: 'nope' as never })).rejects.toThrow(/Unknown kind/);
    expect(gh.issues).toHaveLength(0);

    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });
    const r = (await requests.createRequest(ctx, ask)) as any;
    expect(r).toMatchObject({ status: 'created', number: 100, url: 'https://github.com/acme/ds/issues/100' });
    expect(gh.issues[0]!.body).toContain('<!-- bridge-request ');
    expect(gh.issues[0]!.labels.map((l: any) => l.name)).toContain('source: mcp');
  });

  it('list: status from the issue state and the pull requests that close it, filters by status and component', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const requested = seed(gh, { component: 'Button', title: 'Rounder corners' });
    const inProgress = seed(gh, { component: 'Switch', title: 'Add a small size' });
    const done = seed(gh, { component: 'Button', title: 'Add an icon slot' }, { state: 'closed', state_reason: 'completed' });
    const declined = seed(gh, { component: 'Tabs', title: 'Vertical tabs' }, { state: 'closed', state_reason: 'not_planned' });
    pull(gh, `Adds the size.\n\nCloses #${inProgress}`, { state: 'open' });
    pull(gh, `Fixes #${done}`, { state: 'closed', merged_at: '2026-10-16T00:00:00Z' });
    const ctx = await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });

    const all = await requests.listRequests(ctx, {});
    const byNumber = Object.fromEntries(all.requests.map((r) => [r.number, r]));
    expect(byNumber[requested]!.status).toBe('requested');
    expect(byNumber[inProgress]!.status).toBe('in-progress');
    expect(byNumber[inProgress]!.linkedPrs).toEqual([{ number: 1, title: 'PR 1', state: 'open', url: 'https://github.com/acme/ds/pull/1' }]);
    expect(byNumber[done]!.status).toBe('done');
    expect(byNumber[done]!.linkedPrs[0]!.state).toBe('merged');
    expect(byNumber[declined]!.status).toBe('declined');
    expect(byNumber[requested]).toMatchObject({ component: 'Button', kind: 'visual', title: 'Rounder corners', url: `https://github.com/acme/ds/issues/${requested}` });

    expect((await requests.listRequests(ctx, { status: 'in-progress' })).requests.map((r) => r.number)).toEqual([inProgress]);
    expect((await requests.listRequests(ctx, { status: 'declined' })).requests.map((r) => r.number)).toEqual([declined]);
    expect((await requests.listRequests(ctx, { component: 'button' })).requests.map((r) => r.number).sort()).toEqual([requested, done]);
  });

  it('get: the request, the component files and the brief Claude implements', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const n = seed(gh, { component: 'Button', title: 'Add a danger ghost variant', kind: 'new-variant', changes: [{ field: 'variant', after: 'danger-ghost' }] });
    const ctx = await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });
    const r = await requests.getRequest(ctx, { number: n });
    expect(r.request.component).toBe('Button');
    expect(r.status).toBe('requested');
    expect(r.component.exists).toBe(true);
    expect(r.component.files).toContain('packages/react/src/components/Button/Button.tsx');
    expect(r.agentsFile).toBe('AGENTS.md');
    expect(r.brief).toContain(`Implement Bridge component change request #${n}`);
    expect(r.brief).toContain('- packages/react/src/components/Button/Button.module.css');
    expect(r.brief).toContain('Follow AGENTS.md');
    expect(r.brief).toContain(`Closes #${n}`);
    expect(r.brief).toContain('- variant: (none) -> danger-ghost');
    expect(r.brief).not.toMatch(/—/);
  });

  it('get: a new component has no files yet; a hand-made issue with the label still reads; other issues are refused', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const n = seed(gh, { component: 'Stepper', title: 'New stepper', kind: 'new-component' });
    gh.issues.push({ number: 150, title: 'Switch: thumb is off center', body: 'In compact density the thumb sits 1px low.', state: 'open', state_reason: null, labels: [{ name: 'component-change' }, { name: 'request: bug' }], user: { login: 'dev' }, html_url: 'https://github.com/acme/ds/issues/150', created_at: '', updated_at: '' });
    gh.issues.push({ number: 151, title: 'Docs typo', body: 'x', state: 'open', state_reason: null, labels: [], user: { login: 'dev' }, html_url: 'https://github.com/acme/ds/issues/151', created_at: '', updated_at: '' });
    const ctx = await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });
    const fresh = await requests.getRequest(ctx, { number: n });
    expect(fresh.component).toMatchObject({ exists: false, files: [], dir: 'packages/react/src/components/Stepper' });
    const hand = await requests.getRequest(ctx, { number: 150 });
    expect(hand.request).toMatchObject({ component: 'Switch', kind: 'bug', title: 'thumb is off center', summary: 'In compact density the thumb sits 1px low.' });
    await expect(requests.getRequest(ctx, { number: 151 })).rejects.toThrow(/not a component change request/);
  });
});
