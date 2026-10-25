// The writes that know the change mode (suggest-mode plan, PR 1c): a token change, a missing piece's library side, a
// component pushed from Figma and a docs edit. "direct" opens branches and pull requests as before; "suggest" files a
// suggestion issue (bridge.suggestion/1) and never touches git refs or pull requests. Over an in-memory GitHub.
import { describe, expect, it } from 'vitest';
import {
  GitHubClient,
  LayeredTokenSet,
  libraryBranchPlan,
  libraryPreviewState,
  linkedLibraryBranchOnGitHub,
  linkStatus,
  openComponentPushOnGitHub,
  openLibraryBranchOnGitHub,
  parseContrastChecks,
  parseNeededBy,
  parsePiecesRecord,
  parseRequestIssue,
  parseSuggestionIssue,
  planTokenProposal,
  proposeDocsOnGitHub,
  suggestTokenProposalOnGitHub,
  withPiecesRecord,
  writeTokenProposalOnGitHub,
  type ComponentPushDiff,
  type ComponentPushPlan,
  type FetchLike,
  type LibraryLink,
  type MissingPiece,
  type ProductConfig,
} from '../src/index';
import { otherThan, realChecksText, realConfig, realFiles } from './helpers';

// ---------------------------------------------------------------------------------------------------------------
// In-memory GitHub: issues and pull requests share numbers, refs, labels, comments. Every call is recorded.

interface FakeOptions {
  /** PATCH /pulls/<n> answers 403 (a token with Issues write only). */
  refusePullEdits?: boolean;
}

function fakeGitHub(opts: FakeOptions = {}) {
  const calls: { method: string; path: string; body: any }[] = [];
  const issues = new Map<number, any>();
  const pulls = new Map<number, any>();
  const refs = new Map<string, string>([['main', 'abc1234']]);
  let next = 50;
  let ids = 1000;
  const ok = (b: unknown, status = 200) => ({ ok: true, status, json: async () => b, text: async () => JSON.stringify(b) });
  const fail = (status: number, message: string) => ({ ok: false, status, json: async () => ({ message }), text: async () => JSON.stringify({ message }) });
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com/repos/o/r', '');
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    let m: RegExpExecArray | null;
    if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const sha = refs.get(decodeURIComponent(m[1]!));
      return sha ? ok({ object: { sha } }) : fail(404, 'Not Found');
    }
    if ((m = /^\/git\/commits\/(\w+)$/.exec(path))) return ok({ tree: { sha: `tree-${m[1]}` } });
    if (method === 'POST' && path === '/git/trees') return ok({ sha: 'tree-new' }, 201);
    if (method === 'POST' && path === '/git/commits') return ok({ sha: `commit-${ids++}` }, 201);
    if (method === 'POST' && path === '/git/refs') {
      refs.set(body.ref.replace('refs/heads/', ''), body.sha);
      return ok({}, 201);
    }
    if (method === 'POST' && path === '/merges') return ok({ sha: 'merged1' }, 201);
    if (path.startsWith('/compare/')) return ok({ status: 'identical', ahead_by: 0, behind_by: 0, files: [] });
    if (method === 'GET' && path.startsWith('/pulls?')) return ok([...pulls.values()]);
    if (method === 'POST' && path === '/pulls') {
      const n = next++;
      const pr = { number: n, title: body.title, body: body.body, state: 'open', draft: body.draft, user: { login: 'ana' }, head: { ref: body.head, sha: refs.get(body.head) }, base: { ref: body.base }, labels: [], html_url: `https://github.com/o/r/pull/${n}`, updated_at: '2026-10-21T00:00:00Z' };
      pulls.set(n, pr);
      return ok(pr, 201);
    }
    if ((m = /^\/pulls\/(\d+)\/(files|reviews)/.exec(path))) return ok([]);
    if ((m = /^\/pulls\/(\d+)$/.exec(path))) {
      const pr = pulls.get(Number(m[1]));
      if (!pr) return fail(404, 'Not Found');
      if (method === 'PATCH') {
        if (opts.refusePullEdits) return fail(403, 'Resource not accessible by integration');
        Object.assign(pr, body);
      }
      return ok(pr);
    }
    if (method === 'POST' && path === '/issues') {
      const n = next++;
      const issue = { number: n, title: body.title, body: body.body, html_url: `https://github.com/o/r/issues/${n}`, state: 'open', state_reason: null, labels: (body.labels ?? []).map((name: string) => ({ name })), user: { login: 'ana' }, created_at: '2026-10-21T00:00:00Z', updated_at: '' };
      issues.set(n, issue);
      return ok(issue, 201);
    }
    if ((m = /^\/issues\/(\d+)\/labels$/.exec(path))) {
      const target = issues.get(Number(m[1])) ?? pulls.get(Number(m[1]));
      if (!target) return fail(404, 'Not Found');
      for (const name of body.labels) if (!target.labels.some((l: any) => l.name === name)) target.labels.push({ name });
      return ok(target.labels);
    }
    if ((m = /^\/issues\/(\d+)\/comments$/.exec(path))) return ok({ id: ids++, html_url: `https://github.com/o/r/issues/${m[1]}#c` }, 201);
    if ((m = /^\/issues\/(\d+)$/.exec(path))) {
      const issue = issues.get(Number(m[1]));
      if (!issue) return fail(404, 'Not Found');
      if (method === 'PATCH') Object.assign(issue, body);
      return ok(issue);
    }
    return fail(404, `Not Found: ${method} ${path}`);
  };
  const gh = new GitHubClient('o/r', 'token', fetchImpl, { attempts: 1, baseDelayMs: 0, sleep: async () => {} });
  /** Calls that need contents or pull requests write: none may happen in suggest mode. */
  const codeWrites = () => calls.filter((c) => c.method !== 'GET' && (c.path.startsWith('/git/') || c.path.startsWith('/pulls') || c.path === '/merges'));
  return { gh, calls, issues, pulls, refs, codeWrites };
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures

const realSet = () => new LayeredTokenSet(realConfig(), new Map(Object.entries(realFiles())));
const pairs = () => parseContrastChecks(realChecksText());

/** A token change that passes the gate: one component token re-pointed. */
function tokenPlan() {
  const set = realSet();
  const current = set.defs.find((d) => d.path === 'menu.item.bg-highlight')!.value;
  const edits = [{ op: 'set' as const, path: 'menu.item.bg-highlight', value: otherThan(current, '{color.surface.hover}', '{color.surface.hover-raised}') }];
  return planTokenProposal({ before: set, pairs: pairs(), edits, title: 'Softer menu highlight', summary: 'The menu highlight reads too strong.', config: realConfig(), tool: 'Bridge MCP' })!;
}

const PRODUCTS: ProductConfig[] = [
  { key: 'admin', name: 'Admin demo', path: 'apps/admin' },
  { key: 'library', name: 'Library', default: true },
];

const tokenPiece: MissingPiece = {
  id: 'new-color-c2410c',
  kind: 'token',
  title: 'New color #C2410C',
  summary: 'A colour written by hand.',
  name: 'overdue',
  values: [{ category: 'color', property: 'color', value: '#c2410c' }],
  where: [{ file: 'apps/admin/src/billing.module.css', line: 6 }],
  token: { path: 'menu.item.overdue-text', type: 'color', value: '{color.text.muted}', files: ['components/overlays.tokens.json'] },
};

const variantPiece: MissingPiece = {
  id: 'badge-overdue-tone',
  kind: 'variant',
  title: 'Badge: overdue tone',
  summary: 'Badge restyled by hand (background #fdecec).',
  name: 'overdue',
  component: 'Badge',
  aspect: 'tone',
  values: [{ category: 'color', property: 'background', value: '#fdecec' }],
  where: [{ file: 'apps/admin/src/x.tsx', line: 3 }],
};

/** Product branch #12 (explore/billing-overdue, product: admin) with both pieces recorded. */
function withProductBranch(f: ReturnType<typeof fakeGitHub>) {
  f.refs.set('explore/billing-overdue', 'prod1');
  const body = withPiecesRecord('## Exploration: Billing screen with overdue invoices\n\nPurpose.', { checkedAt: '2026-10-21T00:00:00Z', pieces: [tokenPiece, variantPiece], links: [] });
  f.pulls.set(12, { number: 12, title: 'Exploration: billing screen with overdue invoices', body, state: 'open', draft: true, user: { login: 'ann' }, head: { ref: 'explore/billing-overdue', sha: 'prod1' }, base: { ref: 'main' }, labels: [{ name: 'exploration' }, { name: 'product: admin' }], html_url: 'https://github.com/o/r/pull/12', updated_at: '2026-10-21T00:00:00Z' });
}

const libraryInput = { pr: 12, base: 'main', products: PRODUCTS, exploration: { packages: [], apps: {} } };

// ---------------------------------------------------------------------------------------------------------------

describe('token change', () => {
  it('direct: a branch, one commit and a pull request, as before', async () => {
    const f = fakeGitHub();
    const plan = tokenPlan();
    expect(plan.edits).toHaveLength(1);
    const r = await writeTokenProposalOnGitHub(f.gh, plan, { base: 'main', branchPrefix: 'bridge/' });
    expect(r.branch).toBe('bridge/softer-menu-highlight');
    expect(f.pulls.get(r.pr)).toBeDefined();
    expect(f.issues.size).toBe(0);
  });

  it('suggest: one issue with the exact edits and the changeset, no branch, no pull request', async () => {
    const f = fakeGitHub();
    const plan = tokenPlan();
    const r = await suggestTokenProposalOnGitHub(f.gh, plan, { base: 'main', source: 'mcp', suggestedBy: '@ana', labels: ['bridge'], labelsAfter: ['product: admin'] });
    expect(r).toMatchObject({ status: 'suggested', number: 50, url: 'https://github.com/o/r/issues/50' });
    expect(f.codeWrites()).toEqual([]);
    const issue = f.issues.get(50)!;
    const labels = issue.labels.map((l: any) => l.name);
    expect(labels).toEqual(expect.arrayContaining(['bridge-suggestion', 'suggestion: token-change', 'source: mcp', `tier: ${plan.tier.tier}`, 'suggestion: needs review', 'bridge', 'product: admin']));
    expect(issue.title).toBe('Tokens: softer menu highlight');
    const parsed = parseSuggestionIssue(issue.body);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.edited).toBe(false);
    expect(parsed.sha).toBe(r.sha);
    const p = parsed.payload;
    expect(p).toMatchObject({ kind: 'token-change', source: 'mcp', suggestedBy: 'ana', base: { ref: 'main', sha: 'abc1234' }, tier: { tier: plan.tier.tier, bump: plan.tier.bump } });
    expect(p.tokens!.edits).toEqual(plan.edits);
    expect(p.tokens!.changes.map((c) => c.path)).toEqual(plan.changes.map((c) => c.path));
    // Token files are re-derived from the edits; only the changeset is stored whole.
    expect(p.files!.map((x) => x.path)).toEqual(plan.files.filter((x) => !plan.touched.includes(x.path)).map((x) => x.path));
    expect(p.files!.every((x) => x.beforeSha === null && typeof x.afterSha === 'string')).toBe(true);
    expect(p.checks).toMatchObject({ newErrors: 0, blocked: null, impact: plan.impact.total });
    expect(issue.body).not.toMatch(/\u2014/);
  });

  it('suggest: refuses a change that breaks the gate, before writing anything', async () => {
    const f = fakeGitHub();
    const set = realSet();
    const plan = planTokenProposal({ before: set, pairs: pairs(), edits: [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.300}', mode: { theme: 'light' } }], title: 'Lighter muted text', config: realConfig() })!;
    expect(plan.blocked).toBeTruthy();
    await expect(suggestTokenProposalOnGitHub(f.gh, plan, { base: 'main', source: 'studio' })).rejects.toThrow(/^Not suggested: .*contrast/);
    expect(f.calls).toEqual([]);
  });
});

describe('a missing piece, linked both ways', () => {
  it('direct: a token piece opens a pull request through writeTokens, as before', async () => {
    const f = fakeGitHub();
    withProductBranch(f);
    const modes: string[] = [];
    const r = await openLibraryBranchOnGitHub(f.gh, {
      ...libraryInput,
      piece: tokenPiece.id,
      usePreview: false,
      writeTokens: async (_plan, ctx) => {
        modes.push(ctx.mode);
        f.refs.set('bridge/add-x', 'lib1');
        f.pulls.set(60, { number: 60, title: 'feat(tokens): add', body: 'Body.', state: 'open', draft: true, user: { login: 'ana' }, head: { ref: 'bridge/add-x', sha: 'lib1' }, base: { ref: 'main' }, labels: [], html_url: 'https://github.com/o/r/pull/60', updated_at: '' });
        return { number: 60, url: 'https://github.com/o/r/pull/60', branch: 'bridge/add-x' };
      },
    });
    expect(modes).toEqual(['direct']);
    expect(r.status).toBe('opened');
    expect(r.link).toMatchObject({ kind: 'token-change', number: 60, branch: 'bridge/add-x' });
    expect(parseNeededBy(f.pulls.get(60)!.body)).toMatchObject({ pr: 12, piece: tokenPiece.id });
    expect(parsePiecesRecord(f.pulls.get(12)!.body)!.links[0]).toMatchObject({ kind: 'token-change', number: 60 });
  });

  it('direct: a variant still opens a library exploration branch', async () => {
    const f = fakeGitHub();
    withProductBranch(f);
    const r = await openLibraryBranchOnGitHub(f.gh, { ...libraryInput, piece: variantPiece.id });
    expect(r.plan.kind).toBe('exploration');
    expect(r.link).toMatchObject({ kind: 'exploration', branch: 'explore/badge-overdue-tone' });
    expect(f.codeWrites().some((c) => c.path === '/pulls')).toBe(true);
  });

  it('suggest: a token piece is a suggestion that says who needs it; the product branch records it', async () => {
    const f = fakeGitHub();
    withProductBranch(f);
    const r = await openLibraryBranchOnGitHub(f.gh, {
      ...libraryInput,
      piece: tokenPiece.id,
      mode: 'suggest',
      source: 'mcp',
      writeTokens: async (plan, ctx) => {
        expect(ctx.mode).toBe('suggest');
        const p = planTokenProposal({ before: realSet(), pairs: pairs(), edits: plan.edits, title: plan.title, summary: plan.summary, config: realConfig() })!;
        return suggestTokenProposalOnGitHub(f.gh, p, { base: 'main', source: 'mcp', neededBy: plan.neededBy });
      },
    });
    expect(r.status).toBe('suggested');
    expect(r.link).toMatchObject({ kind: 'suggestion', number: 50, url: 'https://github.com/o/r/issues/50' });
    expect(r.link!.branch).toBeUndefined();
    expect(r.preview).toBeNull();
    expect(r.warnings).toEqual([]);
    const issue = f.issues.get(50)!;
    expect(issue.labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['bridge-suggestion', 'needed-by-product']));
    expect(parseNeededBy(issue.body)).toMatchObject({ pr: 12, product: 'admin', piece: tokenPiece.id });
    // The "Needed by" mark sits outside the payload: the suggestion still parses, unedited.
    const parsed = parseSuggestionIssue(issue.body);
    expect(parsed.ok && !parsed.edited && parsed.payload.links?.neededBy?.pr).toBe(12);
    expect(parsePiecesRecord(f.pulls.get(12)!.body)!.links[0]).toMatchObject({ kind: 'suggestion', number: 50 });
    // Only the product branch record is a pull request write; nothing touches git.
    expect(f.codeWrites().map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /pulls/12']);
  });

  it('suggest: a variant is a component request, not an exploration branch', async () => {
    const f = fakeGitHub();
    withProductBranch(f);
    const r = await openLibraryBranchOnGitHub(f.gh, { ...libraryInput, piece: variantPiece.id, mode: 'suggest', source: 'studio', openedBy: 'ann' });
    expect(r.status).toBe('opened');
    expect(r.plan.kind).toBe('request');
    expect(r.link).toMatchObject({ kind: 'request', number: 50 });
    const req = parseRequestIssue(f.issues.get(50)!.body);
    expect(req).toMatchObject({ component: 'Badge', kind: 'new-variant', source: 'studio', requestedBy: 'ann' });
    expect(f.codeWrites().map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /pulls/12']);
  });

  it('suggest: a token that cannot edit pull requests still files the suggestion, with a warning', async () => {
    const f = fakeGitHub({ refusePullEdits: true });
    withProductBranch(f);
    const r = await openLibraryBranchOnGitHub(f.gh, { ...libraryInput, piece: variantPiece.id, mode: 'suggest' });
    expect(r.link).toMatchObject({ kind: 'request', number: 50 });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^#12 does not list #50 yet .*Add "Library: #50" to #12 on GitHub/);
  });

  it('direct: a refused product branch record still fails, as before', async () => {
    const f = fakeGitHub({ refusePullEdits: true });
    withProductBranch(f);
    await expect(openLibraryBranchOnGitHub(f.gh, { ...libraryInput, piece: variantPiece.id })).rejects.toThrow();
  });

  it('a suggest-mode token piece without writeTokens is refused like in direct mode', async () => {
    const f = fakeGitHub();
    withProductBranch(f);
    await expect(openLibraryBranchOnGitHub(f.gh, { ...libraryInput, piece: tokenPiece.id, mode: 'suggest' })).rejects.toThrow(/This piece is a token/);
  });

  it('reads where a linked suggestion stands from its issue', async () => {
    const f = fakeGitHub();
    f.issues.set(70, { number: 70, title: 'Tokens: add x', body: '', html_url: 'u70', state: 'open', state_reason: null, labels: [{ name: 'bridge-suggestion' }, { name: 'suggestion: approved' }], user: { login: 'ana' }, created_at: '', updated_at: '' });
    const link: LibraryLink = { piece: tokenPiece.id, kind: 'suggestion', number: 70, url: 'u70', title: 'Add x', at: '2026-10-21T00:00:00Z' };
    const open = await linkedLibraryBranchOnGitHub(f.gh, link, { headSha: 'prod1', baseRef: 'main' });
    expect(open.status).toMatchObject({ key: 'approved', label: 'Approved' });
    expect(open.preview.key).toBe('nothing-yet');
    Object.assign(f.issues.get(70)!, { state: 'closed', state_reason: 'completed' });
    const done = await linkedLibraryBranchOnGitHub(f.gh, link, { headSha: 'prod1', baseRef: 'main' });
    expect(done.status.key).toBe('shipped');
    expect(done.preview.key).toBe('switched');
    Object.assign(f.issues.get(70)!, { state: 'closed', state_reason: 'not_planned' });
    expect((await linkedLibraryBranchOnGitHub(f.gh, link, { headSha: 'prod1', baseRef: 'main' })).preview.key).toBe('declined');
  });
});

describe('suggestion links, pure', () => {
  it('maps every suggestion status to a link status', () => {
    const keys = (['needs-review', 'changes-requested', 'approved', 'applying', 'applied', 'declined', 'outdated'] as const).map((status) => linkStatus({ kind: 'suggestion', status }).key);
    expect(keys).toEqual(['in-review', 'changes', 'approved', 'in-progress', 'shipped', 'declined', 'outdated']);
    expect(linkStatus({ kind: 'suggestion', status: 'outdated' }).label).toBe('Outdated');
    expect(linkStatus({ kind: 'suggestion', status: 'applying', assignees: ['teo'] }).line).toBe('In progress · @teo builds');
  });

  it('says there is nothing to preview until a developer applies it', () => {
    const s = libraryPreviewState({ kind: 'suggestion', lifecycle: 'open', hasChanges: false, missing: null, total: null, behindMain: null });
    expect(s).toMatchObject({ key: 'nothing-yet', action: null });
    expect(libraryPreviewState({ kind: 'suggestion', lifecycle: 'merged', hasChanges: false, missing: null, total: null, behindMain: 2 }).action?.kind).toBe('switch');
    expect(s.sentence).not.toMatch(/\u2014/);
  });

  it('plans a variant as an exploration in direct mode and a request in suggest mode', () => {
    const ref = { pr: 12, title: 'Billing', branch: 'explore/billing', url: 'u', productKey: 'admin', productName: 'Admin demo' };
    expect(libraryBranchPlan(variantPiece, ref).kind).toBe('exploration');
    expect(libraryBranchPlan(variantPiece, ref, { mode: 'direct' }).kind).toBe('exploration');
    const plan = libraryBranchPlan(variantPiece, ref, { mode: 'suggest', source: 'figma' });
    expect(plan.kind === 'request' && plan.request).toMatchObject({ component: 'Badge', kind: 'new-variant', title: 'Badge: overdue tone', source: 'figma' });
    expect(libraryBranchPlan(tokenPiece, ref, { mode: 'suggest' }).kind).toBe('token-change');
  });
});

// ---------------------------------------------------------------------------------------------------------------

function diff(over: Partial<ComponentPushDiff> = {}): ComponentPushDiff {
  return {
    v: 1,
    component: 'Button',
    figmaName: 'Button',
    coded: true,
    kind: 'new-variant',
    title: 'Add a lg size',
    summary: 'Bigger buttons for the hero.',
    changes: [{ field: 'Variant Size', before: 'md', after: 'lg, md' }],
    rebinds: [],
    needsCode: true,
    unknown: [],
    variantAxes: { Size: ['lg', 'md'] },
    properties: [],
    bindings: {},
    anatomy: {},
    source: 'figma',
    figma: { fileKey: 'F', nodeId: '1:1', url: 'https://www.figma.com/design/F/?node-id=1-1' },
    requestedBy: 'dana',
    ...over,
  };
}

const draftPlan: ComponentPushPlan = { route: 'claude-draft', said: 'Claude AI drafts it.', edits: [], reasons: ['A new size needs code.'], issues: [], alsoChanges: [] };
const exactPlan: ComponentPushPlan = { route: 'token-change', said: 'An exact token change.', edits: [{ op: 'set', path: 'button.primary.bg', value: '{color.action.primary.bg-active}' }], reasons: [], issues: [], alsoChanges: [] };
const pushInput = { base: 'main', branchPrefix: 'bridge/', labels: ['source: figma'] };

describe('a component pushed from Figma', () => {
  it('direct: a code change opens a draft pull request carrying the spec, as before', async () => {
    const f = fakeGitHub();
    const r = await openComponentPushOnGitHub(f.gh, { ...pushInput, diff: diff(), plan: draftPlan });
    expect(r.status).toBe('opened');
    expect(r.link).toMatchObject({ route: 'claude-draft', branch: 'bridge/figma-button-add-a-lg-size' });
    expect(r.suggestion).toBeUndefined();
    expect(f.pulls.get(r.link!.number)!.labels.map((l: any) => l.name)).toEqual(['source: figma', 'from-figma', 'component-change', 'waiting-for-claude']);
  });

  it('suggest: a code change is a component spec suggestion, the spec inside it, no branch', async () => {
    const f = fakeGitHub();
    const r = await openComponentPushOnGitHub(f.gh, { ...pushInput, diff: diff(), plan: draftPlan, mode: 'suggest' });
    expect(r).toMatchObject({ status: 'suggested', link: null, suggestion: { route: 'claude-draft', number: 50, url: 'https://github.com/o/r/issues/50' } });
    expect(f.codeWrites()).toEqual([]);
    const issue = f.issues.get(50)!;
    expect(issue.title).toBe('Button: add a lg size');
    expect(issue.labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['bridge-suggestion', 'suggestion: component-spec', 'source: figma', 'tier: 2', 'from-figma', 'waiting-for-claude']));
    expect(issue.labels.map((l: any) => l.name)).not.toContain('component-change');
    const parsed = parseSuggestionIssue(issue.body);
    if (!parsed.ok) throw new Error(parsed.message);
    const p = parsed.payload;
    expect(p).toMatchObject({ kind: 'component-spec', source: 'figma', suggestedBy: 'dana', base: { ref: 'main', sha: 'abc1234' }, tier: { tier: 2, bump: 'minor' } });
    expect(p.links?.figma).toEqual({ fileKey: 'F', nodeId: '1:1', url: 'https://www.figma.com/design/F/?node-id=1-1', nodes: [{ nodeId: '1:1', state: 'after', url: 'https://www.figma.com/design/F/?node-id=1-1' }] });
    expect(p.previews).toBeUndefined();
    expect(issue.body).toContain('Claude Code reads this design straight from Figma');
    expect(p.componentSpec!.brief).toContain('Figma MCP get_design_context { fileKey: "F", nodeId: "1:1" }');
    expect(p.componentSpec).toMatchObject({ component: 'Button', specPath: '.bridge/figma/button-add-a-lg-size.json' });
    expect(p.componentSpec!.spec).toMatchObject({ component: 'Button', reasons: ['A new size needs code.'], variantAxes: { Size: ['lg', 'md'] } });
    expect(p.componentSpec!.brief).toMatch(/^Draft the code for a component change made in Figma, sent as a Bridge suggestion \(this issue\)\./);
    expect(p.componentSpec!.brief).toContain('Closes #<this issue number>');
    expect(p.componentSpec!.brief).not.toMatch(/bridge_mark_figma_change_drafted|\u2014/);
  });

  it('suggest: screenshots stored by the sender become previews; a before node is linked when the file keeps one', async () => {
    const f = fakeGitHub();
    const d = diff({ images: ['https://github.com/o/r/blob/bridge-requests/x.png?raw=true'], figma: { fileKey: 'F', nodeId: '1:1', before: { nodeId: '7:7', nodeName: 'Button (code)' } } });
    await openComponentPushOnGitHub(f.gh, { ...pushInput, diff: d, plan: draftPlan, mode: 'suggest' });
    expect(f.codeWrites()).toEqual([]);
    const parsed = parseSuggestionIssue(f.issues.get(50)!.body);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.payload.previews).toEqual([{ label: 'Button in Figma', url: 'https://github.com/o/r/blob/bridge-requests/x.png?raw=true' }]);
    expect(parsed.payload.links?.figma?.nodes).toEqual([
      { nodeId: '7:7', state: 'before', name: 'Button (code)', url: 'https://www.figma.com/design/F/?node-id=7-7' },
      { nodeId: '1:1', state: 'after', url: 'https://www.figma.com/design/F/?node-id=1-1' },
    ]);
  });

  it('routes an exact token change through writeTokens, which knows the mode and the Figma link', async () => {
    for (const mode of ['direct', 'suggest'] as const) {
      const f = fakeGitHub();
      f.issues.set(80, { number: 80, title: 't', body: '', html_url: 'u80', state: 'open', state_reason: null, labels: [], user: { login: 'ana' }, created_at: '', updated_at: '' });
      const seen: unknown[] = [];
      const r = await openComponentPushOnGitHub(f.gh, {
        ...pushInput,
        diff: diff({ kind: 'token-binding', needsCode: false }),
        plan: exactPlan,
        mode,
        writeTokens: async (input) => {
          seen.push({ mode: input.mode, figma: input.figma });
          return input.mode === 'suggest' ? { status: 'suggested', number: 80, url: 'u80' } : { number: 80, url: 'u80', branch: 'bridge/x' };
        },
      });
      expect(seen).toEqual([{ mode, figma: { fileKey: 'F', nodeId: '1:1', url: 'https://www.figma.com/design/F/?node-id=1-1', nodes: [{ nodeId: '1:1', state: 'after', url: 'https://www.figma.com/design/F/?node-id=1-1' }] } }]);
      if (mode === 'direct') expect(r).toMatchObject({ status: 'opened', link: { route: 'token-change', number: 80, branch: 'bridge/x' } });
      else expect(r).toMatchObject({ status: 'suggested', link: null, suggestion: { route: 'token-change', number: 80, url: 'u80' } });
      expect(f.issues.get(80)!.labels.map((l: any) => l.name)).toEqual(['from-figma']);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('docs', () => {
  const after = '{\n  "summary": "Hides text visually.  ",\n  "whenToUse": ["Icon-only buttons.", ""],\n  "whenNotToUse": [],\n  "dos": [],\n  "donts": []\n}\n';
  const edit = { path: 'packages/react/src/components/VisuallyHidden/VisuallyHidden.docs.json', component: 'VisuallyHidden', slug: 'visually-hidden', before: '{}', after };

  it('direct: a branch and a pull request, as before', async () => {
    const f = fakeGitHub();
    const r = await proposeDocsOnGitHub(f.gh, [edit], { base: 'main', date: new Date('2026-10-21T10:00:00Z') });
    expect(r).toMatchObject({ status: 'opened', continued: false, number: 50 });
    expect(r.branch).toMatch(/^docs\/visually-hidden-20261021-/);
    expect(f.issues.size).toBe(0);
  });

  it('suggest: one docs suggestion with the cleaned docs and the changeset, no branch', async () => {
    const f = fakeGitHub();
    const r = await proposeDocsOnGitHub(f.gh, [edit], { base: 'main', mode: 'suggest', date: new Date('2026-10-21T10:00:00Z'), authorLine: 'Written by @ana in the Bridge docs editor. No AI involved in this text.', suggestedBy: 'ana' });
    expect(r).toMatchObject({ status: 'suggested', number: 50, url: 'https://github.com/o/r/issues/50', title: 'Usage guidance' });
    expect(f.codeWrites()).toEqual([]);
    expect(f.calls.some((c) => c.path.startsWith('/pulls'))).toBe(false);
    const issue = f.issues.get(50)!;
    expect(issue.title).toBe('VisuallyHidden: usage guidance');
    expect(issue.labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['bridge-suggestion', 'suggestion: docs', 'source: studio', 'tier: 1', 'docs']));
    expect(issue.body).toContain('Written by @ana in the Bridge docs editor. No AI involved in this text.');
    const parsed = parseSuggestionIssue(issue.body);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.payload).toMatchObject({ kind: 'docs', source: 'studio', suggestedBy: 'ana', createdAt: '2026-10-21T10:00:00.000Z', tier: { tier: 1, bump: 'patch' } });
    expect(parsed.payload.docs).toEqual([{ component: 'VisuallyHidden', path: edit.path, after: expect.objectContaining({ summary: 'Hides text visually.', whenToUse: ['Icon-only buttons.'] }) }]);
    expect(parsed.payload.files).toHaveLength(1);
    expect(parsed.payload.files![0]!.path).toMatch(/^\.changeset\/docs-visually-hidden-.+\.md$/);
    expect(parsed.payload.files![0]!.content).toContain('"@bridge-ds/react": patch');
  });

  it('suggest: an MCP send is sourced mcp, and broken JSON is refused before writing', async () => {
    const f = fakeGitHub();
    const { DOCS_MCP_ORIGIN } = await import('../src/docs-proposal');
    const r = await proposeDocsOnGitHub(f.gh, [edit], { base: 'main', mode: 'suggest', origin: DOCS_MCP_ORIGIN });
    expect(r.status).toBe('suggested');
    expect(f.issues.get(50)!.labels.map((l: any) => l.name)).toContain('source: mcp');
    await expect(proposeDocsOnGitHub(f.gh, [{ ...edit, after: '{' }], { base: 'main', mode: 'suggest' })).rejects.toThrow(/is not valid JSON/);
    expect(f.issues.size).toBe(1);
  });
});
