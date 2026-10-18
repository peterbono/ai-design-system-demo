import { describe, expect, it } from 'vitest';
import {
  assignRequestOnGitHub,
  composeRequestIssue,
  declineComment,
  declineReasonProblems,
  declineRequestOnGitHub,
  GitHubClient,
  linkRequestToExplorationOnGitHub,
  parseRequestIssue,
  withRequestExploration,
  type ComponentChangeRequest,
  type FetchLike,
} from '../src/index';

const req: ComponentChangeRequest = {
  component: 'Select',
  kind: 'new-component',
  title: 'Add a native Select',
  summary: 'Pages without React need one.',
  changes: [],
  source: 'studio',
  requestedBy: 'ana',
};
const body = `${composeRequestIssue(req).body}\n\nA note a person added on GitHub.`;

interface Call {
  method: string;
  path: string;
  body: any;
}

/** A fake GitHub that records every call. `assignable`: who GitHub accepts as an assignee. */
function fake(opts: { assignable?: string[]; labels?: boolean; issueBody?: string } = {}) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com', '');
    const sent = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body: sent });
    const ok = (b: unknown, status = 200) => ({
      ok: true,
      status,
      json: async () => b,
      text: async () => JSON.stringify(b),
    });
    const issue = {
      number: 81,
      title: 'Select: add a native Select',
      body: opts.issueBody ?? body,
      html_url: 'https://github.com/o/r/issues/81',
      state: 'open',
      labels: [{ name: 'component-change' }],
      user: { login: 'ana' },
      created_at: '',
      updated_at: '',
    };
    if (method === 'GET' && path === '/repos/o/r/issues/81') return ok(issue);
    if (method === 'PATCH' && path === '/repos/o/r/issues/81') return ok({ ...issue, ...sent });
    if (method === 'POST' && path === '/repos/o/r/issues/81/labels')
      return opts.labels === false
        ? {
            ok: false,
            status: 403,
            json: async () => ({ message: 'nope' }),
            text: async () => '',
          }
        : ok([]);
    if (method === 'POST' && path === '/repos/o/r/issues/81/assignees')
      return ok({
        assignees: (sent.assignees as string[]).filter((a) => (opts.assignable ?? ['flo', 'dev']).includes(a)).map((login) => ({ login })),
      });
    if (method === 'POST' && path === '/repos/o/r/issues/81/comments') return ok({ id: 1 }, 201);
    if (method === 'GET' && path.startsWith('/repos/o/r/collaborators')) return ok([{ login: 'flo', avatar_url: 'a' }, { login: 'dev' }]);
    return {
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not Found' }),
      text: async () => '',
    };
  };
  const retry = { attempts: 1, baseDelayMs: 0, sleep: async () => undefined };
  return {
    calls,
    gh: (token = 't') => new GitHubClient('o/r', token, fetchImpl, retry),
  };
}

describe('request decisions, pure', () => {
  it('links the hidden block and the readable part to an exploration, keeping what people wrote', () => {
    const out = withRequestExploration(body, 'explore/native-select')!;
    expect(parseRequestIssue(out)).toEqual({
      ...req,
      exploration: 'explore/native-select',
    });
    expect(out).toContain('**Exploration:** `explore/native-select`.');
    expect(out.indexOf('**Exploration:**')).toBeLessThan(out.indexOf('## How to implement'));
    expect(out).toContain('A note a person added on GitHub.');
    // Linked again to another one: one line, the new branch.
    const again = withRequestExploration(out, 'explore/other')!;
    expect(again.match(/\*\*Exploration:\*\*/g)).toHaveLength(1);
    expect(parseRequestIssue(again)?.exploration).toBe('explore/other');
    expect(withRequestExploration('A plain issue', 'explore/x')).toBeUndefined();
  });

  it('asks for a reason that says why, and quotes it with who declined', () => {
    expect(declineReasonProblems('  ')[0]).toMatch(/requester reads it/);
    expect(declineReasonProblems('No.')[0]).toMatch(/at least 10/);
    expect(declineReasonProblems('Use the Combobox instead, it covers this.')).toEqual([]);
    const c = declineComment('Use the Combobox instead.\nIt covers this.', '@flo');
    expect(c).toBe('Declined by @flo in Bridge Studio.\n\n> Use the Combobox instead.\n> It covers this.\n\n<sub>Closed as not planned. Reopen the issue if things change.</sub>');
    expect(declineComment('Out of scope for now.')).toMatch(/^Declined in Bridge Studio\./);
    expect(c).not.toMatch(/—/);
  });
});

describe('request decisions on GitHub', () => {
  it('links a request to an exploration: body, label and the starter assigned', async () => {
    const f = fake();
    const r = await linkRequestToExplorationOnGitHub(f.gh(), 81, 'explore/native-select', { assignee: '@flo' });
    expect(r).toEqual({
      number: 81,
      branch: 'explore/native-select',
      assignees: ['flo'],
      warnings: [],
    });
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /repos/o/r/issues/81', 'PATCH /repos/o/r/issues/81', 'POST /repos/o/r/issues/81/labels', 'POST /repos/o/r/issues/81/assignees']);
    expect(parseRequestIssue(f.calls[1]!.body.body)?.exploration).toBe('explore/native-select');
    expect(f.calls[2]!.body).toEqual({ labels: ['exploration'] });
    expect(f.calls[3]!.body).toEqual({ assignees: ['flo'] });
  });

  it('keeps the link when the label or the assignee is refused, and says so', async () => {
    const f = fake({ labels: false, assignable: [] });
    const r = await linkRequestToExplorationOnGitHub(f.gh(), 81, 'explore/native-select', { assignee: 'flo' });
    expect(r.assignees).toEqual([]);
    expect(r.warnings).toEqual(['The exploration label could not be added to #81.']);
  });

  it('refuses a branch that is not an exploration, and an issue without a Bridge block, before any write', async () => {
    const f = fake({ issueBody: 'Plain words' });
    await expect(linkRequestToExplorationOnGitHub(f.gh(), 81, 'main')).rejects.toThrow(/not an exploration branch/);
    await expect(linkRequestToExplorationOnGitHub(f.gh(), 81, 'explore/x')).rejects.toThrow(/no Bridge request block/);
    expect(f.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('assigns someone, and fails when GitHub does not keep them', async () => {
    const f = fake();
    expect(await assignRequestOnGitHub(f.gh(), 81, '@dev')).toEqual(['dev']);
    await expect(assignRequestOnGitHub(f.gh(), 81, 'stranger')).rejects.toThrow(/did not assign @stranger/);
    await expect(assignRequestOnGitHub(f.gh(), 81, ' ')).rejects.toThrow(/Pick who/);
    await expect(assignRequestOnGitHub(f.gh(''), 81, 'dev')).rejects.toThrow(/needs a GitHub token/);
  });

  it('declines: the reason as a comment, then closed as not planned', async () => {
    const f = fake();
    await declineRequestOnGitHub(f.gh(), 81, 'Use the Combobox instead, it covers this.', 'flo');
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /repos/o/r/issues/81/comments', 'PATCH /repos/o/r/issues/81']);
    expect(f.calls[0]!.body.body).toMatch(/^Declined by @flo in Bridge Studio\./);
    expect(f.calls[1]!.body).toEqual({
      state: 'closed',
      state_reason: 'not_planned',
    });
    await expect(declineRequestOnGitHub(f.gh(), 81, '')).rejects.toThrow(/Say why/);
    expect(f.calls).toHaveLength(2);
  });

  it('lists who can push', async () => {
    const f = fake();
    expect(await f.gh().listCollaborators()).toEqual([
      { login: 'flo', avatarUrl: 'a' },
      { login: 'dev', avatarUrl: '' },
    ]);
    expect(f.calls[0]!.path).toBe('/repos/o/r/collaborators?permission=push&per_page=100');
  });
});
