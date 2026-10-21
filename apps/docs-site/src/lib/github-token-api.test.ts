// The /api/github/token Vercel function (api/github/token.ts) with a mocked GitHub.
import { describe, expect, it, vi } from 'vitest';
import { CALLBACK_PATH, type FetchLike, GITHUB_TOKEN_URL, handleTokenRequest, sameOrigin, validRedirectUri } from '../../api/github/token';

const ENV = { GITHUB_APP_CLIENT_ID: 'Iv23liAbCdEf', GITHUB_APP_CLIENT_SECRET: 'not-a-real-secret' };
const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const VERIFIER = 'v'.repeat(43);
const CODE_BODY = { grant: 'code', code: 'abc123def456', code_verifier: VERIFIER, redirect_uri: `${ORIGIN}${CALLBACK_PATH}` };

function req(body: unknown, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(`${ORIGIN}/api/github/token`, {
    method,
    headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

const github = (payload: unknown, status = 200) => vi.fn<FetchLike>(async () => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }));

const TWO = { ...ENV, GITHUB_APP_SUGGEST_CLIENT_ID: 'Iv23liSuggest', GITHUB_APP_SUGGEST_CLIENT_SECRET: 'not-a-real-suggest-secret' };

describe('POST /api/github/token with two apps', () => {
  it('uses the app named by client_id, with its own secret', async () => {
    const fetch = github({ access_token: 'ghu_abc' });
    const res = await handleTokenRequest(req({ ...CODE_BODY, client_id: 'Iv23liSuggest' }), TWO, fetch);
    expect(res.status).toBe(200);
    expect(Object.fromEntries(new URLSearchParams(fetch.mock.calls[0]![1].body))).toMatchObject({ client_id: 'Iv23liSuggest', client_secret: TWO.GITHUB_APP_SUGGEST_CLIENT_SECRET });

    const direct = github({ access_token: 'ghu_new' });
    await handleTokenRequest(req({ grant: 'refresh', refresh_token: 'ghr_old123', client_id: ENV.GITHUB_APP_CLIENT_ID }), TWO, direct);
    expect(Object.fromEntries(new URLSearchParams(direct.mock.calls[0]![1].body))).toMatchObject({ client_id: ENV.GITHUB_APP_CLIENT_ID, client_secret: ENV.GITHUB_APP_CLIENT_SECRET });
  });

  it('defaults to the Direct app without client_id (tabs opened before the switch)', async () => {
    const fetch = github({ access_token: 'ghu_abc' });
    await handleTokenRequest(req(CODE_BODY), TWO, fetch);
    expect(Object.fromEntries(new URLSearchParams(fetch.mock.calls[0]![1].body))).toMatchObject({ client_id: ENV.GITHUB_APP_CLIENT_ID });
  });

  it('refuses a client_id outside the allow-list, before calling GitHub', async () => {
    const fetch = github({ access_token: 'x' });
    const res = await handleTokenRequest(req({ ...CODE_BODY, client_id: 'Iv23liSomeoneElse' }), TWO, fetch);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unknown_client' });
    expect((await handleTokenRequest(req({ ...CODE_BODY, client_id: 'bad id<x>' }), TWO, fetch)).status).toBe(400);
    expect((await handleTokenRequest(req({ ...CODE_BODY, client_id: 42 }), TWO, fetch)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not allow the suggest app without its secret, and keeps the Direct app working', async () => {
    const half = { ...ENV, GITHUB_APP_SUGGEST_CLIENT_ID: 'Iv23liSuggest' };
    const fetch = github({ access_token: 'ghu_abc' });
    expect((await handleTokenRequest(req({ ...CODE_BODY, client_id: 'Iv23liSuggest' }), half, fetch)).status).toBe(400);
    expect((await handleTokenRequest(req({ ...CODE_BODY, client_id: ENV.GITHUB_APP_CLIENT_ID }), half, fetch)).status).toBe(200);
  });

  it('works with only the suggest app configured', async () => {
    const only = { GITHUB_APP_SUGGEST_CLIENT_ID: 'Iv23liSuggest', GITHUB_APP_SUGGEST_CLIENT_SECRET: 'not-a-real-suggest-secret' };
    const fetch = github({ access_token: 'ghu_abc' });
    expect((await handleTokenRequest(req(CODE_BODY), only, fetch)).status).toBe(200);
    expect(Object.fromEntries(new URLSearchParams(fetch.mock.calls[0]![1].body))).toMatchObject({ client_id: 'Iv23liSuggest' });
  });
});

describe('POST /api/github/token', () => {
  it('trades a code with the secret and PKCE verifier, and returns only the token fields', async () => {
    const fetch = github({ access_token: 'ghu_abc', token_type: 'bearer', expires_in: 28800, refresh_token: 'ghr_def', refresh_token_expires_in: 15811200, scope: '' });
    const res = await handleTokenRequest(req(CODE_BODY), ENV, fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ access_token: 'ghu_abc', token_type: 'bearer', expires_in: 28800, refresh_token: 'ghr_def', refresh_token_expires_in: 15811200 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(GITHUB_TOKEN_URL);
    expect(init.method).toBe('POST');
    expect(init.headers.Accept).toBe('application/json');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      client_id: ENV.GITHUB_APP_CLIENT_ID,
      client_secret: ENV.GITHUB_APP_CLIENT_SECRET,
      code: 'abc123def456',
      code_verifier: VERIFIER,
      redirect_uri: `${ORIGIN}${CALLBACK_PATH}`,
    });
  });

  it('refreshes with a refresh token', async () => {
    const fetch = github({ access_token: 'ghu_new', expires_in: 28800, refresh_token: 'ghr_new' });
    const res = await handleTokenRequest(req({ grant: 'refresh', refresh_token: 'ghr_old123' }), ENV, fetch);
    expect(res.status).toBe(200);
    const sent = Object.fromEntries(new URLSearchParams(fetch.mock.calls[0]![1].body));
    expect(sent).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'ghr_old123', client_id: ENV.GITHUB_APP_CLIENT_ID });
    expect(sent.code).toBeUndefined();
  });

  it('answers 503 without the env vars, so the Studio keeps the token paste', async () => {
    const fetch = github({});
    const res = await handleTokenRequest(req(CODE_BODY), {}, fetch);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses other origins, cross-site fetches and non-JSON posts before calling GitHub', async () => {
    const fetch = github({ access_token: 'x' });
    expect((await handleTokenRequest(req(CODE_BODY, { origin: 'https://evil.example' }), ENV, fetch)).status).toBe(403);
    expect((await handleTokenRequest(req(CODE_BODY, { origin: '' }), ENV, fetch)).status).toBe(403);
    expect((await handleTokenRequest(req(CODE_BODY, { 'sec-fetch-site': 'cross-site' }), ENV, fetch)).status).toBe(403);
    expect((await handleTokenRequest(req(CODE_BODY, { origin: `http://${HOST}` }), ENV, fetch)).status).toBe(403);
    expect((await handleTokenRequest(req(CODE_BODY, { 'content-type': 'text/plain' }), ENV, fetch)).status).toBe(415);
    expect((await handleTokenRequest(req(null, {}, 'GET'), ENV, fetch)).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates every field', async () => {
    const fetch = github({ access_token: 'x' });
    const bad = [
      'not json',
      '[]',
      { grant: 'password' },
      { ...CODE_BODY, code: '' },
      { ...CODE_BODY, code: 'a b' },
      { ...CODE_BODY, code_verifier: 'short' },
      { ...CODE_BODY, redirect_uri: 'https://evil.example/elsewhere/' },
      { ...CODE_BODY, redirect_uri: `${ORIGIN}${CALLBACK_PATH}?x=1` },
      { ...CODE_BODY, redirect_uri: `http://${HOST}${CALLBACK_PATH}` },
      { grant: 'refresh', refresh_token: 'bad token' },
    ];
    for (const body of bad) expect((await handleTokenRequest(req(body), ENV, fetch)).status).toBe(400);
    expect((await handleTokenRequest(req('x'.repeat(5000)), ENV, fetch)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps GitHub errors to codes the Studio turns into sentences', async () => {
    const cases: [string, number, string][] = [
      ['bad_verification_code', 400, 'bad_code'],
      ['bad_refresh_token', 401, 'bad_refresh_token'],
      ['redirect_uri_mismatch', 400, 'redirect_uri_mismatch'],
      ['incorrect_client_credentials', 503, 'misconfigured'],
      ['unverified_user_email', 400, 'failed'],
    ];
    for (const [gh, status, error] of cases) {
      const res = await handleTokenRequest(req(CODE_BODY), ENV, github({ error: gh, error_description: 'x' }));
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ error });
    }
  });

  it('answers 502 when GitHub is down or says nothing useful, and never echoes the secret', async () => {
    const down = vi.fn<FetchLike>(async () => {
      throw new TypeError('network');
    });
    expect((await handleTokenRequest(req(CODE_BODY), ENV, down)).status).toBe(502);
    expect((await handleTokenRequest(req(CODE_BODY), ENV, github({}, 500))).status).toBe(502);
    const empty = await handleTokenRequest(req(CODE_BODY), ENV, github({ token_type: 'bearer' }));
    expect(empty.status).toBe(502);
    expect(await empty.text()).not.toContain(ENV.GITHUB_APP_CLIENT_SECRET);
  });

  it('does not log anything', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await handleTokenRequest(req(CODE_BODY), ENV, github({ access_token: 'ghu_abc' }));
    await handleTokenRequest(req(CODE_BODY), ENV, github({ error: 'bad_verification_code' }));
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});

describe('origin and redirect checks', () => {
  it('accepts the same host only, https or a local server', () => {
    expect(sameOrigin(req({}))).toBe(true);
    expect(sameOrigin(req({}, { 'x-forwarded-host': 'other.example' }))).toBe(false);
    const local = new Request('http://localhost:4321/api/github/token', { method: 'POST', headers: { host: 'localhost:4321', origin: 'http://localhost:4321' } });
    expect(sameOrigin(local)).toBe(true);
  });

  it('accepts only the Studio callback path', () => {
    expect(validRedirectUri(`${ORIGIN}${CALLBACK_PATH}`)).toBe(true);
    expect(validRedirectUri(`http://localhost:4321${CALLBACK_PATH}`)).toBe(true);
    expect(validRedirectUri(`${ORIGIN}/studio/`)).toBe(false);
    expect(validRedirectUri(`https://user:pw@${HOST}${CALLBACK_PATH}`)).toBe(false);
    expect(validRedirectUri(42)).toBe(false);
  });
});
