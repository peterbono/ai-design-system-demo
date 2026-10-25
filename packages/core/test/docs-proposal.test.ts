// One open docs proposal per component and the author line (docs-proposal.ts): a send for a component that already
// has an open proposal continues it, and the description says who wrote the text, never "no AI" over a Claude draft.
import { describe, expect, it } from 'vitest';
import {
  defaultDocsFooter,
  docsAuthorLine,
  docsProposal,
  docsSlug,
  DOCS_EDITOR_ORIGIN,
  DOCS_MCP_ORIGIN,
  findOpenDocsProposal,
  isDocsProposalBranch,
  proposeDocsOnGitHub,
  withAuthorLine,
} from '../src/docs-proposal';
import { type FetchLike, GitHubClient } from '../src/github-client';

type Route = { status?: number; body: unknown };
function client(routes: Record<string, Route | ((body: any) => Route)>) {
  const calls: { method: string; path: string; body: any }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com/repos/o/r', '');
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const r = routes[`${method} ${path}`];
    const route = typeof r === 'function' ? r(body) : r;
    const status = route ? (route.status ?? 200) : 404;
    const out = route ? route.body : { message: 'Not Found' };
    return { ok: status < 300, status, json: async () => out, text: async () => JSON.stringify(out) };
  };
  return { gh: new GitHubClient('o/r', 'token', fetchImpl, { attempts: 1, baseDelayMs: 0, sleep: async () => {} }), calls };
}

const pull = (n: number, ref: string, extra: Record<string, unknown> = {}) => ({
  number: n,
  state: 'open',
  draft: false,
  title: `docs ${n}`,
  user: { login: 'peterbono' },
  head: { ref, sha: `h${n}` },
  base: { ref: 'main' },
  labels: [{ name: 'docs' }],
  html_url: `https://github.com/o/r/pull/${n}`,
  updated_at: `2026-10-${10 + n}T10:00:00Z`,
  body: '## Docs change\n\n---\nWritten by a person in the Bridge docs editor. No AI involved in this text.',
  ...extra,
});

describe('one open docs proposal per component', () => {
  it('names the branch slug in kebab case from a name or a slug', () => {
    expect(docsSlug('VisuallyHidden')).toBe('visually-hidden');
    expect(docsSlug('visually-hidden')).toBe('visually-hidden');
    expect(docsSlug('Button')).toBe('button');
  });

  it("matches the component's proposal branches only, with or without a Jira key", () => {
    const vh = { name: 'VisuallyHidden', slug: 'visually-hidden' };
    expect(isDocsProposalBranch('docs/visually-hidden-20261019-em3x', vh)).toBe(true);
    expect(isDocsProposalBranch('docs/DS-42-visually-hidden-20261019-em3x', vh)).toBe(true);
    expect(isDocsProposalBranch('docs/visuallyhidden-20261019-em3x', vh)).toBe(true);
    expect(isDocsProposalBranch('docs/button-20261019-em3x', { name: 'Button' })).toBe(true);
    expect(isDocsProposalBranch('docs/button-group-20261019-em3x', { name: 'Button' })).toBe(false);
    expect(isDocsProposalBranch('tokens/visually-hidden-20261019-em3x', vh)).toBe(false);
    expect(isDocsProposalBranch('docs/visually-hidden-and-2-more-20261019-em3x', vh)).toBe(false);
  });

  it('finds the most recently updated open one into the base', () => {
    const vh = { name: 'VisuallyHidden', slug: 'visually-hidden' };
    const pulls = [
      { number: 148, state: 'open', headRef: 'docs/visually-hidden-20261019-em3x', baseRef: 'main', author: 'peterbono', title: 'a', url: 'u148', updatedAt: '2026-10-19T10:00:00Z' },
      { number: 150, state: 'open', headRef: 'docs/visually-hidden-20261020-abcd', baseRef: 'next', author: 'ana', title: 'b', url: 'u150', updatedAt: '2026-10-20T10:00:00Z' },
      { number: 161, state: 'closed', headRef: 'docs/visually-hidden-20261020-y4sj', baseRef: 'main', author: 'peterbono', title: 'c', url: 'u161', updatedAt: '2026-10-21T10:00:00Z' },
    ];
    expect(findOpenDocsProposal(pulls, vh, 'main')).toEqual({ number: 148, url: 'u148', branch: 'docs/visually-hidden-20261019-em3x', author: 'peterbono', title: 'a', updatedAt: '2026-10-19T10:00:00Z' });
    expect(findOpenDocsProposal(pulls, vh)!.number).toBe(150);
    expect(findOpenDocsProposal(pulls, { name: 'Button' })).toBeNull();
  });

  const edit = { path: 'p/VisuallyHidden.docs.json', component: 'VisuallyHidden', slug: 'visually-hidden', before: '{}', after: '{"summary":"Hides text."}\n' };
  const LIST = 'GET /pulls?state=open&per_page=50&sort=updated&direction=desc';

  it('continues the open proposal with one commit instead of a second pull request', async () => {
    const { gh, calls } = client({
      [LIST]: { body: [pull(148, 'docs/visually-hidden-20261019-em3x')] },
      'GET /contents/p/VisuallyHidden.docs.json?ref=docs%2Fvisually-hidden-20261019-em3x': { body: { type: 'file', encoding: 'base64', content: Buffer.from('{"summary":"Old."}\n').toString('base64'), sha: 's1' } },
      'PUT /contents/p/VisuallyHidden.docs.json': { body: { commit: { sha: 'c2' } } },
      'GET /pulls/148': { body: pull(148, 'docs/visually-hidden-20261019-em3x') },
      'PATCH /pulls/148': { body: {} },
    });
    const r = await proposeDocsOnGitHub(gh, [edit], { base: 'main', authorLine: 'Drafted by Claude AI, edited by @ana in the Bridge docs editor.' });
    expect(r).toMatchObject({ number: 148, continued: true, unchanged: false, branch: 'docs/visually-hidden-20261019-em3x' });
    expect(calls.some((c) => c.method === 'POST' && c.path === '/pulls')).toBe(false);
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ branch: 'docs/visually-hidden-20261019-em3x', sha: 's1' });
    expect(calls.find((c) => c.method === 'PATCH')!.body.body).toBe('## Docs change\n\n---\nDrafted by Claude AI, edited by @ana in the Bridge docs editor.');
  });

  it('writes nothing when the open proposal already says the same', async () => {
    const { gh, calls } = client({
      [LIST]: { body: [pull(148, 'docs/visually-hidden-20261019-em3x')] },
      'GET /contents/p/VisuallyHidden.docs.json?ref=docs%2Fvisually-hidden-20261019-em3x': { body: { type: 'file', encoding: 'base64', content: Buffer.from(edit.after).toString('base64'), sha: 's1' } },
    });
    expect(await proposeDocsOnGitHub(gh, [edit], { base: 'main' })).toMatchObject({ number: 148, continued: true, unchanged: true });
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('opens a new proposal when none is open, with the author line as the footer', async () => {
    const { gh, calls } = client({
      [LIST]: { body: [pull(3, 'docs/button-20261019-em3x')] },
      'GET /git/ref/heads/main': { body: { object: { sha: 'main1' } } },
      'GET /git/commits/main1': { body: { tree: { sha: 'tree1' } } },
      'POST /git/trees': { status: 201, body: { sha: 'tree2' } },
      'POST /git/commits': { status: 201, body: { sha: 'c2' } },
      'POST /git/refs': { status: 201, body: {} },
      'POST /pulls': (body) => ({ status: 201, body: { number: 9, html_url: 'u9', title: body.title, head: { ref: body.head } } }),
      'POST /issues/9/labels': { body: [] },
    });
    const r = await proposeDocsOnGitHub(gh, [edit], { base: 'main', authorLine: 'Written by @ana in the Bridge docs editor. No AI involved in this text.', date: new Date('2026-10-20T10:00:00Z') });
    expect(r).toMatchObject({ number: 9, continued: false });
    expect(r.branch).toMatch(/^docs\/visually-hidden-20261020-/);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/pulls')!.body.body).toMatch(/---\nWritten by @ana in the Bridge docs editor\. No AI involved in this text\.$/);
  });
});

describe('who wrote the text', () => {
  const none = { claude: [], edited: [], written: [], pending: [] };

  it('says "no AI" only when no Claude draft is in the text', () => {
    expect(docsAuthorLine({ ...none, written: ['Summary'] }, 'ana')).toBe('Written by @ana in the Bridge docs editor. No AI involved in this text.');
    expect(docsAuthorLine({ ...none, claude: ['Summary', 'Accessibility'] }, 'ana')).toBe('Drafted by Claude AI, reviewed and sent by @ana in the Bridge docs editor.');
    expect(docsAuthorLine({ ...none, pending: ['Summary'] }, null)).toBe('Drafted by Claude AI, sent by a person in the Bridge docs editor before review.');
  });

  it('names the sections the person edited, and the rest', () => {
    const line = docsAuthorLine({ claude: ['When to use'], edited: ['Summary', 'Accessibility'], written: ['Content guidelines'], pending: ['Do and don\'t'] }, '@ana');
    expect(line).toBe(
      "Drafted by Claude AI, edited by @ana in the Bridge docs editor. Edited by @ana: Summary and Accessibility. As Claude drafted them: When to use. Written by @ana: Content guidelines. Not reviewed yet: Do and don't.",
    );
    expect(line).not.toMatch(/\u2014/);
  });

  it('falls back on the docs record, never "no AI" over draftedBy claude', () => {
    expect(defaultDocsFooter([{ after: '{"summary":"x","draftedBy":"claude"}' }], DOCS_EDITOR_ORIGIN)).toMatch(/^Drafted by Claude AI/);
    expect(defaultDocsFooter([{ after: '{"summary":"x"}' }], DOCS_EDITOR_ORIGIN)).toBe(DOCS_EDITOR_ORIGIN.footer);
    expect(defaultDocsFooter([{ after: 'not json' }], DOCS_MCP_ORIGIN)).toBe(DOCS_MCP_ORIGIN.footer);
    const p = docsProposal([{ path: 'a', component: 'A', slug: 'a', before: null, after: '{"summary":"x","draftedBy":"claude"}' }], { date: new Date('2026-10-20T10:00:00Z') });
    expect(p.body).not.toMatch(/No AI involved/);
  });

  it('replaces the author line of a description, or adds one', () => {
    expect(withAuthorLine('Body\n\n---\nOld line.', 'New line.')).toBe('Body\n\n---\nNew line.');
    expect(withAuthorLine('Body\n', 'New line.')).toBe('Body\n\n---\nNew line.');
  });
});
