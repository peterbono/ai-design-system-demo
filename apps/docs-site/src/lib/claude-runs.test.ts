// Claude fix runs on the server (api/claude + api/_lib/fix-runs.ts): the same loop as `bridge fix --with-claude`, one
// Claude round per request with the state in Redis between requests, the team's connected key, and the Bridge app for
// GitHub. A real Carbon measure and the plugin's Check fidelity run (core's gap fixtures); a fake Claude and a fake
// GitHub: no key, no network.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeKeyStore, secretsKey } from '../../api/_lib/claude-key';
import { anthropicAsk, RUN_WORDS, stepRun, type StoredRun } from '../../api/_lib/fix-runs';
import type { AppTokens } from '../../api/_lib/github-app';
import { memoryRedis } from '../../api/_lib/redis';
import { handleClaude, type ClaudeEnv, type FetchLike } from '../../api/claude/index';

const GAP = join(__dirname, '../../../../packages/core/test/fixtures/gap');
const MEASURED = readFileSync(join(GAP, 'carbon-measured-hidden-boxes.json'), 'utf8');
const FIDELITY = readFileSync(join(GAP, 'textinput-fidelity.json'), 'utf8');
const HOST = 'bridge.example.com';
const SECRET = Buffer.alloc(32, 7).toString('base64');
const FAKE_KEY = `sk-ant-fake-${'k'.repeat(24)}`;
const MAIN_SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-10-25T10:00:00Z');

const labelFixed = { id: 'textinput-label-height', kind: 'part', component: 'TextInput', part: 'cds--text-input-label-wrapper', height: 'fixed', reason: 'Carbon keeps 24 px for the label row; Figma hugged the 16 px label.', by: 'claude' };
const outerFixed = { id: 'textinput-field-height', kind: 'part', component: 'TextInput', part: 'cds--text-input-field-outer-wrapper', height: 'fixed', reason: 'The field and its helper keep their measured height with the 4 px gap.', by: 'claude' };
const shrink = { id: 'textinput-label-shrink', kind: 'part', component: 'TextInput', part: 'cds--text-input-label-wrapper', height: 4, reason: 'Make the label row smaller.', by: 'claude' };

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const PEOPLE: Record<string, { login: string; name: string; perms: Record<string, Record<string, boolean>> }> = {
  ghu_editor_token_000000000: { login: 'malik', name: 'Malik Haddad', perms: { 'acme/design': { admin: false, push: true, pull: true } } },
  ghu_reader_token_000000000: { login: 'rae', name: 'Rae', perms: { 'acme/design': { admin: false, push: false, pull: true } } },
  ghu_other_team_token_00000: { login: 'otto', name: 'Otto', perms: { 'other/ds': { admin: true, push: true, pull: true } } },
};
const EDITOR = { authorization: 'Bearer ghu_editor_token_000000000' };

interface World {
  files: Record<string, string>;
  calls: { method: string; path: string; body?: any; auth: string }[];
  prompts: string[];
  replies: (string | Error)[];
  anthropic: number[];
}

function setup(o: { replies?: (string | Error)[]; files?: Record<string, string>; connected?: boolean } = {}) {
  const w: World = { files: { 'measured-specs.json': MEASURED, 'figma-fidelity.json': FIDELITY, ...(o.files ?? {}) }, calls: [], prompts: [], replies: o.replies ?? [], anthropic: [] };
  const f: FetchLike = async (url, init) => {
    const u = new URL(url);
    const auth = init.headers.Authorization ?? '';
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method: init.method, path: u.pathname + u.search, body, auth });
    if (u.host === 'api.anthropic.com') return res(w.anthropic.shift() ?? 200, { content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn' });
    const user = PEOPLE[auth.replace(/^Bearer /, '')];
    if (user) {
      if (u.pathname === '/user') return res(200, { login: user.login, name: user.name });
      const m = /^\/repos\/([^/]+\/[^/]+)$/.exec(u.pathname);
      return m && user.perms[m[1]!] ? res(200, { permissions: user.perms[m[1]!] }) : res(404, {});
    }
    expect(auth).toBe('Bearer ghs_app');
    const p = u.pathname;
    const R = '/repos/acme/design';
    if (p === R) return res(200, { default_branch: 'main', full_name: 'acme/design', private: true });
    if (p === `${R}/git/ref/heads/main`) return res(200, { object: { sha: MAIN_SHA } });
    if (p.startsWith(`${R}/git/ref/heads/`)) return res(404, { message: 'Not Found' });
    if (p.startsWith(`${R}/contents/`)) {
      const path = decodeURIComponent(p.slice(`${R}/contents/`.length));
      expect(init.headers.Accept).toBe('application/vnd.github.raw');
      return w.files[path] !== undefined ? new Response(w.files[path], { status: 200 }) : res(404, { message: 'Not Found' });
    }
    if (p === `${R}/git/commits/${MAIN_SHA}`) return res(200, { tree: { sha: 't'.repeat(40) } });
    if (p === `${R}/git/trees` && init.method === 'POST') return res(201, { sha: 'u'.repeat(40) });
    if (p === `${R}/git/commits` && init.method === 'POST') return res(201, { sha: 'c'.repeat(40) });
    if (p === `${R}/git/refs` && init.method === 'POST') return res(201, { ref: body.ref });
    if (p === `${R}/pulls` && init.method === 'POST') return res(201, { number: 91, html_url: 'https://github.com/acme/design/pull/91', title: body.title, draft: body.draft, head: { ref: body.head } });
    if (p === `${R}/issues/91/labels`) return res(200, []);
    return res(404, { message: `unexpected ${init.method} ${p}` });
  };
  const redis = memoryRedis(() => NOW);
  const app: AppTokens = { installationToken: async (owner) => (owner === 'acme' ? 'ghs_app' : null) };
  const env: ClaudeEnv = { BRIDGE_SECRETS_KEY: SECRET, LIBRARY_SESSION_SECRET: 's'.repeat(40), GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'pem', PUBLIC_SITE_URL: `https://${HOST}` };
  const ask = (key: string) => async (prompt: string) => {
    expect(key).toBe(FAKE_KEY);
    w.prompts.push(prompt);
    const r = w.replies[w.prompts.length - 1] ?? '[]';
    if (r instanceof Error) throw r;
    return r;
  };
  const deps = { fetch: f, now: () => NOW, redis, app, ask };
  const ready = (async () => {
    if (o.connected !== false) await claudeKeyStore(redis, secretsKey(SECRET)!).connect('acme/design', FAKE_KEY, 'Dana Kim', NOW);
  })();
  const call = async (method: 'GET' | 'POST', x: { body?: unknown; query?: string; headers?: Record<string, string> } = {}) => {
    await ready;
    return handleClaude(
      new Request(`https://${HOST}/api/claude${x.query ?? ''}`, {
        method,
        headers: { host: HOST, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...(x.headers ?? EDITOR) },
        ...(method === 'POST' ? { body: JSON.stringify(x.body) } : {}),
      }),
      env,
      deps,
    );
  };
  const start = async (component = 'TextInput', headers: Record<string, string> = EDITOR) => call('POST', { body: { action: 'fix', repo: 'acme/design', component }, headers });
  const poll = async (id: string, headers: Record<string, string> = EDITOR) => call('GET', { query: `?repo=acme/design&run=${id}`, headers });
  const writes = () => w.calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/v1/'));
  return { w, redis, call, start, poll, writes };
}

const body = async (r: Response) => {
  const text = await r.text();
  expect(text).not.toContain(FAKE_KEY);
  return JSON.parse(text);
};

describe('a Claude fix run across requests (the state machine)', () => {
  it('queued, then one round per request, then the same draft pull request the CLI opens', async () => {
    const s = setup({ replies: [`Here are my fixes:\n\`\`\`json\n${JSON.stringify([labelFixed])}\n\`\`\``, JSON.stringify([labelFixed, outerFixed])] });
    const started = await body(await s.start());
    expect(started.existing).toBe(false);
    expect(started.run).toMatchObject({ component: 'TextInput', status: 'queued', label: 'Claude is on it', sentence: 'Claude is starting on TextInput.', startedBy: 'Malik Haddad', maxRounds: 3 });
    const id = started.run.id as string;
    expect(s.w.prompts).toHaveLength(0);

    // Request 1: round 1 (closer), nothing written yet.
    const one = await body(await s.poll(id));
    expect(s.w.prompts).toHaveLength(1);
    expect(s.w.prompts[0]).toContain('Height 72 in Figma vs 84 in code');
    expect(one.run).toMatchObject({ status: 'running', round: 2, sentence: 'Claude is on TextInput: round 2 of 3.' });
    expect(s.writes()).toEqual([]);

    // The state lives in Redis between requests: the next request continues from it.
    const stored = JSON.parse((await s.redis.cmd('GET', `bridge:claude:run:acme/design:${id}`)) as string) as StoredRun;
    expect(stored.loop).toMatchObject({ round: 1, done: false });
    expect(stored.loop!.best!.fixes).toEqual([labelFixed]);

    // Request 2: round 2 resolves every difference, so the same request opens the pull request.
    const two = await body(await s.poll(id));
    expect(s.w.prompts).toHaveLength(2);
    expect(s.w.prompts[1]).toContain('Round 1: you proposed');
    expect(two.run).toMatchObject({
      status: 'ready',
      label: "Claude's fix is ready",
      pr: { number: 91, url: 'https://github.com/acme/design/pull/91', draft: true },
      review: 'changes/?pr=91',
      reviewUrl: `https://${HOST}/studio/acme/design/changes/?pr=91`,
      applied: [labelFixed.reason, outerFixed.reason],
    });
    const ref = s.w.calls.find((c) => c.path === '/repos/acme/design/git/refs')!;
    expect(ref.body.ref).toBe('refs/heads/bridge/figma-fixes-text-input');
    const tree = s.w.calls.find((c) => c.path === '/repos/acme/design/git/trees')!;
    expect(tree.body.tree[0].path).toBe('figma-fixes.json');
    expect(JSON.parse(tree.body.tree[0].content).fixes.map((x: any) => x.id)).toEqual(['textinput-label-height', 'textinput-field-height']);
    const pr = s.w.calls.find((c) => c.path === '/repos/acme/design/pulls')!;
    expect(pr.body).toMatchObject({ base: 'main', head: 'bridge/figma-fixes-text-input', draft: true, title: 'fix(figma): TextInput drawn closer to its story' });
    expect(pr.body.body).toContain('## TextInput in Figma, fixed with Claude');
    expect(pr.body.body).toContain('Asked by Malik Haddad.');
    expect(pr.body.body).toContain("Drafted by Claude through Bridge with the team's connected Claude (source: bridge-web)");
    const labels = s.w.calls.find((c) => c.path === '/repos/acme/design/issues/91/labels')!.body.labels;
    expect(labels).toEqual(expect.arrayContaining(['drafted-by-claude', 'figma-fixes', 'source: bridge-web']));

    // Final: asking again changes nothing and asks Claude nothing.
    const again = await body(await s.poll(id));
    expect(again.run.status).toBe('ready');
    expect(s.w.prompts).toHaveLength(2);
    // The component is free again for a new run.
    expect((await body(await s.start())).existing).toBe(false);
  });

  it('lists the team\'s runs, newest first, and peeks without moving a run', async () => {
    const s = setup({ replies: [JSON.stringify([labelFixed])] });
    const { run } = await body(await s.start());
    const peek = await body(await s.call('GET', { query: `?repo=acme/design&run=${run.id}&peek=1` }));
    expect(peek.run.status).toBe('queued');
    expect(s.w.prompts).toHaveLength(0);
    const list = await body(await s.call('GET', { query: '?repo=acme/design&runs=1' }));
    expect(list.runs.map((r: any) => r.id)).toEqual([run.id]);
  });
});

describe('refusals: no gap, worse, Claude did not come closer', () => {
  it('nothing to fix: the latest check says the component matches, so no Claude call and no write', async () => {
    const s = setup();
    const { run } = await body(await s.start('Toggle'));
    const r = await body(await s.poll(run.id));
    expect(r.run).toMatchObject({ status: 'no-fix', label: 'No fix found', reason: RUN_WORDS.nothing('Toggle') });
    expect(s.w.prompts).toHaveLength(0);
    expect(s.writes()).toEqual([]);
  });

  it('three rounds further from the code: no pull request, an honest sentence', async () => {
    const s = setup({ replies: [JSON.stringify([shrink]), JSON.stringify([shrink]), 'I am not sure.'] });
    const { run } = await body(await s.start());
    for (let i = 0; i < 2; i++) expect((await body(await s.poll(run.id))).run.status).toBe('running');
    const last = await body(await s.poll(run.id));
    expect(s.w.prompts).toHaveLength(3);
    expect(s.w.prompts[1]).toContain('(worse)');
    expect(last.run).toMatchObject({ status: 'no-fix', reason: 'Claude could not find a fix that brings TextInput closer to the code. It stays as it is.' });
    expect(last.run.developer).toMatch(/No round came closer/);
    expect(s.writes()).toEqual([]);
  });

  it('a component the measure does not know: a calm sentence, the cause for developers', async () => {
    const s = setup();
    const { run } = await body(await s.start('Toaster'));
    const r = await body(await s.poll(run.id));
    expect(r.run).toMatchObject({ status: 'failed', reason: RUN_WORDS.setup });
    expect(r.run.developer).toContain('No measured story of Toaster');
    expect(r.run.sentence).not.toMatch(/measured-specs|stack|Error/);
  });
});

describe('Claude errors', () => {
  it('busy: the run waits and asks again on the next request, then gives up calmly', async () => {
    const s = setup();
    const { run } = await body(await s.start());
    const { ClaudeCallError } = await import('../../api/_lib/fix-runs');
    s.w.replies = [new ClaudeCallError(529, 'Overloaded'), new ClaudeCallError(529, 'Overloaded'), new ClaudeCallError(529, 'Overloaded'), new ClaudeCallError(529, 'Overloaded')];
    for (let i = 0; i < 3; i++) {
      const r = await body(await s.poll(run.id));
      expect(r.run).toMatchObject({ status: 'running', round: 1 });
      expect(r.run.retryAfter).toBe(20);
      s.w.prompts.length = 0;
      s.w.replies.shift();
    }
    const gaveUp = await body(await s.poll(run.id));
    expect(gaveUp.run).toMatchObject({ status: 'failed', reason: RUN_WORDS.busy });
  });

  it('a key Anthropic refuses fails the run with the Settings step; the API call carries the key to Anthropic only', async () => {
    const s = setup();
    s.w.anthropic.push(401);
    const run: StoredRun = { v: 1, id: '0'.repeat(16), repo: 'acme/design', component: 'TextInput', status: 'queued', loop: null, ref: null, startedBy: 'Malik', createdAt: '', updatedAt: '', retries: 0 };
    const deps = {
      redis: s.redis,
      fetch: (async (url: string, init: any) => {
        s.w.calls.push({ method: init.method, path: new URL(url).pathname, auth: init.headers['x-api-key'] ?? init.headers.Authorization ?? '' });
        if (new URL(url).host === 'api.anthropic.com') return res(401, { error: { message: 'invalid x-api-key' } });
        return new Response(url.includes('/contents/measured-specs.json') ? MEASURED : url.includes('/contents/figma-fidelity.json') ? FIDELITY : url.includes('/git/ref/heads/main') ? JSON.stringify({ object: { sha: MAIN_SHA } }) : url.endsWith('/repos/acme/design') ? JSON.stringify({ default_branch: 'main' }) : '{}', { status: url.includes('/contents/figma-fixes') || url.includes('bridge.config') || url.includes('bridge-requests') ? 404 : 200 });
      }) as FetchLike,
      now: () => NOW,
      appToken: async () => 'ghs_app',
      claudeKey: async () => FAKE_KEY,
    };
    const out = await stepRun(deps, run);
    expect(out).toMatchObject({ status: 'failed', reason: RUN_WORDS.keyRejected });
    expect(out.developer).toContain('401');
    const withKey = s.w.calls.filter((c) => c.auth === FAKE_KEY);
    expect(withKey.map((c) => c.path)).toEqual(['/v1/messages']);
  });

  it('anthropicAsk: the Messages API with claude-sonnet-5-5 and 4000 tokens; a declined reply reads as empty', async () => {
    let sent: any = null;
    const ask = anthropicAsk((async (url: string, init: any) => {
      sent = { url, headers: init.headers, body: JSON.parse(init.body) };
      return res(200, { stop_reason: 'refusal', content: [] });
    }) as FetchLike, FAKE_KEY);
    expect(await ask('hello')).toBe('');
    expect(sent.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent.headers['x-api-key']).toBe(FAKE_KEY);
    expect(sent.body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 4000 });
  });
});

describe('limits and who may ask', () => {
  it('one run per component: asking again answers the run in progress', async () => {
    const s = setup();
    const a = await body(await s.start());
    const b = await body(await s.start());
    expect(b).toMatchObject({ existing: true, run: { id: a.run.id } });
  });

  it('a few runs per team and hour', async () => {
    const s = setup();
    for (const c of ['A1', 'A2', 'A3', 'A4', 'A5']) expect((await s.start(c)).status).toBe(200);
    const r = await s.start('A6');
    expect(r.status).toBe(429);
    expect((await r.json()).message).toBe(RUN_WORDS.tooMany(5));
  });

  it('two requests never work on one run at once', async () => {
    const s = setup({ replies: [JSON.stringify([labelFixed])] });
    const { run } = await body(await s.start());
    await s.redis.cmd('SET', `bridge:claude:lease:acme/design:${run.id}`, '1', 'EX', 280);
    const r = await body(await s.poll(run.id));
    expect(r.run.status).toBe('queued');
    expect(s.w.prompts).toHaveLength(0);
  });

  it('wrong team, a reader or nobody: never starts nor reads a run', async () => {
    const s = setup();
    const { run } = await body(await s.start());
    const other = { authorization: 'Bearer ghu_other_team_token_00000' };
    const reader = { authorization: 'Bearer ghu_reader_token_000000000' };
    expect((await s.start('TextInput', other)).status).toBe(403);
    expect((await s.start('TextInput', reader)).status).toBe(403);
    expect((await s.poll(run.id, other)).status).toBe(403);
    expect((await s.poll(run.id, {})).status).toBe(401);
    // A run id of this team read as another team's: not there.
    const otherRepo = await s.call('GET', { query: `?repo=other/ds&run=${run.id}&peek=1`, headers: other });
    expect(otherRepo.status).toBe(404);
  });

  it('a team without Claude connected is told how to connect it', async () => {
    const s = setup({ connected: false });
    const r = await s.start();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'not_connected', message: RUN_WORDS.notConnected });
  });
});
