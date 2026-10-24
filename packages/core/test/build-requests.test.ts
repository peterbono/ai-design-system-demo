// Pushes from Figma and build requests (docs/BUILD-REQUESTS.md): a push is design-approved, token values ship after
// the checks, renames and removals wait for a developer, structure changes become build requests whose status Bridge
// reads from GitHub only.
import { describe, expect, it } from 'vitest';
import {
  assembleBuildRequests,
  branchVerdict,
  buildRequestBrief,
  buildRequestStatus,
  buildSummaryLine,
  composeBuildRequestIssue,
  createBuildRequestOnGitHub,
  figmaAheadLine,
  figmaPushOf,
  figmaPushScope,
  figmaShipReviewBody,
  isBuildRequestIssue,
  isFigmaPush,
  libraryArrival,
  matchesBuildFilter,
  parseBuildRequestIssue,
  parseBuildSpec,
  parseRequestIssue,
  publishSummary,
  summarizeApprovals,
  summarizeCi,
  tokenFileChanges,
  tokenPublishRoute,
  withFigmaPushApprovals,
  type BuildIssueLike,
  type BuildPullLike,
  type BuildRequestInput,
  type GitHubClient,
} from '../src';

const tokenFiles = [{ path: 'packages/tokens/src/semantic/light/color.tokens.json' }, { path: '.changeset/tokens-x.md' }];
const owners = { design: ['ann'], tech: ['theo'] };
const green = summarizeCi([{ name: 'CI', status: 'completed', conclusion: 'success' }]);
const red = summarizeCi([{ name: 'CI', status: 'completed', conclusion: 'failure' }]);
const running = summarizeCi([{ name: 'CI', status: 'in_progress', conclusion: null }]);
const none = summarizeApprovals([], owners, 'sam');

describe('what a push from Figma changes', () => {
  it('knows a push from the plugin by its labels or its origin block', () => {
    expect(isFigmaPush({ labels: ['source: figma'] })).toBe(true);
    expect(isFigmaPush({ labels: [{ name: 'from-figma' }] })).toBe(true);
    expect(isFigmaPush({ labels: ['source: studio'] })).toBe(false);
    expect(isFigmaPush({ body: '<!-- bridge-from-figma {"component":"Button","figmaName":"Button","route":"claude-draft","kind":"new-variant"} -->' })).toBe(true);
  });

  it('reads the scope from the real files and token changes', () => {
    expect(figmaPushScope({ files: tokenFiles, tokenChanges: [{ kind: 'changed' }, { kind: 'added' }] })).toBe('token-values');
    expect(figmaPushScope({ files: tokenFiles, tokenChanges: [{ kind: 'changed' }, { kind: 'renamed' }] })).toBe('token-structure');
    expect(figmaPushScope({ files: tokenFiles, tokenChanges: [{ kind: 'removed' }] })).toBe('token-structure');
    expect(figmaPushScope({ files: tokenFiles, tokenChanges: null })).toBe('token-unknown');
    expect(figmaPushScope({ files: [...tokenFiles, { path: 'packages/react/src/components/Button/Button.tsx' }], tokenChanges: [] })).toBe('component');
    expect(figmaPushScope({ files: [...tokenFiles, { path: '.github/workflows/ci.yml' }], tokenChanges: [] })).toBe('outside');
    expect(figmaPushScope({ files: [...tokenFiles, { path: 'packages/tokens/src/contrast.checks.json' }], tokenChanges: [{ kind: 'changed' }] })).toBe('outside');
  });

  it('reads token change kinds from the token files of a pull request', () => {
    const before = JSON.stringify({ color: { a: { $type: 'color', $value: '#000' }, b: { $value: '#111', $description: 'x' }, gone: { $value: 1 } } });
    const after = JSON.stringify({ color: { a: { $type: 'color', $value: '#222' }, b: { $value: '#111', $description: 'y' }, fresh: { $value: 2 } } });
    expect(tokenFileChanges([{ before, after }])).toEqual([
      { kind: 'changed', path: 'color.a' },
      { kind: 'changed', path: 'color.b', descriptionOnly: true },
      { kind: 'removed', path: 'color.gone' },
      { kind: 'added', path: 'color.fresh' },
    ]);
    expect(tokenFileChanges([{ before: null, after }]).every((c) => c.kind === 'added')).toBe(true);
    expect(() => tokenFileChanges([{ before: '{', after }])).toThrow();
  });

  it('leaves explorations and other pull requests out', () => {
    expect(figmaPushOf({ labels: ['source: figma', 'exploration'] }, { files: tokenFiles, tokenChanges: [] })).toBeNull();
    expect(figmaPushOf({ labels: ['source: studio'] }, { files: tokenFiles, tokenChanges: [] })).toBeNull();
    expect(figmaPushOf({ labels: [] }, { files: [{ path: 'packages/react/src/components/Button/Button.tsx' }], tokenChanges: null, closesFigmaBuildRequest: true })).toEqual({ scope: 'component' });
  });
});

describe('the gate on a push from Figma', () => {
  const base = { tier: 3 as const, ci: green, owners, state: 'open', draft: false, mergeable: true, approvals: none };

  it('ships token values with no person: design and tech approved by the push', () => {
    const v = branchVerdict({ ...base, figmaPush: { scope: 'token-values' } });
    expect(v.status).toBe('ready');
    expect(v.gate?.allowed).toBe(true);
    expect(v.autoShip).toBe(true);
  });

  it('keeps the checks: a failing or running check still blocks', () => {
    expect(branchVerdict({ ...base, ci: red, figmaPush: { scope: 'token-values' } }).gate?.allowed).toBe(false);
    expect(branchVerdict({ ...base, ci: running, figmaPush: { scope: 'token-values' } }).status).toBe('ci-running');
  });

  it('waits for a developer on a rename or removal, code, or unread token changes', () => {
    for (const scope of ['token-structure', 'token-unknown', 'component'] as const) {
      const v = branchVerdict({ ...base, figmaPush: { scope } });
      expect(v.status).toBe('needs-tech');
      expect(v.gate?.missing).toEqual(['tech approval']);
      expect(v.autoShip).toBe(false);
    }
  });

  it('gives no credit for a guardrail file, nor for a pull request not pushed from Figma', () => {
    expect(branchVerdict({ ...base, figmaPush: { scope: 'outside' } }).status).toBe('needs-design');
    expect(branchVerdict({ ...base, figmaPush: null }).status).toBe('needs-design');
    expect(withFigmaPushApprovals(none, null)).toBe(none);
  });

  it('never ships a merged, closed or exploration branch by itself', () => {
    expect(branchVerdict({ ...base, state: 'closed', merged_at: '2026-10-20T00:00:00Z', figmaPush: { scope: 'token-values' } }).autoShip).toBe(false);
    expect(branchVerdict({ ...base, exploration: true, figmaPush: { scope: 'token-values' } }).autoShip).toBe(false);
  });

  it('counts a draft token push as shipping: Bridge marks it ready when it arms the merge', () => {
    expect(branchVerdict({ ...base, draft: true, figmaPush: { scope: 'token-values' } }).autoShip).toBe(true);
  });

  it('keeps changes requested blocking', () => {
    const changes = summarizeApprovals([{ user: { login: 'theo' }, state: 'CHANGES_REQUESTED' }], owners, 'sam');
    expect(branchVerdict({ ...base, approvals: changes, figmaPush: { scope: 'token-values' } }).status).toBe('changes-requested');
  });
});

describe('the publish result', () => {
  it('routes token values to shipped, renames and removals to a developer', () => {
    expect(tokenPublishRoute([{ kind: 'changed' }, { kind: 'added' }])).toBe('shipped');
    expect(tokenPublishRoute([{ kind: 'changed' }, { kind: 'renamed' }])).toBe('waiting-for-developer');
    expect(tokenPublishRoute([{ kind: 'changed' }], false)).toBe('waiting-for-developer');
  });

  it('sums it up in one sentence', () => {
    const ref = { kind: 'pull' as const, number: 1, url: 'u' };
    expect(
      publishSummary({
        outcomes: [
          { subject: { type: 'token', name: 'color.a' }, route: 'shipped', ref, armed: true },
          { subject: { type: 'token', name: 'color.b' }, route: 'shipped', ref, armed: true },
          { subject: { type: 'token', name: 'color.c' }, route: 'waiting-for-developer', ref },
          { subject: { type: 'component', name: 'Button' }, route: 'build-request', ref: { ...ref, kind: 'issue' } },
        ],
      }),
    ).toBe('2 on their way to the library, 1 waiting for a developer, 1 build request sent.');
    expect(publishSummary({ outcomes: [] })).toBe('Nothing was published.');
  });

  it('says where a shipped push stands, without technical blockers', () => {
    expect(libraryArrival({ state: 'open', ci: running })).toMatchObject({ key: 'on-its-way', label: 'On its way to the library', final: false });
    expect(libraryArrival({ state: 'merged', merged_at: '2026-10-24T10:00:00Z' })).toMatchObject({ key: 'in-the-library', label: 'In the library', final: true });
    const held = libraryArrival({ state: 'open', ci: red });
    expect(held).toMatchObject({ key: 'held', label: 'Held for a developer', final: true });
    expect(held.sentence).not.toMatch(/test|check|CI|conflict/i);
    expect(libraryArrival({ state: 'open', mergeable: false }).key).toBe('held');
    expect(libraryArrival({ state: 'closed' }).key).toBe('not-shipped');
  });

  it('writes the review Bridge leaves when it ships', () => {
    expect(figmaShipReviewBody('sam')).toContain('Pushed from Figma by @sam');
    expect(figmaShipReviewBody('Sam Lee')).toContain('by Sam Lee');
  });
});

const input: BuildRequestInput = {
  component: 'Button',
  kind: 'new-variant',
  title: 'Add a lg size',
  summary: 'Hero sections need a larger button.',
  changes: [{ field: 'size', before: 'sm | md', after: 'sm | md | lg' }],
  figma: { fileKey: 'abc', nodeId: '1:2', nodeName: 'Button', url: 'https://www.figma.com/design/abc/?node-id=1-2' },
  images: { before: ['https://img/before.png'], after: ['https://img/after.png'] },
  props: [{ name: 'size', type: 'variant', values: ['sm', 'md', 'lg'], default: 'md', change: 'changed' }],
  spec: { v: 1, component: 'Button', variantAxes: { Size: ['sm', 'md', 'lg'] } },
  source: 'figma',
  requestedBy: 'sam',
};

describe('the build request issue', () => {
  it('is a component change request with the bridge-build label, so Jira mirrors it', () => {
    const issue = composeBuildRequestIssue(input, { labels: ['design-system'] });
    expect(issue.title).toBe('Button: add a lg size');
    expect(issue.labels).toEqual(['component-change', 'request: new-variant', 'source: figma', 'bridge-build', 'design-system']);
    expect(isBuildRequestIssue(issue.labels)).toBe(true);
    expect(isBuildRequestIssue(['component-change', 'exploration'])).toBe(false);
  });

  it('carries the Figma link, before and after, props, the brief and the spec, and reads them back', () => {
    const { body } = composeBuildRequestIssue(input);
    expect(body).toContain('| Before | After |');
    expect(body).toContain('![Button before](https://img/before.png)');
    expect(body).toContain('![Button after](https://img/after.png)');
    expect(body).toContain('**Props needed:**');
    expect(body).toContain('change `size` variant: sm, md, lg (default md)');
    expect(body).toContain('<summary>Brief for Claude</summary>');
    expect(body).toContain('## How to build it');
    expect(body).toContain('[Button](https://www.figma.com/design/abc/?node-id=1-2)');
    expect(body).not.toMatch(/\u2014/);
    const r = parseBuildRequestIssue(body)!;
    expect(r.component).toBe('Button');
    expect(r.build).toEqual({ v: 1, before: ['https://img/before.png'], after: ['https://img/after.png'], props: input.props });
    expect(parseRequestIssue(body)?.title).toBe('Add a lg size');
    expect(parseBuildSpec(body)).toEqual(input.spec);
    expect(body.length).toBeLessThan(65_536);
  });

  it('leaves a spec too large out of the body', () => {
    const big = { blob: 'x'.repeat(40_000) };
    const { body } = composeBuildRequestIssue({ ...input, spec: big, specPath: '.bridge/figma/button-add-a-lg-size.json' });
    expect(parseBuildSpec(body)).toBeUndefined();
    expect(body).toContain('Spec: .bridge/figma/button-add-a-lg-size.json');
  });

  it('reads a plain request as a build request with no extras', () => {
    const { body } = composeBuildRequestIssue({ ...input, images: undefined, props: undefined, spec: undefined });
    expect(parseBuildRequestIssue(body)?.build).toEqual({ v: 1 });
  });

  it('writes a brief Claude can build from, closing the issue', () => {
    const b = buildRequestBrief(parseBuildRequestIssue(composeBuildRequestIssue(input).body)!, { issue: 42 });
    expect(b).toContain('Build Bridge build request #42');
    expect(b).toContain('Closes #42');
    expect(b).toContain('agent/build-42');
    expect(b).toContain('get_design_context { fileKey: "abc", nodeId: "1:2" }');
    expect(b).toContain('Props needed:');
    expect(b).not.toMatch(/\u2014/);
  });

  it('files it on GitHub and returns the outcome the plugin shows', async () => {
    const calls: unknown[] = [];
    const gh = { createIssue: async (x: unknown) => (calls.push(x), { number: 7, url: 'https://github.com/o/r/issues/7' }) } as unknown as GitHubClient;
    const out = await createBuildRequestOnGitHub(gh, input);
    expect(out).toEqual({ subject: { type: 'component', name: 'Button' }, route: 'build-request', ref: { kind: 'issue', number: 7, url: 'https://github.com/o/r/issues/7' } });
    expect((calls[0] as { labels: string[] }).labels).toContain('bridge-build');
  });
});

const NOW = Date.parse('2026-10-24T12:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const issue = (over: Partial<BuildIssueLike> = {}): BuildIssueLike => ({
  number: 12,
  url: 'https://github.com/o/r/issues/12',
  title: 'Button: add a lg size',
  body: composeBuildRequestIssue(input).body,
  state: 'open',
  labels: ['component-change', 'bridge-build', 'source: figma'],
  author: 'sam',
  assignees: [],
  createdAt: day(2),
  ...over,
});
const pull = (over: Partial<BuildPullLike> = {}): BuildPullLike => ({ number: 30, url: 'https://github.com/o/r/pull/30', state: 'open', draft: true, author: 'ana', body: 'Closes #12', createdAt: day(1), ...over });

describe('where a build request stands', () => {
  const names = (l: string) => ({ ana: 'Ana', bo: 'Bo' })[l] ?? l;

  it('Requested, then stale after 7 days', () => {
    expect(buildRequestStatus({ issue: issue() }, NOW)).toMatchObject({ status: 'requested', label: 'Requested', stale: false, ageDays: 2 });
    const old = buildRequestStatus({ issue: issue({ createdAt: day(9) }) }, NOW);
    expect(old).toMatchObject({ status: 'requested', stale: true, label: 'Requested 9 days ago' });
    expect(old.sentence).toBe('Waiting for a developer to pick it up for 9 days.');
  });

  it('Picked up once assigned: "Ana is on it"', () => {
    const s = buildRequestStatus({ issue: issue({ assignees: ['ana'], createdAt: day(9) }) }, NOW, names);
    expect(s).toMatchObject({ status: 'picked-up', sentence: 'Ana is on it.', builders: ['ana'], stale: false });
    expect(buildRequestStatus({ issue: issue({ assignees: ['ana', 'bo'] }) }, NOW, names).sentence).toBe('Ana and Bo are on it.');
  });

  it('In progress with a linked draft pull request, its author as the builder when nobody is assigned', () => {
    const s = buildRequestStatus({ issue: issue(), linked: [pull()] }, NOW, names);
    expect(s).toMatchObject({ status: 'in-progress', builders: ['ana'], sentence: 'Ana is building it.' });
    expect(s.pull).toEqual({ number: 30, url: 'https://github.com/o/r/pull/30', state: 'open' });
  });

  it('In review once the pull request is ready for review', () => {
    expect(buildRequestStatus({ issue: issue({ assignees: ['ana'] }), linked: [pull({ draft: false })] }, NOW).status).toBe('in-review');
    expect(buildRequestStatus({ issue: issue(), linked: [pull({ draft: true, labels: ['drafted-by-claude'] })] }, NOW).status).toBe('in-review');
  });

  it('Shipped once merged, or the issue closed as completed', () => {
    const s = buildRequestStatus({ issue: issue({ state: 'closed', stateReason: 'completed', closedAt: day(0) }), linked: [pull({ state: 'merged', draft: false, mergedAt: day(0) })] }, NOW);
    expect(s).toMatchObject({ status: 'shipped', shippedAt: day(0) });
    expect(s.timeline.map((e) => e.status)).toEqual(['requested', 'picked-up', 'in-progress', 'in-review', 'shipped']);
    expect(buildRequestStatus({ issue: issue({ state: 'closed', stateReason: 'completed', closedAt: day(1) }) }, NOW)).toMatchObject({ status: 'shipped', shippedAt: day(1) });
  });

  it('Not planned when closed as not planned', () => {
    const s = buildRequestStatus({ issue: issue({ state: 'closed', stateReason: 'not_planned', closedAt: day(1) }) }, NOW);
    expect(s.status).toBe('not-planned');
    expect(s.timeline.map((e) => e.status)).toEqual(['requested', 'not-planned']);
  });

  it('reads a library branch from Figma (direct mode) as a build request: spec only is not work in progress', () => {
    const own = pull({ body: '', author: 'sam', labels: ['from-figma', 'waiting-for-claude'], headRef: 'bridge/button-add-a-lg-size' });
    expect(buildRequestStatus({ pull: own }, NOW).status).toBe('requested');
    expect(buildRequestStatus({ pull: { ...own, assignees: ['ana'] } }, NOW).status).toBe('picked-up');
    expect(buildRequestStatus({ pull: { ...own, labels: ['from-figma', 'drafted-by-claude'] } }, NOW).status).toBe('in-review');
    expect(buildRequestStatus({ pull: { ...own, state: 'closed' } }, NOW).status).toBe('not-planned');
  });
});

describe('the list, filters and lines', () => {
  const issues: BuildIssueLike[] = [
    issue({ number: 1, createdAt: day(10) }),
    issue({ number: 2, assignees: ['ana'] }),
    issue({ number: 3, title: 'Card: new header layout', body: composeBuildRequestIssue({ ...input, component: 'Card', title: 'New header layout' }).body }),
    issue({ number: 4, state: 'closed', stateReason: 'completed', closedAt: day(3) }),
    issue({ number: 5, labels: ['component-change', 'exploration'] }),
    issue({ number: 6, labels: ['bug'] }),
  ];
  const pulls: BuildPullLike[] = [
    pull({ number: 40, body: 'Closes #3', author: 'bo' }),
    pull({ number: 41, body: 'Closes #4', state: 'merged', mergedAt: day(3) }),
    pull({ number: 42, body: '', author: 'sam', title: 'Select: add a clear button', labels: ['from-figma', 'waiting-for-claude'], headRef: 'bridge/select-add-a-clear-button' }),
    pull({ number: 43, body: 'unrelated' }),
  ];
  const list = assembleBuildRequests({ issues, pulls, now: NOW });

  it('lists build requests and Figma branches waiting for a developer, nothing else', () => {
    expect(list.map((v) => v.id)).toEqual(['issue-1', 'pull-42', 'issue-2', 'issue-3', 'issue-4']);
    expect(list.find((v) => v.id === 'pull-42')).toMatchObject({ kind: 'pull', status: 'requested', title: 'Add a clear button' });
    expect(list.find((v) => v.id === 'issue-3')).toMatchObject({ component: 'Card', status: 'in-progress', builders: ['bo'] });
    expect(list.find((v) => v.id === 'issue-1')).toMatchObject({ stale: true, figmaUrl: input.figma.url, requestedBy: 'sam' });
  });

  it('filters All, Waiting to be picked up, In progress, Shipped this week', () => {
    const ids = (f: Parameters<typeof matchesBuildFilter>[1]) => list.filter((v) => matchesBuildFilter(v, f, NOW)).map((v) => v.number);
    expect(ids('waiting')).toEqual([1, 42]);
    expect(ids('in-progress')).toEqual([2, 3]);
    expect(ids('shipped-this-week')).toEqual([4]);
    expect(ids('all')).toHaveLength(5);
    expect(list.filter((v) => matchesBuildFilter(v, 'shipped-this-week', NOW + 8 * 86_400_000))).toHaveLength(0);
  });

  it('gives the home a calm line and the Library its "Figma is ahead" line', () => {
    expect(buildSummaryLine(list)).toBe('2 being built, 2 waiting to be picked up.');
    expect(buildSummaryLine([])).toBeNull();
    expect(figmaAheadLine(list, 'Button', (l) => (l === 'ana' ? 'Ana' : l))).toEqual({ count: 2, builders: ['Ana'], sentence: 'Figma is ahead: 2 changes being built (Ana).' });
    expect(figmaAheadLine(list, 'Avatar')).toBeNull();
  });

  it('reads the Jira key the Action labelled', () => {
    const [v] = assembleBuildRequests({ issues: [issue({ labels: ['component-change', 'jira: ds-12'] })], pulls: [], now: NOW });
    expect(v!.jira).toBe('DS-12');
  });
});
