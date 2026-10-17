// Explorations: branch naming, the draft pull request body, status, the promotion plan, requests on an exploration,
// and the GitHub helpers (start, list, promote, close) over a small in-memory GitHub.
import { describe, expect, it } from 'vitest';
import {
  closeExplorationOnGitHub,
  composeRequestIssue,
  EXPLORATION_LABEL,
  explorationBranch,
  explorationInstall,
  explorationNote,
  explorationPrBody,
  explorationPrTitle,
  explorationProblems,
  explorationSlug,
  explorationSlugFromBranch,
  explorationStatus,
  GitHubClient,
  GitHubError,
  isExplorationBranch,
  isExplorationPull,
  listExplorationsOnGitHub,
  parseExplorationBody,
  parseRequestIssue,
  previewComment,
  promoteExplorationOnGitHub,
  promotionPlan,
  requestBrief,
  startExplorationOnGitHub,
  type ComponentChangeRequest,
  type FetchLike,
} from '../src/index';
import { realConfig } from './helpers';

const apps = { docs: 'https://bridge-docs-git-{branch}-acme.vercel.app', storybook: 'https://sb-git-{branch}-acme.vercel.app' };
const packages = ['@bridge-ds/tokens', '@bridge-ds/react'];
const settings = { base: 'main', packages, apps };
const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('exploration naming', () => {
  it('slugs names into explore/<slug> branches', () => {
    expect(explorationSlug('Denser data tables!')).toBe('denser-data-tables');
    expect(explorationSlug('explore/Pill buttons')).toBe('pill-buttons');
    expect(explorationSlug('   ')).toBe('');
    expect(explorationBranch('Pill buttons')).toBe('explore/pill-buttons');
    expect(explorationBranch('explore/pill-buttons')).toBe('explore/pill-buttons');
    expect(isExplorationBranch('explore/pill-buttons')).toBe(true);
    expect(isExplorationBranch('refs/heads/explore/pill-buttons')).toBe(true);
    expect(isExplorationBranch('explore/')).toBe(false);
    expect(isExplorationBranch('explore/Pill_Buttons')).toBe(false);
    expect(isExplorationBranch('agent/pill')).toBe(false);
    expect(explorationSlugFromBranch('explore/pill-buttons')).toBe('pill-buttons');
    expect(explorationSlugFromBranch('main')).toBeNull();
  });

  it('says how to fix a name or a purpose', () => {
    expect(explorationProblems({ name: 'Pill buttons', purpose: 'Do rounder buttons read as more friendly?' })).toEqual([]);
    expect(explorationProblems({ name: '', purpose: '' })).toEqual(['Name the exploration, for example "Denser data tables".', 'Say what you want to learn, in one sentence.']);
    expect(explorationProblems({ name: '!!!', purpose: 'x' })[0]).toMatch(/letters or digits/);
    expect(explorationProblems({ name: 'x'.repeat(61), purpose: 'x' })[0]).toMatch(/under 60/);
  });
});

describe('exploration pull request', () => {
  const e = { name: 'Pill buttons', purpose: 'Do rounder buttons read as more friendly in the checkout?', useCase: 'user-test' as const, author: 'designer', startedAt: '2026-10-17T09:00:00Z' };

  it('composes a draft body with purpose, install, previews and promote or close, and reads it back', () => {
    const body = explorationPrBody(e, { owner: 'acme', repo: 'ds', pr: 12, packages, apps, requests: [{ number: 40, title: 'Button: pill radius' }] });
    expect(explorationPrTitle(e)).toBe('Exploration: pill buttons');
    expect(body).toContain('## Exploration: Pill buttons');
    expect(body).toContain('Not mergeable as is');
    expect(body).toContain('**Use case.** Prototype for a user test');
    expect(body).toContain('npm i @bridge-ds/tokens@https://pkg.pr.new/acme/ds/@bridge-ds/tokens@12 @bridge-ds/react@https://pkg.pr.new/acme/ds/@bridge-ds/react@12');
    expect(body).toContain('preview-pr-12');
    expect(body).toContain('| Docs | https://bridge-docs-git-explore-pill-buttons-acme.vercel.app/ |');
    expect(body).toContain('- #40 Button: pill radius');
    expect(body).toContain('bridge explore promote pill-buttons');
    expect(body).not.toMatch(/\u2014/);
    expect(parseExplorationBody(body)).toEqual({ ...e, slug: 'pill-buttons' });
    expect(parseExplorationBody('no block')).toBeUndefined();
    // Before the pull request exists the body says where the command will appear.
    expect(explorationPrBody(e, { owner: 'acme', repo: 'ds', packages, apps: {} })).toMatch(/install command appears here[\s\S]*Preview deploys are not set up/);
  });

  it('install: name@snapshot by pull request number, and the prerelease tarballs as a fallback', () => {
    const i = explorationInstall({ owner: 'acme', repo: 'ds', pr: 12, packages, sha: SHA });
    expect(i.packages[1]).toEqual({ name: '@bridge-ds/react', url: 'https://pkg.pr.new/acme/ds/@bridge-ds/react@12' });
    expect(i.fallback!.command).toBe('npm i @bridge-ds/tokens@https://github.com/acme/ds/releases/download/preview-pr-12/bridge-ds-tokens-0123456.tgz @bridge-ds/react@https://github.com/acme/ds/releases/download/preview-pr-12/bridge-ds-react-0123456.tgz');
    expect(explorationInstall({ owner: 'acme', repo: 'ds', pr: 12, packages }).fallback).toBeUndefined();
  });

  it('note file names the branch and how it ends', () => {
    const note = explorationNote({ ...e, slug: 'pill-buttons' });
    expect(note).toContain('- Branch: `explore/pill-buttons`');
    expect(note).toContain('- Started: 2026-10-17 by @designer');
    expect(note).toContain('promoting the pull request to review removes it');
  });

  it('status: running while labeled and open, promoted without the label, closed when closed unmerged', () => {
    expect(explorationStatus({ state: 'open', labels: [{ name: EXPLORATION_LABEL }] })).toBe('active');
    expect(explorationStatus({ state: 'open', labels: ['tier: 2'] })).toBe('promoted');
    expect(explorationStatus({ state: 'merged', labels: [] })).toBe('promoted');
    expect(explorationStatus({ state: 'closed', merged_at: '2026-10-17', labels: [] })).toBe('promoted');
    expect(explorationStatus({ state: 'closed', labels: [EXPLORATION_LABEL] })).toBe('closed');
    expect(isExplorationPull({ state: 'open', labels: [], headRef: 'explore/x' })).toBe(true);
    expect(isExplorationPull({ state: 'open', labels: ['exploration'], headRef: 'agent/x' })).toBe(true);
    expect(isExplorationPull({ state: 'open', labels: [], headRef: 'agent/x', body: 'hi' })).toBe(false);
  });

  it('promotion plan: tier from the files (note left out), labels, review body that closes linked requests', () => {
    const body = explorationPrBody(e, { owner: 'acme', repo: 'ds', pr: 12, packages, apps });
    const plan = promotionPlan({
      title: 'Exploration: pill buttons',
      body,
      labels: [EXPLORATION_LABEL],
      files: [
        { path: '.bridge/explorations/pill-buttons.md', status: 'added' },
        { path: 'packages/tokens/src/semantic/light.tokens.json', status: 'modified' },
        { path: 'packages/react/src/components/Button/Button.module.css', status: 'modified' },
      ],
      config: realConfig(),
      requests: [40, 41],
      date: new Date('2026-10-20T00:00:00Z'),
    });
    expect(plan.tier).toBe(3);
    expect(plan.addLabels).toEqual(['tier: 3', 'tokens']);
    expect(plan.removeLabels).toEqual(['exploration']);
    expect(plan.removeFiles).toEqual(['.bridge/explorations/pill-buttons.md']);
    expect(plan.title).toBe('Pill buttons');
    expect(plan.body).toMatch(/^\*\*Promoted from an exploration on 2026-10-20\.\*\*/);
    expect(plan.body).toContain('**Risk tier:** 3.');
    expect(plan.body).toContain('Closes #40\nCloses #41');
    expect(plan.body).not.toContain('Not mergeable as is');
    expect(plan.body).not.toContain('### When it is done');
    expect(plan.body).toContain('**Purpose.**');
    // A docs-only exploration is Tier 1; a request the body already closes is not repeated.
    const docs = promotionPlan({ title: 'Exploration: copy', body: 'Closes #40', labels: [], files: [{ path: 'docs/AI.md', status: 'modified' }], requests: [40] });
    expect(docs.tier).toBe(1);
    expect(docs.addLabels).toEqual(['tier: 1']);
    expect(docs.body.match(/Closes #40/g)).toHaveLength(1);
  });

  it('labels the snapshot comment of an exploration and installs by name', () => {
    const body = previewComment({ owner: 'acme', repo: 'ds', pr: 12, branch: 'explore/pill-buttons', sha: SHA, packages: [{ name: '@bridge-ds/react', url: 'https://pkg.pr.new/acme/ds/@bridge-ds/react@0123456' }], source: 'pkg.pr.new', apps, exploration: true });
    expect(body).toContain('## Try this exploration in your product');
    expect(body).toContain('npm i @bridge-ds/react@https://pkg.pr.new/acme/ds/@bridge-ds/react@0123456');
    expect(body).toContain('never merged as is');
  });
});

describe('requests on an exploration', () => {
  const req: ComponentChangeRequest = { component: 'Button', kind: 'visual', title: 'Pill radius', summary: 'Try a pill radius.', changes: [], source: 'studio', exploration: 'explore/pill-buttons' };

  it('labels the issue and tells where to work', () => {
    const issue = composeRequestIssue(req);
    expect(issue.labels).toContain('exploration');
    expect(issue.body).toContain('**Exploration:** `explore/pill-buttons`');
    expect(issue.body).toContain('Commit the change to `explore/pill-buttons`');
    expect(parseRequestIssue(issue.body)?.exploration).toBe('explore/pill-buttons');
    expect(composeRequestIssue({ ...req, exploration: undefined }).labels).not.toContain('exploration');
  });

  it('brief: work on that branch, never a pull request to main', () => {
    const brief = requestBrief(req, { issue: 40 });
    expect(brief).toContain('Work on the existing branch explore/pill-buttons');
    expect(brief).toContain('Do not open a pull request to main');
    expect(brief).toContain('Refs #40');
    expect(brief).not.toContain('agent/request-40');
    // A target branch passed by the caller wins over the request's.
    expect(requestBrief({ ...req, exploration: undefined }, { issue: 40, exploration: 'explore/other' })).toContain('explore/other');
    expect(requestBrief({ ...req, exploration: undefined }, { issue: 40 })).toContain('agent/request-40');
  });
});

// --- GitHub helpers over a small in-memory GitHub ------------------------------------------------------------------

function fakeGitHub() {
  let n = 0;
  const refs = new Map<string, string>([['main', 'c0']]);
  const trees = new Map<string, Map<string, string>>([['c0', new Map([['README.md', 'hi']])]]);
  const pulls: any[] = [];
  const calls: { method: string; path: string; body?: any }[] = [];
  const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const f: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const path = url.replace('https://api.github.com', '').replace('/repos/acme/ds', '');
    calls.push({ method, path, body });
    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const sha = refs.get(decodeURIComponent(m[1]!));
      return sha ? res(200, { object: { sha } }) : res(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = /^\/git\/commits\/(.+)$/.exec(path))) return res(200, { tree: { sha: m[1] } });
    if (method === 'POST' && path === '/git/trees') {
      const t = new Map(trees.get(body.base_tree));
      for (const e of body.tree) e.sha === null ? t.delete(e.path) : t.set(e.path, e.content);
      const id = `t${++n}`;
      trees.set(id, t);
      return res(201, { sha: id });
    }
    if (method === 'POST' && path === '/git/commits') {
      const id = `c${++n}`;
      trees.set(id, trees.get(body.tree)!);
      return res(201, { sha: id });
    }
    if (method === 'POST' && path === '/git/refs') {
      const name = body.ref.replace('refs/heads/', '');
      if (refs.has(name)) return res(422, { message: 'Reference already exists' });
      refs.set(name, body.sha);
      return res(201, {});
    }
    if (method === 'PATCH' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      refs.set(decodeURIComponent(m[1]!), body.sha);
      return res(200, {});
    }
    if (method === 'POST' && path === '/pulls') {
      const pr = { number: pulls.length + 1, node_id: `PR_${pulls.length + 1}`, title: body.title, body: body.body, state: 'open', draft: body.draft, user: { login: 'designer' }, head: { ref: body.head, sha: refs.get(body.head) }, base: { ref: body.base }, labels: [] as { name: string }[], html_url: `https://github.com/acme/ds/pull/${pulls.length + 1}`, updated_at: '2026-10-17T10:00:00Z' };
      pulls.push(pr);
      return res(201, pr);
    }
    if (method === 'GET' && path.startsWith('/pulls?')) {
      const q = new URLSearchParams(path.split('?')[1]);
      const head = q.get('head')?.split(':')[1];
      return res(200, pulls.filter((p) => (head ? p.head.ref === head && p.state === 'open' : q.get('state') === 'all' || p.state === q.get('state'))));
    }
    if ((m = /^\/pulls\/(\d+)$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1];
      if (!pr) return res(404, {});
      if (method === 'PATCH') Object.assign(pr, body);
      return res(200, pr);
    }
    if (method === 'GET' && (m = /^\/pulls\/(\d+)\/files/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1];
      const head = trees.get(refs.get(pr.head.ref)!)!;
      const base = trees.get(refs.get('main')!)!;
      return res(200, [...head.keys()].filter((k) => head.get(k) !== base.get(k)).map((filename) => ({ filename, status: base.has(filename) ? 'modified' : 'added', additions: 1, deletions: 0 })));
    }
    if (method === 'POST' && (m = /^\/issues\/(\d+)\/labels$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1];
      for (const name of body.labels) if (!pr.labels.some((l: any) => l.name === name)) pr.labels.push({ name });
      return res(200, pr.labels);
    }
    if (method === 'DELETE' && (m = /^\/issues\/(\d+)\/labels\/(.+)$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1];
      pr.labels = pr.labels.filter((l: any) => l.name !== decodeURIComponent(m![2]!));
      return res(200, pr.labels);
    }
    if (method === 'POST' && path === '/graphql') {
      const pr = pulls.find((p) => p.node_id === body.variables.id);
      pr.draft = false;
      return res(200, { data: { markPullRequestReadyForReview: { pullRequest: { number: pr.number, isDraft: false } } } });
    }
    return res(404, { message: `no route ${method} ${path}` });
  };
  const noRetry = { attempts: 1, baseDelayMs: 0, sleep: async () => {} };
  const client = (token = 't') => new GitHubClient('acme/ds', token, f, noRetry, { protectedBranches: ['main'], branchPrefix: 'bridge/' });
  return { client, refs, trees, pulls, calls };
}

describe('explorations on GitHub', () => {
  it('start: branch from main with the note, draft pull request labeled exploration, body with the install command', async () => {
    const gh = fakeGitHub();
    const s = await startExplorationOnGitHub(gh.client(), { name: 'Pill buttons', purpose: 'Rounder buttons in checkout.', author: 'designer' }, settings);
    expect(s).toMatchObject({ branch: 'explore/pill-buttons', slug: 'pill-buttons', pr: 1, url: 'https://github.com/acme/ds/pull/1' });
    expect(gh.trees.get(gh.refs.get('explore/pill-buttons')!)!.get('.bridge/explorations/pill-buttons.md')).toContain('# Exploration: Pill buttons');
    expect(gh.refs.get('main')).toBe('c0');
    const pr = gh.pulls[0];
    expect(pr.draft).toBe(true);
    expect(pr.base.ref).toBe('main');
    expect(pr.labels.map((l: any) => l.name)).toEqual(['exploration']);
    expect(pr.body).toContain('@bridge-ds/react@https://pkg.pr.new/acme/ds/@bridge-ds/react@1');
    expect(s.install.command).toContain('@bridge-ds/tokens@https://pkg.pr.new/acme/ds/@bridge-ds/tokens@1');
    expect(s.previews[0]!.url).toBe('https://bridge-docs-git-explore-pill-buttons-acme.vercel.app/');
    // Same name again: refused, nothing created.
    await expect(startExplorationOnGitHub(gh.client(), { name: 'Pill buttons', purpose: 'Again.' }, settings)).rejects.toThrow(/already exists/);
    await expect(startExplorationOnGitHub(gh.client(''), { name: 'Other', purpose: 'x' }, settings)).rejects.toThrow(/needs a GitHub token/);
    await expect(startExplorationOnGitHub(gh.client(), { name: '', purpose: '' }, settings)).rejects.toBeInstanceOf(GitHubError);
    expect(gh.pulls).toHaveLength(1);
  });

  it('list, promote (note removed, labels, ready for review via GraphQL) and close', async () => {
    const gh = fakeGitHub();
    const c = gh.client();
    await startExplorationOnGitHub(c, { name: 'Pill buttons', purpose: 'Rounder buttons.' }, settings);
    await startExplorationOnGitHub(c, { name: 'Dense tables', purpose: 'Compact rows.' }, settings);
    // A token edit committed to the exploration branch.
    await c.withBranchPrefix('explore/').commitToBranch({ branch: 'explore/pill-buttons', message: 'feat(tokens): pill', files: [{ path: 'packages/tokens/src/brands/bridge.tokens.json', content: '{}' }] });
    await expect(c.commitToBranch({ branch: 'main', message: 'x', files: [] })).rejects.toThrow(/protected branch/);

    const list = await listExplorationsOnGitHub(c, settings);
    expect(list.map((x) => [x.number, x.slug, x.status, x.name])).toEqual([
      [1, 'pill-buttons', 'active', 'Pill buttons'],
      [2, 'dense-tables', 'active', 'Dense tables'],
    ]);
    expect(list[0]!.purpose).toBe('Rounder buttons.');

    const dry = await promoteExplorationOnGitHub(c, 'pill-buttons', { dryRun: true, config: realConfig() });
    expect(dry.tier).toBe(3);
    expect(gh.pulls[0].labels.map((l: any) => l.name)).toEqual(['exploration']);

    const p = await promoteExplorationOnGitHub(c, 'Pill buttons', { config: realConfig(), requests: [40] });
    expect(p.warnings).toEqual([]);
    expect(p.addLabels).toEqual(['tier: 3', 'tokens']);
    const pr = gh.pulls[0];
    expect(pr.labels.map((l: any) => l.name)).toEqual(['tier: 3', 'tokens']);
    expect(pr.draft).toBe(false);
    expect(pr.title).toBe('Pill buttons');
    expect(pr.body).toContain('Closes #40');
    expect(gh.trees.get(gh.refs.get('explore/pill-buttons')!)!.has('.bridge/explorations/pill-buttons.md')).toBe(false);
    expect(gh.calls.some((x) => x.method === 'POST' && x.path === '/graphql' && x.body.query.includes('markPullRequestReadyForReview'))).toBe(true);
    await expect(promoteExplorationOnGitHub(c, 1)).rejects.toThrow(/already promoted/);
    expect((await listExplorationsOnGitHub(c, settings)).map((x) => x.status)).toEqual(['promoted', 'active']);

    const closed = await closeExplorationOnGitHub(c, '#2');
    expect(closed).toMatchObject({ number: 2, branch: 'explore/dense-tables' });
    expect(gh.pulls[1].state).toBe('closed');
    await expect(promoteExplorationOnGitHub(c, 2)).rejects.toThrow(/is closed/);
    await expect(promoteExplorationOnGitHub(c, 'nothing-here')).rejects.toThrow(/No open exploration/);
  });

  it('markReadyForReview reports GraphQL errors with what to do instead', async () => {
    const f: FetchLike = async (url) =>
      url.endsWith('/graphql')
        ? { ok: true, status: 200, json: async () => ({ errors: [{ message: 'Resource not accessible by personal access token' }] }), text: async () => '' }
        : { ok: true, status: 200, json: async () => ({ node_id: 'PR_1', draft: true }), text: async () => '' };
    const c = new GitHubClient('acme/ds', 't', f, { attempts: 1, baseDelayMs: 0, sleep: async () => {} });
    await expect(c.markReadyForReview(1)).rejects.toThrow(/Resource not accessible[\s\S]*Ready for review/);
    await expect(new GitHubClient('acme/ds', '', f).markReadyForReview(1)).rejects.toThrow(/needs a GitHub token/);
  });
});
