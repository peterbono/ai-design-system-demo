// Build requests over an in-memory GitHub (docs/BUILD-REQUESTS.md): the MCP tools and `bridge build` list them with
// the status read from GitHub (assignees, linked pull requests, issue state) and give the brief to build one. Read only.
import { describe, expect, it } from 'vitest';
import { composeBuildRequestIssue, type BuildRequestInput } from '@bridge-ds/core';
import { BridgeContext, buildRequests } from '../dist/lib.js';
import { runBuild } from '../../cli/src/build-requests.js';
import type { RequestIO } from '../../cli/src/request.js';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from './helpers.js';

const files = () => readTree(REPO, REAL_PATHS);
const input: BuildRequestInput = {
  component: 'Button',
  kind: 'new-variant',
  title: 'Add a lg size',
  summary: 'Hero sections need a larger button.',
  changes: [{ field: 'size', before: 'sm | md', after: 'sm | md | lg' }],
  figma: { fileKey: 'abc', nodeId: '1:2', url: 'https://www.figma.com/design/abc/?node-id=1-2' },
  images: { before: ['https://img/b.png'], after: ['https://img/a.png'] },
  props: [{ name: 'size', type: 'variant', values: ['sm', 'md', 'lg'], change: 'changed' }],
  spec: { v: 1, component: 'Button' },
  source: 'figma',
  requestedBy: 'sam',
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

type Gh = ReturnType<typeof fakeGitHub>;

function seed(gh: Gh, over: Partial<BuildRequestInput> = {}, x: { state?: string; state_reason?: string | null; assignees?: string[]; created?: string; labels?: string[] } = {}) {
  const issue = composeBuildRequestIssue({ ...input, ...over });
  const number = 100 + gh.issues.length;
  gh.issues.push({
    number,
    title: issue.title,
    body: issue.body,
    state: x.state ?? 'open',
    state_reason: x.state_reason ?? null,
    labels: [...issue.labels, ...(x.labels ?? [])].map((name) => ({ name })),
    assignees: (x.assignees ?? []).map((login) => ({ login })),
    user: { login: 'sam' },
    html_url: `https://github.com/acme/ds/issues/${number}`,
    created_at: x.created ?? daysAgo(2),
    updated_at: daysAgo(1),
    ...(x.state === 'closed' ? { closed_at: daysAgo(1) } : {}),
  });
  return number;
}

function pull(gh: Gh, body: string, x: { state?: string; draft?: boolean; merged_at?: string; author?: string } = {}) {
  const number = gh.pulls.length + 1;
  gh.pulls.push({ number, title: `PR ${number}`, body, state: x.state ?? 'open', draft: x.draft ?? true, user: { login: x.author ?? 'ana' }, head: { ref: `agent/build-${number}`, sha: 'x' }, base: { ref: 'main' }, labels: [], html_url: `https://github.com/acme/ds/pull/${number}`, created_at: daysAgo(1), updated_at: daysAgo(1), ...(x.merged_at ? { merged_at: x.merged_at } : {}) });
  return number;
}

function cliIO() {
  const out: string[] = [];
  const err: string[] = [];
  const io: RequestIO = { print: (s) => out.push(s), error: (s) => err.push(s), env: {}, fetch: undefined, ghToken: () => undefined, hasClaude: () => false, runClaude: () => 0 };
  return { io, out: () => out.join('\n'), err: () => err.join('\n') };
}

const argv = (...xs: string[]) => {
  const a = { _: [] as string[], flags: {} as Record<string, string[]> };
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    if (x.startsWith('--')) {
      const k = x.slice(2);
      const next = xs[i + 1];
      (a.flags[k] ??= []).push(next !== undefined && !next.startsWith('--') && !['json', 'brief'].includes(k) ? xs[++i]! : 'true');
    } else a._.push(x);
  }
  return a;
};

describe('build requests in the MCP server and the CLI', () => {
  const gh = fakeGitHub('peterbono', 'ai-design-system-demo', files());
  const requested = seed(gh, {}, { created: daysAgo(10) });
  const picked = seed(gh, { title: 'Add an icon slot' }, { assignees: ['ana'] });
  const building = seed(gh, { component: 'Card', title: 'New header layout' });
  const shipped = seed(gh, { title: 'Add a xs size' }, { state: 'closed', state_reason: 'completed', labels: ['jira: DS-12'] });
  seed(gh, { title: 'Not one' }, { labels: ['exploration'] });
  pull(gh, `Builds it.\n\nCloses #${building}`, { author: 'bo' });
  pull(gh, `Closes #${shipped}`, { state: 'closed', draft: false, merged_at: daysAgo(1) });
  const ctx = () => BridgeContext.create({ repo: 'peterbono/ai-design-system-demo', fetch: gh.fetch });

  it('lists them with the status read from GitHub, and filters them', async () => {
    const r = await buildRequests.listBuildRequests(await ctx());
    expect(r.summary).toBe('2 being built, 1 waiting to be picked up.');
    const by = Object.fromEntries(r.buildRequests.map((x) => [x.number, x]));
    expect(Object.keys(by).map(Number).sort()).toEqual([requested, picked, building, shipped].sort());
    expect(by[requested]).toMatchObject({ status: 'requested', stale: true, component: 'Button', title: 'Add a lg size', figma: input.figma.url });
    expect(by[picked]).toMatchObject({ status: 'picked-up', said: 'ana is on it.', builders: ['ana'] });
    expect(by[building]).toMatchObject({ status: 'in-progress', component: 'Card', builders: ['bo'], pull: { number: 1, state: 'open' } });
    expect(by[shipped]).toMatchObject({ status: 'shipped', jira: 'DS-12' });
    expect((await buildRequests.listBuildRequests(await ctx(), { filter: 'waiting' })).buildRequests.map((x) => x.number)).toEqual([requested]);
    expect((await buildRequests.listBuildRequests(await ctx(), { filter: 'shipped-this-week' })).buildRequests.map((x) => x.number)).toEqual([shipped]);
    expect((await buildRequests.listBuildRequests(await ctx(), { component: 'card' })).buildRequests.map((x) => x.number)).toEqual([building]);
    await expect(buildRequests.listBuildRequests(await ctx(), { filter: 'nope' as never })).rejects.toThrow(/Unknown filter/);
  });

  it('gives one with what was sent, the timeline, the spec and the brief for Claude', async () => {
    const r = (await buildRequests.getBuildRequest(await ctx(), { number: requested })) as any;
    expect(r.request.build.props).toEqual(input.props);
    expect(r.spec).toEqual(input.spec);
    expect(r.componentFiles).toContain('packages/react/src/components/Button/Button.tsx');
    expect(r.brief).toContain(`Build Bridge build request #${requested}`);
    expect(r.brief).toContain(`Closes #${requested}`);
    expect(r.timeline.map((e: any) => e.status)).toEqual(['requested']);
    expect(r.next).toContain(`agent/build-${requested}`);
    await expect(buildRequests.getBuildRequest(await ctx(), { number: 999 })).rejects.toThrow(/is not a build request/);
  });

  it('bridge build list, show and show --brief', async () => {
    const list = cliIO();
    list.io.fetch = gh.fetch;
    expect(await runBuild(argv('build', 'list'), REPO, list.io)).toBe(0);
    expect(list.out()).toContain('2 being built, 1 waiting to be picked up.');
    expect(list.out()).toMatch(new RegExp(`#${requested}\\s+Requested 10 days ago !`));

    const show = cliIO();
    show.io.fetch = gh.fetch;
    expect(await runBuild(argv('build', 'show', String(building)), REPO, show.io)).toBe(0);
    expect(show.out()).toContain('Card: New header layout');
    expect(show.out()).toContain('In progress. bo is building it.');
    expect(show.out()).toContain('Pull request: #1 open');
    expect(show.out()).toContain(`bridge build show ${building} --brief`);

    const brief = cliIO();
    brief.io.fetch = gh.fetch;
    expect(await runBuild(argv('build', 'show', String(requested), '--brief'), REPO, brief.io)).toBe(0);
    expect(brief.out()).toMatch(/^Build Bridge build request #/);

    const missing = cliIO();
    missing.io.fetch = gh.fetch;
    expect(await runBuild(argv('build', 'show', '999'), REPO, missing.io)).toBe(1);
    expect(missing.err()).toMatch(/not a build request/);
  });

  it('writes nothing to GitHub', () => {
    expect(gh.log.filter((l) => l.method !== 'GET')).toEqual([]);
  });
});
