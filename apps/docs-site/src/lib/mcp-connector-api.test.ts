// The hosted Bridge MCP connector (api/mcp, api/_lib/oauth.ts, api/_lib/fix-sessions.ts): discovery metadata, the
// OAuth 2.1 flow Claude runs (DCR and CIMD, PKCE S256, resource, iss), the GitHub leg, rotating refresh tokens, the
// MCP endpoint with the person's GitHub token, fix sessions recorded from real tool calls, and revoking from Studio.
// Fakes only: a fake GitHub, a fake Claude client, no network.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BridgeContext } from '@bridge-ds/mcp';
import { ACCOUNT_COOKIE, putAccount, signAccountSession } from '../../api/_lib/account';
import { QUIET_AFTER_MS, stepOf, STEP_WORDS } from '../../api/_lib/fix-sessions';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { redirectMatches } from '../../api/_lib/oauth';
import { handleConnector, HOSTED_REFUSED_TOOLS, HOSTED_REFUSED_WORDS, type ConnectorEnv, type FetchLike, type McpHandler } from '../../api/mcp/index';
import { handleFixSessions } from '../../api/fix-sessions/index';

const HOST = 'bridge.example.com';
const SITE = `https://${HOST}`;
const SECRET = 's'.repeat(40);
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const b64url = (b: Buffer) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = b64url(createHash('sha256').update(VERIFIER).digest());

function world(o: { push?: boolean; refreshFails?: boolean; realMcp?: boolean; checkFails?: boolean; app?: boolean } = {}) {
  let t = Date.parse('2026-10-25T10:00:00Z');
  const calls: { url: string; method: string; body?: string }[] = [];
  let issued = 0;
  const f: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, ...(init.body ? { body: init.body } : {}) });
    const u = new URL(url);
    if (url === 'https://claude.ai/oauth/claude-code-client-metadata') return res(200, { client_id: url, client_name: 'Claude Code', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' });
    if (u.host === 'github.com' && u.pathname === '/login/oauth/access_token') {
      const p = new URLSearchParams(init.body ?? '');
      if (p.get('grant_type') === 'refresh_token' && o.refreshFails) return res(200, { error: 'bad_refresh_token' });
      issued++;
      return res(200, { access_token: `ghu_user_token_${issued}_0000000000`, expires_in: 28800, refresh_token: `ghr_refresh_${issued}_000000`, refresh_token_expires_in: 15811200 });
    }
    const auth = init.headers.Authorization ?? '';
    if (u.pathname === '/user') return /ghu_/.test(auth) ? res(200, { login: 'dana', name: 'Dana Kim' }) : res(401, {});
    if (u.pathname === '/repos/acme/design') {
      if (auth.includes('ghu_admin')) return res(200, { permissions: { admin: true, push: true, pull: true } });
      if (auth.includes('ghu_other')) return res(404, {});
      return res(200, { default_branch: 'main', permissions: { admin: false, push: o.push !== false, pull: true } });
    }
    return res(404, {});
  };
  const redis = memoryRedis(() => t);
  const env: ConnectorEnv = { LIBRARY_SESSION_SECRET: SECRET, GITHUB_APP_CLIENT_ID: 'Iv1.bridge', GITHUB_APP_CLIENT_SECRET: 'app-secret', PUBLIC_SITE_URL: SITE };
  const mcpSeen: { body: unknown; repo: string }[] = [];
  const toolAnswers: Record<string, unknown> = {};
  const mcp: McpHandler = async (ctx, _req, body) => {
    mcpSeen.push({ body, repo: (ctx as unknown as { repo: string }).repo });
    const m = body as { id: number; method: string; params?: { name?: string } };
    if (m.method !== 'tools/call') return res(200, { jsonrpc: '2.0', id: m.id, result: { tools: [] } });
    return res(200, { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(toolAnswers[m.params!.name!]) }] } });
  };
  // realMcp: the real Bridge MCP server (packages/mcp handleHttp) on a real context, GitHub faked by `f`.
  const fakes = o.realMcp ? {} : { mcp, context: async (x: { repo: string; token: string }) => ({ repo: x.repo, token: x.token }) as unknown as BridgeContext };
  const checked: { repo: string; pr: number | string }[] = [];
  const checkPieces = async (ctx: BridgeContext, pr: number | string) => {
    if (o.checkFails) throw new Error('GitHub answered 500');
    checked.push({ repo: (ctx as unknown as { repo: string }).repo, pr });
    return { pieces: [{ id: 'badge-overdue' }, { id: 'color-c2410c' }], recorded: true };
  };
  const deps = { fetch: f, now: () => t, redis, ...fakes, checkPieces, ...(o.app ? { app: { installationToken: async () => 'ghs_app_token' } } : {}) };
  const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    handleConnector(new Request(`${SITE}${path}`, { method: init.method ?? 'GET', headers: { host: HOST, ...(init.headers ?? {}) }, ...(init.body !== undefined ? { body: init.body } : {}) }), env, deps);
  const sessionsCall = (path: string, headers: Record<string, string>) => handleFixSessions(new Request(`${SITE}${path}`, { headers: { host: HOST, ...headers } }), env, deps);
  return { calls, redis, env, call, sessionsCall, mcpSeen, toolAnswers, checked, tick: (ms: number) => (t += ms), now: () => t };
}

const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
const cookieOf = (r: Response) => /bridge_oauth=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';

/** Claude's whole sign-in: register, authorize, the Studio page, GitHub, back to Claude, then the token. */
async function signIn(w: ReturnType<typeof world>, clientId?: string, redirectUri = CALLBACK) {
  let id = clientId;
  if (!id) {
    const reg = await w.call('/api/mcp?oauth=register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] }) });
    expect(reg.status).toBe(201);
    id = (await reg.json()).client_id;
  }
  const q = new URLSearchParams({ response_type: 'code', client_id: id!, redirect_uri: redirectUri, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'st8', resource: `${SITE}/mcp`, scope: 'bridge' });
  const auth = await w.call(`/api/mcp?oauth=authorize&${q}`);
  expect(auth.status).toBe(302);
  const page = new URL(auth.headers.get('location')!, SITE);
  expect(page.pathname).toBe('/studio/connect-claude/');
  const request = page.searchParams.get('request')!;
  const cookie = cookieOf(auth);
  const info = await (await w.call(`/api/mcp?oauth=request&id=${request}`, { headers: { cookie: `bridge_oauth=${cookie}` } })).json();
  expect(info).toEqual({ client: id!.startsWith('https://') ? 'Claude Code' : 'Claude', redirectHost: new URL(redirectUri).host, sameBrowser: true, signedIn: false, name: null, teams: [] });
  await putAccount(w.redis, { id: 'a1', email: 'dana@acme.design', name: 'Dana', github: { login: 'dana', id: 7 }, createdAt: '2026-10-01T00:00:00Z', version: 1 });
  const account = `${ACCOUNT_COOKIE}=${signAccountSession({ email: 'dana@acme.design', v: 1, exp: w.now() + 60_000 }, SECRET)}`;
  // Signed in now: the same read says who, and the account's teams that have a design system (not a team made in Bridge).
  await memberStore(w.redis).put('acme/design', { email: 'dana@acme.design', name: 'Dana', role: 'admin', version: 1, addedBy: 'x', at: '2026-10-01T00:00:00Z' });
  await memberStore(w.redis).put('_team/0123456789abcdef', { email: 'dana@acme.design', name: 'Dana', role: 'admin', version: 1, addedBy: 'x', at: '2026-10-01T00:00:00Z' });
  const signed = await (await w.call(`/api/mcp?oauth=request&id=${request}`, { headers: { cookie: `bridge_oauth=${cookie}; ${account}` } })).json();
  expect(signed).toMatchObject({ signedIn: true, name: 'Dana', teams: [{ repo: 'acme/design', name: 'Design' }] });
  const approve = await w.call('/api/mcp?oauth=approve', { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, cookie: `bridge_oauth=${cookie}; ${account}` }, body: JSON.stringify({ request, repo: 'acme/design', allow: true }) });
  expect(approve.status).toBe(200);
  const gh = new URL((await approve.json()).redirect);
  expect(gh.origin + gh.pathname).toBe('https://github.com/login/oauth/authorize');
  expect(gh.searchParams.get('redirect_uri')).toBe(`${SITE}/oauth/github`);
  expect(gh.searchParams.get('code_challenge_method')).toBe('S256');
  const back = await w.call(`/api/mcp?oauth=github&code=ghcode&state=${gh.searchParams.get('state')}`, { headers: { cookie: `bridge_oauth=${cookie}` } });
  expect(back.status).toBe(302);
  const to = new URL(back.headers.get('location')!);
  return { clientId: id!, to, cookie };
}

async function tokens(w: ReturnType<typeof world>, clientId: string, code: string, redirectUri = CALLBACK) {
  const r = await w.call('/api/mcp?oauth=token', form({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: redirectUri, resource: `${SITE}/mcp` }));
  return { status: r.status, body: await r.json() };
}

const rpc = (id: number, name: string, args: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const mcpPost = (w: ReturnType<typeof world>, token: string, body: string) => w.call('/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body });

describe('discovery (MCP authorization 2026-07-28, Claude connector requirements)', () => {
  it('protected resource and authorization server metadata, with PKCE S256, public clients and CIMD', async () => {
    const w = world();
    expect(await (await w.call('/api/mcp?wk=resource')).json()).toEqual({ resource: `${SITE}/mcp`, authorization_servers: [SITE], scopes_supported: ['bridge'], bearer_methods_supported: ['header'], resource_name: 'Bridge' });
    const as = await (await w.call('/api/mcp?wk=as')).json();
    expect(as).toMatchObject({
      issuer: SITE,
      authorization_endpoint: `${SITE}/oauth/authorize`,
      token_endpoint: `${SITE}/oauth/token`,
      registration_endpoint: `${SITE}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  it('an MCP call without a token gets 401 with the resource_metadata pointer and the scope', async () => {
    const w = world();
    const r = await w.call('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp", scope="bridge"`);
    const bad = await w.call('/api/mcp', { method: 'POST', headers: { authorization: 'Bearer bat_nope', 'content-type': 'application/json' }, body: '{}' });
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });
});

describe('the OAuth flow Claude runs', () => {
  it('DCR, authorize, the Studio page, GitHub, back to Claude with code and iss, PKCE token exchange, MCP as the person', async () => {
    const w = world();
    const { clientId, to } = await signIn(w);
    expect(to.origin + to.pathname).toBe(CALLBACK);
    expect(to.searchParams.get('state')).toBe('st8');
    expect(to.searchParams.get('iss')).toBe(SITE);
    const code = to.searchParams.get('code')!;
    // A wrong verifier is refused, and the code then is gone (used once).
    const wrong = await w.call('/api/mcp?oauth=token', form({ grant_type: 'authorization_code', code, code_verifier: 'x'.repeat(64), client_id: clientId, redirect_uri: CALLBACK }));
    expect((await wrong.json()).error).toBe('invalid_grant');
    expect((await tokens(w, clientId, code)).body.error).toBe('invalid_grant');
  });

  it('issues short-lived access tokens and rotating refresh tokens; the MCP server acts on the team with the GitHub token', async () => {
    const w = world();
    const { clientId, to } = await signIn(w);
    const t = await tokens(w, clientId, to.searchParams.get('code')!);
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'bridge' });
    expect(t.body.access_token).toMatch(/^bat_/);
    const list = await mcpPost(w, t.body.access_token, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(list.status).toBe(200);
    expect(w.mcpSeen[0]).toMatchObject({ repo: 'acme/design' });
    // Rotation: the refresh token works once.
    const r1 = await w.call('/api/mcp?oauth=token', form({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token, client_id: clientId }));
    const next = await r1.json();
    expect(next.access_token).toMatch(/^bat_/);
    const again = await w.call('/api/mcp?oauth=token', form({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token, client_id: clientId }));
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe('invalid_grant');
    // Access tokens last an hour.
    w.tick(3601_000);
    expect((await mcpPost(w, t.body.access_token, '{}')).status).toBe(401);
  });

  it('Claude Code: its Client ID Metadata Document, a loopback redirect on any port', async () => {
    const w = world();
    const cimd = 'https://claude.ai/oauth/claude-code-client-metadata';
    const { to } = await signIn(w, cimd, 'http://localhost:51234/callback');
    expect(to.origin).toBe('http://localhost:51234');
    expect((await tokens(w, cimd, to.searchParams.get('code')!, 'http://localhost:51234/callback')).status).toBe(200);
    expect(redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:9/callback')).toBe(true);
    expect(redirectMatches(['http://localhost/callback'], 'http://localhost:9/other')).toBe(false);
    expect(redirectMatches([CALLBACK], 'https://claude.ai/api/mcp/auth_callback/x')).toBe(false);
  });

  it('refuses: no PKCE (back to the client), an address the client did not register (no redirect), another browser, no push', async () => {
    const w = world();
    const reg = await (await w.call('/api/mcp?oauth=register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) })).json();
    const noPkce = await w.call(`/api/mcp?oauth=authorize&${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CALLBACK, state: 's' })}`);
    expect(noPkce.status).toBe(302);
    expect(new URL(noPkce.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
    const evil = await w.call(`/api/mcp?oauth=authorize&${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: CHALLENGE, code_challenge_method: 'S256' })}`);
    expect(evil.status).toBe(400);
    expect(evil.headers.get('location')).toBeNull();
    // DCR refuses a plain http redirect that is not loopback.
    expect((await w.call('/api/mcp?oauth=register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) })).status).toBe(400);
    // Someone who cannot push gets no grant.
    const ro = world({ push: false });
    const { to } = await signIn(ro).catch(() => ({ to: null as unknown as URL }));
    expect(to).toBeTruthy();
    expect(to.pathname).toBe('/studio/connect-claude/');
    expect(to.searchParams.get('error')).toBe('no_access');
  });
});

describe('fix sessions: real steps from tool calls, never a percentage', () => {
  it('records read, tries and the fix for review, with who and when; the plugin reads it by component', async () => {
    const w = world();
    const { clientId, to } = await signIn(w);
    const { access_token } = (await tokens(w, clientId, to.searchParams.get('code')!)).body;
    w.toolAnswers.bridge_get_gap_case = { gap: { component: 'TextInput', variants: [{ differences: [{}, {}] }, { differences: [{}] }] } };
    w.toolAnswers.bridge_try_figma_fix = { status: 'checked', verdict: 'closer' };
    w.toolAnswers.bridge_propose_figma_fixes = { status: 'pr-opened', pr: 91, url: 'https://github.com/acme/design/pull/91' };
    const plugin = { authorization: 'Bearer ghu_user_token_9_0000000000' };
    const read = async () => (await (await w.call('/api/mcp?view=session&repo=acme/design&component=TextInput', { headers: plugin })).json()).session;
    expect(await read()).toMatchObject({ state: 'waiting', steps: [] });
    await mcpPost(w, access_token, rpc(1, 'bridge_get_gap_case', { component: 'TextInput' }));
    w.tick(60_000);
    await mcpPost(w, access_token, rpc(2, 'bridge_try_figma_fix', { component: 'TextInput', fixes: [{ kind: 'part' }] }));
    let s = await read();
    expect(s.state).toBe('working');
    expect(s.steps.map((x: { text: string }) => x.text)).toEqual(['Claude read the differences (3)', 'Claude tried a fix (round 1): closer']);
    expect(s.steps[0].by).toBe('Dana Kim');
    expect(s).not.toHaveProperty('percent');
    w.tick(60_000);
    await mcpPost(w, access_token, rpc(3, 'bridge_propose_figma_fixes', { component: 'TextInput', fixes: [{ kind: 'part' }], summary: 'x' }));
    s = await read();
    expect(s.state).toBe('ready');
    expect(s.steps.at(-1)).toMatchObject({ text: 'Claude opened its fix for review', pr: { number: 91 }, review: 'changes/?pr=91' });
    expect(s.elapsed).toBe(120);
    const all = await (await w.call('/api/mcp?view=sessions&repo=acme/design', { headers: plugin })).json();
    expect(all.sessions.map((x: { component: string }) => x.component)).toEqual(['TextInput']);
  });

  it('says Claude went quiet after 10 minutes without a step, and Claude stopped when it gives up honestly', async () => {
    const w = world();
    const { clientId, to } = await signIn(w);
    const { access_token } = (await tokens(w, clientId, to.searchParams.get('code')!)).body;
    w.toolAnswers.bridge_get_gap_case = { gap: { variants: [{ differences: [{}] }] } };
    await mcpPost(w, access_token, rpc(1, 'bridge_get_gap_case', { component: 'Tabs' }));
    w.tick(QUIET_AFTER_MS + 1000);
    const plugin = { authorization: 'Bearer ghu_user_token_9_0000000000' };
    const quiet = (await (await w.call('/api/mcp?view=session&repo=acme/design&component=Tabs', { headers: plugin })).json()).session;
    // Still working as far as anyone knows, and said plainly: no invented progress.
    expect(quiet).toMatchObject({ state: 'working', quiet: true });
    expect(quiet.steps.at(-1)).toMatchObject({ text: STEP_WORDS.quiet, label: STEP_WORDS.quiet, status: 'failed' });
    expect(
      stepOf({ repo: 'acme/design', tool: 'bridge_propose_figma_fixes', args: { component: 'Tabs', fixes: [{ kind: 'status', reason: 'No fix brought Tabs closer in 3 rounds.' }] }, result: { status: 'pr-opened', pr: 4, url: 'u' }, by: 'Dana', now: 0 }, null),
    ).toMatchObject({ kind: 'stopped', text: 'Claude stopped: No fix brought Tabs closer in 3 rounds.' });
    expect(stepOf({ repo: 'r', tool: 'bridge_try_figma_fix', args: { component: 'T' }, result: { status: 'checked', verdict: 'worse' }, by: 'D', now: 0 }, null)!.text).toBe('Claude tried a fix (round 1): further away');
    expect(stepOf({ repo: 'r', tool: 'bridge_try_figma_fix', args: { component: 'T' }, result: { status: 'checked', verdict: 'same' }, by: 'D', now: 0 }, null)!.text).toBe('Claude tried a fix (round 1): no change');
  });

  it('GET /api/fix-sessions answers the shape the Figma plugin reads (label, status, reason, pr, round, maxRounds)', async () => {
    const w = world();
    const { clientId, to } = await signIn(w);
    const { access_token } = (await tokens(w, clientId, to.searchParams.get('code')!)).body;
    w.toolAnswers.bridge_get_gap_case = { gap: { variants: [{ differences: [{}, {}] }] } };
    w.toolAnswers.bridge_try_figma_fix = { status: 'checked', verdict: 'worse' };
    w.toolAnswers.bridge_propose_figma_fixes = { status: 'pr-opened', pr: 12, url: 'https://github.com/acme/design/pull/12' };
    await mcpPost(w, access_token, rpc(1, 'bridge_get_gap_case', { component: 'Tabs' }));
    await mcpPost(w, access_token, rpc(2, 'bridge_try_figma_fix', { component: 'Tabs', fixes: [{ kind: 'part' }] }));
    const plugin = { authorization: 'Bearer ghu_user_token_9_0000000000' };
    let r = await w.sessionsCall('/api/fix-sessions?repo=acme/design&component=Tabs', plugin);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    let s = (await r.json()).session;
    expect(s).toMatchObject({ component: 'Tabs', state: 'working', round: 1, maxRounds: 3 });
    expect(s.steps.map((x: { label: string; status: string }) => [x.label, x.status])).toEqual([
      ['Claude read the differences (2)', 'done'],
      ['Claude tried a fix (round 1): further away', 'current'],
    ]);
    await mcpPost(w, access_token, rpc(3, 'bridge_propose_figma_fixes', { component: 'Tabs', fixes: [{ kind: 'status', reason: 'No fix brought Tabs closer in 3 rounds.' }] }));
    r = await w.sessionsCall('/api/fix-sessions?repo=acme/design&component=Tabs', plugin);
    s = (await r.json()).session;
    expect(s).toMatchObject({ state: 'stopped', reason: 'No fix brought Tabs closer in 3 rounds.', pr: { number: 12, url: 'https://github.com/acme/design/pull/12' } });
    expect(s.steps.at(-1).status).toBe('failed');
  });

  it('only people on the team read sessions; CORS is open for the plugin', async () => {
    const w = world();
    const other = await w.call('/api/mcp?view=session&repo=acme/design&component=Tabs', { headers: { authorization: 'Bearer ghu_other_team_token_0000' } });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBe('*');
    expect((await w.call('/api/mcp?view=session&repo=acme/design&component=Tabs')).status).toBe(401);
  });
});

describe('Studio: the library check of an exploration (?view=pieces)', () => {
  const post = (w: ReturnType<typeof world>, body: unknown, headers: Record<string, string> = { authorization: 'Bearer ghu_user_token_9_0000000000' }) =>
    w.call('/api/mcp?view=pieces', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('runs the check with the person token and records it: a number, or a product repository reference', async () => {
    const w = world();
    const r = await post(w, { repo: 'acme/design', pr: 12 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ checked: true, pieces: 2 });
    expect((await post(w, { repo: 'acme/design', pr: 'shop#7' })).status).toBe(200);
    expect(w.checked).toEqual([
      { repo: 'acme/design', pr: 12 },
      { repo: 'acme/design', pr: 'shop#7' },
    ]);
  });

  it('needs a GitHub sign-in with push, a POST and an exploration number', async () => {
    const w = world({ push: false });
    expect((await post(w, { repo: 'acme/design', pr: 12 }, {})).status).toBe(401);
    expect((await post(w, { repo: 'acme/design', pr: 12 })).status).toBe(403);
    expect((await post(world(), { repo: 'acme/design', pr: '12; rm' })).status).toBe(400);
    expect((await world().call('/api/mcp?view=pieces&repo=acme/design')).status).toBe(405);
    expect(w.checked).toEqual([]);
  });

  it('answers a designer sentence when the check fails, never the error', async () => {
    const r = await post(world({ checkFails: true }), { repo: 'acme/design', pr: 12 });
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.message).toBe('Bridge could not check it against the library this time.');
    expect(JSON.stringify(body)).not.toMatch(/GitHub answered/);
  });
});

describe('Studio: who connected Bridge in Claude, and revoking', () => {
  it('lists connections with who and last use; the owner or an admin removes one and its tokens stop at once', async () => {
    const w = world();
    const { clientId, to } = await signIn(w);
    const { access_token } = (await tokens(w, clientId, to.searchParams.get('code')!)).body;
    const studio = { authorization: 'Bearer ghu_user_token_9_0000000000' };
    const list = await (await w.call('/api/mcp?view=connections&repo=acme/design', { headers: studio })).json();
    expect(list.connections).toHaveLength(1);
    expect(list.connections[0]).toMatchObject({ client: 'Claude', by: 'Dana Kim', mine: true });
    expect(JSON.stringify(list)).not.toMatch(/ghu_|ghr_|bat_|brt_/);
    const id = list.connections[0].id;
    const rm = await w.call('/api/mcp?view=disconnect', { method: 'POST', headers: { ...studio, 'content-type': 'application/json' }, body: JSON.stringify({ repo: 'acme/design', id }) });
    expect(rm.status).toBe(200);
    expect((await mcpPost(w, access_token, '{}')).status).toBe(401);
  });

  it('an email member signed in to Studio reads their own connection as theirs (the exploration page gate)', async () => {
    const w = world({ app: true });
    await signIn(w);
    const account = `${ACCOUNT_COOKIE}=${signAccountSession({ email: 'dana@acme.design', v: 1, exp: w.now() + 60_000 }, SECRET)}`;
    const member = { cookie: account, 'x-bridge-contribute': '1', origin: SITE };
    const list = await (await w.call('/api/mcp?view=connections&repo=acme/design', { headers: member })).json();
    expect(list.connections).toHaveLength(1);
    expect(list.connections[0]).toMatchObject({ client: 'Claude', mine: true });
    await putAccount(w.redis, { id: 'a2', email: 'lee@acme.design', name: 'Lee', github: null, createdAt: '2026-10-01T00:00:00Z', version: 1 });
    await memberStore(w.redis).put('acme/design', { email: 'lee@acme.design', name: 'Lee', role: 'edit', version: 1, addedBy: 'x', at: '2026-10-01T00:00:00Z' });
    const lee = { cookie: `${ACCOUNT_COOKIE}=${signAccountSession({ email: 'lee@acme.design', v: 1, exp: w.now() + 60_000 }, SECRET)}`, 'x-bridge-contribute': '1', origin: SITE };
    const theirs = await (await w.call('/api/mcp?view=connections&repo=acme/design', { headers: lee })).json();
    expect(theirs.connections[0]).toMatchObject({ mine: false });
  });

  it('ends the connection when GitHub no longer renews the person token', async () => {
    const w = world({ refreshFails: true });
    const { clientId, to } = await signIn(w);
    const { refresh_token } = (await tokens(w, clientId, to.searchParams.get('code')!)).body;
    w.tick(8 * 3600_000);
    // A fresh Bridge token from the refresh token, but the person's GitHub token cannot be renewed: the grant ends.
    const fresh = await (await w.call('/api/mcp?oauth=token', form({ grant_type: 'refresh_token', refresh_token, client_id: clientId }))).json();
    expect(fresh.access_token).toMatch(/^bat_/);
    expect((await mcpPost(w, fresh.access_token, '{}')).status).toBe(401);
    const studio = { authorization: 'Bearer ghu_user_token_9_0000000000' };
    expect((await (await w.call('/api/mcp?view=connections&repo=acme/design', { headers: studio })).json()).connections).toEqual([]);
  });
});

describe('the real Bridge MCP server over Streamable HTTP (packages/mcp handleHttp)', () => {
  it('answers initialize and lists the Fix with Claude tools, stateless, as JSON', async () => {
    const { handleHttp } = await import('@bridge-ds/mcp');
    const gh = (async (url: string) => (new URL(url).pathname === '/repos/acme/design' ? res(200, { full_name: 'acme/design', default_branch: 'main', private: true }) : res(404, {}))) as unknown as typeof fetch;
    const ctx = await BridgeContext.create({ repo: 'acme/design', token: 'ghu_test_token_0000000000', surface: 'mcp', fetch: gh });
    const post = (body: unknown) => handleHttp(ctx, new Request(`${SITE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }), body);
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    expect(init.status).toBe(200);
    // The connector shows as Bridge with the Bridge mark (MCP 2025-11-25 Implementation title and icons), on this domain.
    const info = (await init.json()).result.serverInfo;
    expect(info).toMatchObject({ name: 'bridge', title: 'Bridge', websiteUrl: 'https://bridge.floriangouloubi.com/' });
    expect(info.icons).toEqual([
      { src: 'https://bridge.floriangouloubi.com/icon-192.png', mimeType: 'image/png', sizes: ['192x192'] },
      { src: 'https://bridge.floriangouloubi.com/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] },
      { src: 'https://bridge.floriangouloubi.com/favicon.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
    ]);
    const latest = await post({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    const answered = (await latest.json()).result;
    expect(answered.protocolVersion).toBe('2025-11-25');
    expect(answered.serverInfo).toEqual(info);
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = ((await list.json()).result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['bridge_figma_gaps', 'bridge_get_gap_case', 'bridge_try_figma_fix', 'bridge_propose_figma_fixes']));
  });
});

describe('agents never merge through the hosted connector', () => {
  const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' });
  const mergeCall = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'bridge_merge_branch', arguments: { pr: 7, overrideReason: 'Shipping it now, the owner said so.' } } });

  it('the hosted server does not list the merge, and a call to it is refused before anything runs', async () => {
    const w = world({ realMcp: true });
    const { clientId, to } = await signIn(w);
    const token = (await tokens(w, clientId, to.searchParams.get('code')!)).body.access_token as string;
    const post = (body: unknown) => w.call('/api/mcp', { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
    await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-ai', version: '0.1.0' } } });
    const names = ((await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain('bridge_branch_status');
    expect(names).not.toContain('bridge_merge_branch');
    const before = w.calls.length;
    const r = await post(mergeCall(3));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ jsonrpc: '2.0', id: 3, error: { code: -32602, message: HOSTED_REFUSED_WORDS } });
    // Nothing reached GitHub for it.
    expect(w.calls.slice(before)).toEqual([]);
  });

  it('a batch carrying the merge is refused whole: the MCP server never sees it', async () => {
    const w = world();
    const { clientId, to } = await signIn(w);
    const token = (await tokens(w, clientId, to.searchParams.get('code')!)).body.access_token as string;
    const r = await w.call('/api/mcp', { method: 'POST', headers: headers(token), body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }, mergeCall(2)]) });
    expect(await r.json()).toEqual([1, 2].map((id) => ({ jsonrpc: '2.0', id, error: { code: -32602, message: HOSTED_REFUSED_WORDS } })));
    expect(w.mcpSeen).toEqual([]);
    expect(HOSTED_REFUSED_TOOLS).toContain('bridge_merge_branch');
  });

  it('the local MCP server keeps the merge; the hosted one leaves it out', async () => {
    const { handleHttp } = await import('@bridge-ds/mcp');
    const gh = (async (url: string) => (new URL(url).pathname === '/repos/acme/design' ? res(200, { full_name: 'acme/design', default_branch: 'main', private: true }) : res(404, {}))) as unknown as typeof fetch;
    const ctx = await BridgeContext.create({ repo: 'acme/design', token: 'ghu_test_token_0000000000', surface: 'mcp', fetch: gh });
    const post = (body: unknown, opts?: { exclude: readonly string[] }) => handleHttp(ctx, new Request(`${SITE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }), body, opts);
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const local = ((await (await post(list)).json()).result.tools as { name: string }[]).map((t) => t.name);
    expect(local).toContain('bridge_merge_branch');
    const hosted = ((await (await post(list, { exclude: HOSTED_REFUSED_TOOLS })).json()).result.tools as { name: string }[]).map((t) => t.name);
    expect(hosted).not.toContain('bridge_merge_branch');
    expect(hosted.length).toBe(local.length - 1);
    // Called anyway on the hosted server: an error, never a merge.
    const called = await (await post(mergeCall(2), { exclude: HOSTED_REFUSED_TOOLS })).json();
    expect(called.error ?? called.result?.isError).toBeTruthy();
  });
});

describe("Claude's handshake on the hosted connector (production logs: 400, 200, 202, 200 per session)", () => {
  // Claude is a dual-era client: it tries the stateless 2026-07-28 revision first, then falls back to initialize. Bridge
  // speaks 2025-11-25 and earlier, so the probe gets the spec's legacy answer, a 400 without a modern error, and the
  // initialize handshake that follows works (packages/mcp handleHttp says why the 400 stays).
  const MODERN_ERRORS = [-32020, -32021, -32022];
  const headers = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...extra });
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'claude-ai', version: '0.1.0' }, 'io.modelcontextprotocol/clientCapabilities': {} };

  for (const probe of ['server/discover', 'tools/list']) {
    it(`a ${probe} probe at 2026-07-28 gets 400 without a modern error, then initialize, initialized and tools/list work`, async () => {
      const w = world({ realMcp: true });
      const { clientId, to } = await signIn(w);
      const token = (await tokens(w, clientId, to.searchParams.get('code')!)).body.access_token as string;
      const post = (body: unknown, extra?: Record<string, string>) => w.call('/api/mcp', { method: 'POST', headers: headers(token, extra), body: JSON.stringify(body) });

      // 1. The modern probe: 400, and a body Claude does not read as a 2026-07-28 server, so it falls back.
      const first = await post({ jsonrpc: '2.0', id: 0, method: probe, params: { _meta: meta } }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': probe });
      expect(first.status).toBe(400);
      const err = (await first.json()).error;
      expect(MODERN_ERRORS).not.toContain(err.code);
      expect(err.data?.supported).toBeUndefined();
      expect(err.message).toMatch(/Unsupported protocol version: 2026-07-28/);

      // 2. initialize at the newest legacy revision: 200 with Bridge's identity, no session (stateless).
      const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-ai', version: '0.1.0' } } });
      expect(init.status).toBe(200);
      const result = (await init.json()).result;
      expect(result.protocolVersion).toBe('2025-11-25');
      expect(result.serverInfo).toMatchObject({ name: 'bridge', title: 'Bridge' });
      expect(init.headers.get('mcp-session-id')).toBeNull();

      // 3. notifications/initialized: 202.
      const initialized = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-protocol-version': '2025-11-25' });
      expect(initialized.status).toBe(202);

      // 4. tools/list: 200 with the tools.
      const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-protocol-version': '2025-11-25' });
      expect(list.status).toBe(200);
      expect(((await list.json()).result.tools as { name: string }[]).map((t) => t.name)).toContain('bridge_get_gap_case');
    });
  }
});
