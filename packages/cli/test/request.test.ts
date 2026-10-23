// bridge request (list, show, implement, create) and the jira-sync step, with an in-memory GitHub and a mocked Jira.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { composeRequestIssue, type ComponentChangeRequest } from '@bridge-ds/core';
import { jiraSync } from '../src/jira-sync.js';
import { parseChange, runRequest, type RequestIO } from '../src/request.js';
import { fakeGitHub, REAL_PATHS, REPO, tempGitRepo } from '../../mcp/test/helpers.js';

const OWNER = 'peterbono';
const NAME = 'ai-design-system-demo';

function io(gh: ReturnType<typeof fakeGitHub>, over: Partial<RequestIO> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: RequestIO = {
    print: (s) => out.push(s),
    error: (s) => err.push(s),
    env: {},
    fetch: gh.fetch,
    ghToken: () => undefined,
    hasClaude: () => false,
    runClaude: () => 0,
    ...over,
  };
  return { io: value, out: () => out.join('\n'), err: () => err.join('\n') };
}

const args = (...argv: string[]) => {
  const a = { _: [] as string[], flags: {} as Record<string, string[]> };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x.startsWith('--')) {
      const k = x.slice(2);
      const next = argv[i + 1];
      (a.flags[k] ??= []).push(next !== undefined && !next.startsWith('--') && !['json', 'claude', 'dry-run'].includes(k) ? argv[++i]! : 'true');
    } else a._.push(x);
  }
  return a;
};

function seed(gh: ReturnType<typeof fakeGitHub>, r: Partial<ComponentChangeRequest> & Pick<ComponentChangeRequest, 'component' | 'title'>) {
  const issue = composeRequestIssue({ kind: 'visual', summary: 'Corners read too sharp next to the cards.', changes: [{ field: 'radius', before: 'control', after: 'container' }], source: 'figma', ...r });
  const number = 100 + gh.issues.length;
  gh.issues.push({ number, title: issue.title, body: issue.body, state: 'open', state_reason: null, labels: issue.labels.map((name) => ({ name })), user: { login: 'designer' }, html_url: `https://github.com/${OWNER}/${NAME}/issues/${number}`, created_at: '', updated_at: '' });
  return number;
}

describe('bridge request', () => {
  const dir = tempGitRepo(REPO, REAL_PATHS);

  it('list, show and implement read the issues of the repo in bridge.config.json', async () => {
    const gh = fakeGitHub(OWNER, NAME, {});
    const n = seed(gh, { component: 'Button', title: 'Rounder corners' });
    gh.pulls.push({ number: 1, title: 'Rounder Button corners', body: `Closes #${n}`, state: 'open', draft: true, user: { login: 'dev' }, head: { ref: 'agent/request-100', sha: 'x' }, base: { ref: 'main' }, labels: [], html_url: `https://github.com/${OWNER}/${NAME}/pull/1`, updated_at: '' });

    const l = io(gh);
    expect(await runRequest(args('request', 'list'), dir, l.io)).toBe(0);
    expect(l.out()).toMatch(/#100\s+In progress\s+Button\s+visual\s+Rounder corners\s+PR #1 open/);

    const none = io(gh);
    expect(await runRequest(args('request', 'list', '--status', 'done'), dir, none.io)).toBe(0);
    expect(none.out()).toMatch(/No done component change request/);
    await expect(runRequest(args('request', 'list', '--status', 'later'), dir, io(gh).io)).rejects.toThrow(/--status takes/);

    const s = io(gh);
    expect(await runRequest(args('request', 'show', '100'), dir, s.io)).toBe(0);
    expect(s.out()).toContain('#100 Button: Rounder corners');
    expect(s.out()).toContain('radius: control -> container');
    expect(s.out()).toMatch(/Component: 6 file\(s\) in packages\/react\/src\/components\/Button/);

    const b = io(gh);
    expect(await runRequest(args('request', 'implement', '#100'), dir, b.io)).toBe(0);
    expect(b.out()).toContain('Implement Bridge component change request #100');
    expect(b.out()).toContain('- packages/react/src/components/Button/Button.tsx');
    expect(b.out()).not.toMatch(/—/);
    // Reading needs no token and writes nothing.
    expect(gh.log.filter((x) => x.method !== 'GET')).toEqual([]);
  });

  it('implement --claude: starts Claude Code with the brief, or says how when it is not installed (exit 1)', async () => {
    const gh = fakeGitHub(OWNER, NAME, {});
    seed(gh, { component: 'Button', title: 'Rounder corners' });
    const runClaude = vi.fn(() => 0);
    const yes = io(gh, { hasClaude: () => true, runClaude });
    expect(await runRequest(args('request', 'implement', '100', '--claude'), dir, yes.io)).toBe(0);
    expect(runClaude).toHaveBeenCalledOnce();
    expect(runClaude.mock.calls[0]![0]).toContain('Implement Bridge component change request #100');

    const no = io(gh);
    expect(await runRequest(args('request', 'implement', '100', '--claude'), dir, no.io)).toBe(1);
    expect(no.out()).toContain('Implement Bridge component change request #100');
    expect(no.err()).toMatch(/Claude Code is not installed/);
    expect(no.err()).toContain('claude "$(bridge request implement 100)"');
  });

  it('show on an issue that is not a request exits 1; usage errors throw (exit 2)', async () => {
    const gh = fakeGitHub(OWNER, NAME, {});
    gh.issues.push({ number: 100, title: 'Docs typo', body: 'x', state: 'open', state_reason: null, labels: [], user: { login: 'dev' }, html_url: '', created_at: '', updated_at: '' });
    const s = io(gh);
    expect(await runRequest(args('request', 'show', '100'), dir, s.io)).toBe(1);
    expect(s.err()).toMatch(/not a component change request/);
    await expect(runRequest(args('request', 'show'), dir, io(gh).io)).rejects.toThrow(/Usage: bridge request show/);
    await expect(runRequest(args('request', 'nope'), dir, io(gh).io)).rejects.toThrow(/Unknown request command/);
    expect(await runRequest(args('request'), dir, io(gh).io)).toBe(2);
  });

  it('create: dry run needs no token, a real one needs GITHUB_TOKEN, --token or --use-gh-auth, the issue says source: cli', async () => {
    const gh = fakeGitHub(OWNER, NAME, {});
    const create = ['request', 'create', '--component', 'Button', '--kind', 'new-variant', '--title', 'Add a danger ghost variant', '--summary', 'Toolbars need a quieter danger button.', '--change', 'variant=:danger-ghost'];
    const d = io(gh);
    expect(await runRequest(args(...create, '--dry-run'), dir, d.io)).toBe(0);
    expect(d.out()).toContain('Dry run, nothing created.');
    expect(d.out()).toContain('Title: Button: add a danger ghost variant');
    expect(d.out()).toContain('Labels: component-change, request: new-variant, source: cli');
    expect(gh.issues).toHaveLength(0);

    await expect(runRequest(args(...create), dir, io(gh).io)).rejects.toThrow(/needs a token you pass: set GITHUB_TOKEN, pass --token <token>, or add --use-gh-auth/);
    await expect(runRequest(args('request', 'create', '--component', 'Button', '--kind', 'big', '--title', 'x', '--summary', 'y'), dir, io(gh).io)).rejects.toThrow(/--kind takes/);
    // Signed in with gh, but the gh sign-in was not passed for this write: refused, nothing sent (tests/auth.test.ts).
    await expect(runRequest(args(...create), dir, io(gh, { ghToken: () => 'from-gh' }).io)).rejects.toThrow(/needs a token you pass/);
    expect(gh.issues).toHaveLength(0);

    const c = io(gh, { ghToken: () => 'from-gh' });
    expect(await runRequest(args(...create, '--use-gh-auth'), dir, c.io)).toBe(0);
    expect(c.out()).toContain(`Created request #100: https://github.com/${OWNER}/${NAME}/issues/100`);
    expect(gh.issues[0]!.labels.map((l: any) => l.name)).toEqual(['component-change', 'request: new-variant', 'source: cli']);
    expect(gh.issues[0]!.body).toContain('| variant |  | danger-ghost |');
  });

  it('parseChange', () => {
    expect(parseChange('size=md:lg')).toEqual({ field: 'size', before: 'md', after: 'lg' });
    expect(parseChange('radius=pill')).toEqual({ field: 'radius', after: 'pill' });
    expect(parseChange('icon')).toEqual({ field: 'icon' });
  });
});

// --- jira-sync ---------------------------------------------------------------------------------------------

const JIRA = 'https://acme.atlassian.net';

function repoWithJira(jira = true) {
  const d = tempGitRepo(REPO, ['bridge.config.json']);
  const p = join(d, 'bridge.config.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  if (jira) cfg.integrations = { jira: { baseUrl: JIRA, project: 'DS', labels: ['design system'] } };
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  return d;
}

/** GitHub (fake) plus a Jira that records calls. */
function world() {
  const gh = fakeGitHub(OWNER, NAME, {});
  const jiraCalls: { url: string; method: string; body: any; auth: string }[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (!url.startsWith(JIRA)) return gh.fetch(input, init);
    const headers = init.headers as Record<string, string>;
    jiraCalls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization ?? '' });
    if (url.endsWith('/rest/api/3/issue')) return new Response(JSON.stringify({ id: '10001', key: 'DS-12', self: `${JIRA}/rest/api/3/issue/10001` }), { status: 201 });
    return new Response(JSON.stringify({ id: '1' }), { status: 201 });
  }) as typeof fetch;
  return { gh, jiraCalls, fetch: f };
}

const env = { JIRA_EMAIL: 'ds@acme.test', JIRA_API_TOKEN: 'jira-token', GITHUB_TOKEN: 'gh-token', GITHUB_REPOSITORY: `${OWNER}/${NAME}` };
const event = (action: string, number: number, extra: Record<string, unknown> = {}) => ({ action, issue: { number }, repository: { full_name: `${OWNER}/${NAME}` }, ...extra });

describe('bridge request jira-sync', () => {
  const withJira = repoWithJira();
  const withoutJira = repoWithJira(false);

  it('missing secrets or no integrations.jira: one notice line, no call', async () => {
    const w = world();
    const n = seed(w.gh, { component: 'Button', title: 'Rounder corners' });
    const lines: string[] = [];
    const r1 = await jiraSync({ root: withJira, env: { GITHUB_TOKEN: 'x' }, event: event('opened', n), log: (l) => lines.push(l), fetch: w.fetch });
    expect(r1.status).toBe('off');
    const r2 = await jiraSync({ root: withoutJira, env, event: event('opened', n), log: (l) => lines.push(l), fetch: w.fetch });
    expect(r2.status).toBe('off');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^::notice::Bridge Jira sync is off: add the JIRA_EMAIL and JIRA_API_TOKEN/);
    expect(lines[1]).toMatch(/^::notice::.*integrations\.jira/);
    expect(w.jiraCalls).toEqual([]);
    expect(w.gh.log).toEqual([]);
  });

  it('opened: creates the Jira issue, comments and labels the GitHub issue; a second run does nothing', async () => {
    const w = world();
    const n = seed(w.gh, { component: 'Button', title: 'Rounder corners' });
    const lines: string[] = [];
    const r = await jiraSync({ root: withJira, env, event: event('opened', n), log: (l) => lines.push(l), fetch: w.fetch });
    expect(r).toEqual({ status: 'created', key: 'DS-12', url: `${JIRA}/browse/DS-12` });
    expect(w.jiraCalls).toHaveLength(1);
    const call = w.jiraCalls[0]!;
    expect(call).toMatchObject({ url: `${JIRA}/rest/api/3/issue`, method: 'POST' });
    expect(call.auth).toBe(`Basic ${Buffer.from('ds@acme.test:jira-token').toString('base64')}`);
    expect(call.body.fields).toMatchObject({ project: { key: 'DS' }, issuetype: { name: 'Task' }, summary: 'Button: rounder corners', labels: ['bridge', 'component-change', 'design-system'] });
    expect(JSON.stringify(call.body.fields.description)).toContain(`https://github.com/${OWNER}/${NAME}/issues/${n}`);
    expect(w.gh.comments.get(n)).toEqual([`Jira: DS-12 ${JIRA}/browse/DS-12`]);
    expect(w.gh.issues[0]!.labels.map((l: any) => l.name)).toContain('jira: DS-12');

    // The labeled run of the same new issue: already linked, no second Jira issue.
    const again = await jiraSync({ root: withJira, env, event: event('labeled', n, { label: { name: 'component-change' } }), log: (l) => lines.push(l), fetch: w.fetch });
    expect(again.status).toBe('skipped');
    expect(w.jiraCalls).toHaveLength(1);
    expect(w.gh.comments.get(n)).toHaveLength(1);
  });

  it('already labeled jira: KEY, other labels and non-request issues: no Jira call', async () => {
    const w = world();
    const n = seed(w.gh, { component: 'Button', title: 'Rounder corners' });
    w.gh.issues[0]!.labels.push({ name: 'jira: DS-7' });
    const plain = 100 + w.gh.issues.length;
    w.gh.issues.push({ number: plain, title: 'Docs typo', body: '', state: 'open', state_reason: null, labels: [], user: { login: 'x' }, html_url: '', created_at: '', updated_at: '' });
    const log = () => undefined;
    expect((await jiraSync({ root: withJira, env, event: event('opened', n), log, fetch: w.fetch })).status).toBe('skipped');
    expect((await jiraSync({ root: withJira, env, event: event('labeled', n, { label: { name: 'bug' } }), log, fetch: w.fetch })).status).toBe('skipped');
    expect((await jiraSync({ root: withJira, env, event: event('opened', plain), log, fetch: w.fetch })).status).toBe('skipped');
    expect(w.jiraCalls).toEqual([]);
    expect(w.gh.log.filter((x) => x.method !== 'GET')).toEqual([]);
  });

  it('closed: comments on the linked Jira issue, completed or not planned', async () => {
    const w = world();
    const n = seed(w.gh, { component: 'Button', title: 'Rounder corners' });
    w.gh.issues[0]!.labels.push({ name: 'jira: DS-7' });
    w.gh.issues[0]!.state = 'closed';
    const log = () => undefined;
    const r = await jiraSync({ root: withJira, env, event: event('closed', n, { issue: { number: n, state_reason: 'completed' } }), log, fetch: w.fetch });
    expect(r).toEqual({ status: 'commented', key: 'DS-7' });
    expect(w.jiraCalls[0]).toMatchObject({ url: `${JIRA}/rest/api/3/issue/DS-7/comment`, method: 'POST' });
    expect(JSON.stringify(w.jiraCalls[0]!.body)).toContain(`Closed in GitHub (#${n}), completed`);
    await jiraSync({ root: withJira, env, event: event('closed', n, { issue: { number: n, state_reason: 'not_planned' } }), log, fetch: w.fetch });
    expect(JSON.stringify(w.jiraCalls[1]!.body)).toContain(`Closed in GitHub (#${n}), not planned`);
    // No transition call: only comments.
    expect(w.jiraCalls.every((c) => c.url.endsWith('/comment'))).toBe(true);
  });

  it('a Jira error fails the run with a message that says what to check', async () => {
    const w = world();
    const n = seed(w.gh, { component: 'Button', title: 'Rounder corners' });
    const f = (async (input: string | URL | Request, init: RequestInit = {}) =>
      String(input).startsWith(JIRA) ? new Response(JSON.stringify({ errorMessages: ['Unauthorized'] }), { status: 401 }) : w.gh.fetch(input, init)) as typeof fetch;
    const lines: string[] = [];
    const r = await jiraSync({ root: withJira, env, event: event('opened', n), log: (l) => lines.push(l), fetch: f });
    expect(r.status).toBe('error');
    expect(lines.join('\n')).toMatch(/::error::.*Jira answered 401: Unauthorized\. Check JIRA_EMAIL and JIRA_API_TOKEN/);
    expect(w.gh.comments.get(n)).toBeUndefined();
  });
});
