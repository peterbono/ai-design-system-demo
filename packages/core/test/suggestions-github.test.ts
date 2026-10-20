import { describe, expect, it } from 'vitest';
import {
  composeSuggestionReviewComment,
  createSuggestionOnGitHub,
  declineSuggestionOnGitHub,
  getSuggestionOnGitHub,
  gitBlobSha,
  GitHubClient,
  linkSuggestionPrOnGitHub,
  listSuggestionsOnGitHub,
  reviewSuggestionOnGitHub,
  SUGGESTION_SCHEMA,
  suggestionPayloadSha,
  type FetchLike,
  type SuggestionPayloadV1,
} from '../src/index';

const payload = (content = 'Darker primary.\n'): SuggestionPayloadV1 => ({
  schema: SUGGESTION_SCHEMA,
  kind: 'token-change',
  title: 'Raise color.action.primary.bg contrast',
  summary: 'Primary labels read too light in dark mode.',
  source: 'studio',
  suggestedBy: 'ana',
  createdAt: '2026-10-21T09:00:00.000Z',
  base: { ref: 'main', sha: 'e30fbcc' },
  tier: { tier: 3, bump: 'minor' },
  tokens: { edits: [{ op: 'set', path: 'color.action.primary.bg', value: '{palette.harbor.700}' }], changes: [] },
  files: [{ path: '.changeset/x.md', beforeSha: null, afterSha: gitBlobSha(content), content }],
  checks: { newErrors: 0, contrast: [], blocked: null, impact: 0 },
});

const gov = { owners: { design: ['dana'], tech: ['teo'] } };

interface Comment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  author_association: string;
}

/** A fake GitHub with one repository's issues, comments and pull requests; `viewer` is who the token belongs to. */
function fakeGitHub(opts: { viewer?: string; pulls?: { number: number; state: string; body: string }[]; refuseComments?: boolean } = {}) {
  const calls: { method: string; path: string; body: any }[] = [];
  const issues = new Map<number, any>();
  const comments = new Map<number, Comment[]>();
  let nextIssue = 42;
  let nextComment = 1000;
  let viewer = opts.viewer ?? 'ana';
  const ok = (b: unknown, status = 200) => ({ ok: true, status, json: async () => b, text: async () => JSON.stringify(b) });
  const notFound = () => ({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }), text: async () => '' });
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com', '');
    const sent = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body: sent });
    let m: RegExpExecArray | null;
    if (method === 'GET' && path === '/user') return ok({ login: viewer });
    if (method === 'POST' && path === '/repos/o/r/issues') {
      const n = nextIssue++;
      const issue = { number: n, title: sent.title, body: sent.body, html_url: `https://github.com/o/r/issues/${n}`, state: 'open', state_reason: null, labels: (sent.labels ?? []).map((name: string) => ({ name })), user: { login: viewer }, created_at: '2026-10-21T09:00:00Z', updated_at: '' };
      issues.set(n, issue);
      comments.set(n, []);
      return ok(issue, 201);
    }
    if (method === 'GET' && path.startsWith('/repos/o/r/issues?')) return ok([...issues.values()].reverse());
    if ((m = /^\/repos\/o\/r\/issues\/(\d+)$/.exec(path))) {
      const issue = issues.get(Number(m[1]));
      if (!issue) return notFound();
      if (method === 'PATCH') Object.assign(issue, sent);
      return ok(issue);
    }
    if ((m = /^\/repos\/o\/r\/issues\/(\d+)\/comments/.exec(path))) {
      const list = comments.get(Number(m[1]))!;
      if (method === 'GET') return ok(list);
      if (opts.refuseComments && list.length >= 1) return { ok: false, status: 403, json: async () => ({ message: 'Resource not accessible by integration' }), text: async () => '' };
      const at = `2026-10-21T10:${String(list.length).padStart(2, '0')}:00Z`;
      const c = { id: nextComment++, body: sent.body, user: { login: viewer }, created_at: at, updated_at: at, author_association: viewer === 'mallory' ? 'NONE' : 'COLLABORATOR' };
      list.push(c);
      return ok({ ...c, html_url: `https://github.com/o/r/issues/${m[1]}#issuecomment-${c.id}` }, 201);
    }
    if ((m = /^\/repos\/o\/r\/issues\/(\d+)\/labels\/(.+)$/.exec(path)) && method === 'DELETE') {
      const issue = issues.get(Number(m[1]))!;
      issue.labels = issue.labels.filter((l: { name: string }) => l.name !== decodeURIComponent(m![2]!));
      return ok([]);
    }
    if ((m = /^\/repos\/o\/r\/issues\/(\d+)\/labels$/.exec(path)) && method === 'POST') {
      const issue = issues.get(Number(m[1]))!;
      issue.labels.push(...sent.labels.map((name: string) => ({ name })));
      return ok(issue.labels);
    }
    if (method === 'GET' && path.startsWith('/repos/o/r/pulls?'))
      return ok(
        (opts.pulls ?? []).map((p) => ({
          number: p.number,
          title: `PR ${p.number}`,
          state: p.state === 'merged' ? 'closed' : p.state,
          merged_at: p.state === 'merged' ? '2026-10-22T00:00:00Z' : null,
          draft: false,
          user: { login: 'dev' },
          head: { ref: 'b', sha: 's' },
          base: { ref: 'main' },
          labels: [],
          html_url: `https://github.com/o/r/pull/${p.number}`,
          updated_at: '',
          body: p.body,
        })),
      );
    return notFound();
  };
  const retry = { attempts: 1, baseDelayMs: 0, sleep: async () => undefined };
  return {
    calls,
    issues,
    comments,
    as: (login: string) => {
      viewer = login;
    },
    gh: () => new GitHubClient('o/r', 't', fetchImpl, retry),
  };
}

const labelsOf = (f: ReturnType<typeof fakeGitHub>, n: number) => f.issues.get(n).labels.map((l: { name: string }) => l.name);

describe('suggestions on GitHub', () => {
  it('creates the issue, then posts the continuation comments in order', async () => {
    const f = fakeGitHub();
    const big = 'x'.repeat(130_000);
    const r = await createSuggestionOnGitHub(f.gh(), payload(big), { labels: ['design-system'] });
    expect(r).toMatchObject({ number: 42, url: 'https://github.com/o/r/issues/42', parts: 3, warnings: [] });
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /repos/o/r/issues', 'POST /repos/o/r/issues/42/comments', 'POST /repos/o/r/issues/42/comments', 'POST /repos/o/r/issues/42/comments']);
    expect(f.calls[0]!.body.labels).toEqual(['bridge-suggestion', 'suggestion: token-change', 'source: studio', 'tier: 3', 'suggestion: needs review', 'design-system']);
    expect(f.calls[1]!.body.body).toContain('part 1/3');
    // Read back: the parts reassemble and the sha matches.
    const d = await getSuggestionOnGitHub(f.gh(), 42, gov);
    expect(d.parsed.ok && d.parsed.payload.files![0]!.content).toBe(big);
    expect(d.parsed.ok && d.parsed.sha).toBe(r.sha);
    expect(d.status).toBe('needs-review');
  });

  it('says which part failed and that the suggestion is incomplete', async () => {
    const f = fakeGitHub({ refuseComments: true });
    await expect(createSuggestionOnGitHub(f.gh(), payload('y'.repeat(130_000)))).rejects.toThrow(/Suggestion #42 is incomplete: part 2 of 3 could not be posted/);
    const d = await getSuggestionOnGitHub(f.gh(), 42, gov);
    expect(d.parsed).toMatchObject({ ok: false, reason: 'missing-part' });
  });

  it('reviews: owners approve the current version, the label follows, outsiders do not count', async () => {
    const f = fakeGitHub();
    const { sha } = await createSuggestionOnGitHub(f.gh(), payload());
    f.as('mallory');
    const drive = await reviewSuggestionOnGitHub(f.gh(), 42, { event: 'approve' }, gov);
    expect(drive).toMatchObject({ counts: false, status: 'needs-review' });
    expect(drive.warnings[0]).toMatch(/does not count/);
    f.as('dana');
    const design = await reviewSuggestionOnGitHub(f.gh(), 42, { event: 'approve', role: 'design', payloadSha: sha }, gov);
    expect(design).toMatchObject({ counts: true, status: 'needs-review', payloadSha: sha });
    f.as('teo');
    const tech = await reviewSuggestionOnGitHub(f.gh(), 42, { event: 'approve', role: 'tech' }, gov);
    expect(tech.status).toBe('approved');
    expect(labelsOf(f, 42)).toContain('suggestion: approved');
    expect(labelsOf(f, 42)).not.toContain('suggestion: needs review');
    const posted = f.comments.get(42)!.at(-1)!.body;
    expect(posted).toBe(composeSuggestionReviewComment({ event: 'approve', role: 'tech', payloadSha: sha, at: JSON.parse(/\{.*\}/.exec(posted)![0]).at, by: 'teo' }));
  });

  it('an edited payload makes approvals stale and refuses a review of the old version', async () => {
    const f = fakeGitHub();
    const { sha } = await createSuggestionOnGitHub(f.gh(), payload());
    f.as('dana');
    await reviewSuggestionOnGitHub(f.gh(), 42, { event: 'approve' }, gov);
    f.as('teo');
    await reviewSuggestionOnGitHub(f.gh(), 42, { event: 'approve' }, gov);
    expect((await getSuggestionOnGitHub(f.gh(), 42, gov)).status).toBe('approved');
    // Someone edits the payload on GitHub.
    const issue = f.issues.get(42);
    issue.body = issue.body.replace('"{palette.harbor.700}"', '"#ff0000"');
    const d = await getSuggestionOnGitHub(f.gh(), 42, gov);
    expect(d.parsed.ok && d.parsed.edited).toBe(true);
    expect(d.approvals).toMatchObject({ approvers: [], stale: ['dana', 'teo'] });
    expect(d.status).toBe('needs-review');
    await expect(reviewSuggestionOnGitHub(f.gh(), 42, { event: 'approve', payloadSha: sha }, gov)).rejects.toThrow(/changed since you opened it/);
    const again = await reviewSuggestionOnGitHub(f.gh(), 42, { event: 'request-changes', message: 'Why red?' }, gov);
    expect(again.status).toBe('changes-requested');
    expect(again.warnings.some((w) => /edited by hand/.test(w))).toBe(true);
    await expect(reviewSuggestionOnGitHub(f.gh(), 42, { event: 'request-changes' }, gov)).rejects.toThrow(/Say what should change/);
  });

  it('links the pull request that applies it, lists with linked pull requests, declines', async () => {
    const f = fakeGitHub({ pulls: [{ number: 88, state: 'open', body: 'Applies the suggestion.\n\nCloses #42' }] });
    const { sha } = await createSuggestionOnGitHub(f.gh(), payload());
    await createSuggestionOnGitHub(f.gh(), { ...payload(), title: 'Second one' });
    f.as('dev');
    expect(await linkSuggestionPrOnGitHub(f.gh(), 42, { pr: 88, by: 'dev', payloadSha: sha })).toEqual({ warnings: [] });
    expect(f.comments.get(42)!.at(-1)!.body).toMatch(/^Being applied in pull request #88 by @dev\./);
    expect(labelsOf(f, 42)).toContain('suggestion: applying');
    expect(labelsOf(f, 42)).not.toContain('suggestion: needs review');
    expect((await getSuggestionOnGitHub(f.gh(), 42, gov)).status).toBe('applying');
    await expect(linkSuggestionPrOnGitHub(f.gh(), 42, { payloadSha: sha })).rejects.toThrow(/Say where it is applied/);

    const list = await listSuggestionsOnGitHub(f.gh());
    expect(list.map((s) => [s.number, s.kind, s.tier, s.status, s.linkedPrs.map((p) => p.number)])).toEqual([
      [43, 'token-change', 3, 'needs-review', []],
      [42, 'token-change', 3, 'applying', [88]],
    ]);

    f.as('teo');
    await expect(declineSuggestionOnGitHub(f.gh(), 43, 'No.')).rejects.toThrow(/at least 10/);
    expect(await declineSuggestionOnGitHub(f.gh(), 43, 'We keep the current contrast for now.', 'teo')).toEqual({ warnings: [] });
    expect(f.issues.get(43)).toMatchObject({ state: 'closed', state_reason: 'not_planned' });
    expect(labelsOf(f, 43).filter((l: string) => l.startsWith('suggestion: ') && l !== 'suggestion: token-change')).toEqual([]);
    expect((await getSuggestionOnGitHub(f.gh(), 43, gov)).status).toBe('declined');
  });

  it('applied once the linked pull request merged', async () => {
    const f = fakeGitHub({ pulls: [{ number: 90, state: 'merged', body: 'Fixes #42' }] });
    await createSuggestionOnGitHub(f.gh(), payload());
    f.issues.get(42).state = 'closed';
    f.issues.get(42).state_reason = 'completed';
    const d = await getSuggestionOnGitHub(f.gh(), 42, gov);
    expect(d.linkedPrs).toEqual([{ number: 90, url: 'https://github.com/o/r/pull/90', state: 'closed', merged: true }]);
    expect(d.status).toBe('applied');
    expect(suggestionPayloadSha(payload())).toBe(d.parsed.ok && d.parsed.sha);
  });
});
