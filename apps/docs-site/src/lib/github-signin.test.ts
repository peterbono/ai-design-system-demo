import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authorizeUrl,
  base64url,
  callbackStep,
  CALLBACK_PATH,
  callbackUrl,
  canRefresh,
  decodeState,
  encodeState,
  exchangeErrorText,
  DIRECT_APP_SLUG,
  installationFor,
  needsDirectApp,
  needsRefresh,
  noReachText,
  originAllowed,
  type PendingSignIn,
  pickSignInApp,
  pkceChallenge,
  planSlots,
  randomString,
  readOnlyText,
  refreshDelay,
  REFRESH_MARGIN_MS,
  safeReturnTo,
  sessionFrom,
  SIGNIN_TEXT,
  signInConfigFrom,
  slotKey,
} from './github-signin';
import { CALLBACK_PATH as SERVER_CALLBACK_PATH } from '../../api/github/token';

const PROD = 'https://bridge.example.com';
const PREVIEWS = { apps: { docs: 'https://bridge-docs-git-{branch}-acme.vercel.app' }, production: { docs: `${PROD}/` } };
const cfg = signInConfigFrom({ GITHUB_APP_CLIENT_ID: 'Iv23liAbCdEf' }, PREVIEWS)!;
const NONCE = 'n'.repeat(32);

describe('sign-in config', () => {
  it('is off without a client ID, or with a malformed one', () => {
    expect(signInConfigFrom({}, PREVIEWS)).toBeNull();
    expect(signInConfigFrom({ GITHUB_APP_CLIENT_ID: '  ' }, PREVIEWS)).toBeNull();
    expect(signInConfigFrom({ GITHUB_APP_CLIENT_ID: 'bad id<script>' }, PREVIEWS)).toBeNull();
  });

  it('reads the production origin and the preview pattern from bridge.config.json previews', () => {
    expect(cfg).toEqual({ clientId: 'Iv23liAbCdEf', app: 'direct', suggestApp: 'direct', productionOrigin: PROD, previewPattern: 'https://bridge-docs-git-{branch}-acme.vercel.app' });
    expect(signInConfigFrom({ GITHUB_APP_CLIENT_ID: 'Iv23liAbCdEf' }, null)).toEqual({
      clientId: 'Iv23liAbCdEf',
      app: 'direct',
      suggestApp: 'direct',
      productionOrigin: null,
      previewPattern: null,
    });
  });

  it('signs in with the read-only Bridge app for identity, and with Bridge Direct only to write in direct mode', () => {
    const both = { GITHUB_APP_CLIENT_ID: 'Iv23liDirect', GITHUB_APP_SUGGEST_CLIENT_ID: 'Iv23liSuggest' };
    expect(pickSignInApp(both)).toEqual({ clientId: 'Iv23liSuggest', app: 'suggest' });
    expect(pickSignInApp(both, 'suggest')).toEqual({ clientId: 'Iv23liSuggest', app: 'suggest' });
    // Identity first, whatever the repository's mode (plan 3.2).
    expect(pickSignInApp(both, 'direct')).toEqual({ clientId: 'Iv23liSuggest', app: 'suggest' });
    expect(pickSignInApp(both, 'direct', 'identity')).toEqual({ clientId: 'Iv23liSuggest', app: 'suggest' });
    // Direct when a write needs it, and only in direct mode.
    expect(pickSignInApp(both, 'direct', 'write')).toEqual({ clientId: 'Iv23liDirect', app: 'direct' });
    expect(pickSignInApp(both, 'suggest', 'write')).toEqual({ clientId: 'Iv23liSuggest', app: 'suggest' });
    // The self-hosted site (one repository) keeps signing in with Direct in direct mode.
    expect(signInConfigFrom(both, PREVIEWS, 'suggest')).toMatchObject({ clientId: 'Iv23liSuggest', app: 'suggest' });
    expect(signInConfigFrom(both, PREVIEWS, 'direct')).toMatchObject({ clientId: 'Iv23liDirect', app: 'direct', productionOrigin: PROD });
    // Settings needs the app suggest mode would use, whatever the mode in force today.
    expect(signInConfigFrom(both, PREVIEWS, 'direct')?.suggestApp).toBe('suggest');
    expect(signInConfigFrom({ GITHUB_APP_CLIENT_ID: 'Iv23liDirect' }, PREVIEWS, 'direct')?.suggestApp).toBe('direct');
  });

  it('falls back to the one configured app', () => {
    // Without the suggest app the site signs in as it always did, whatever the mode.
    expect(pickSignInApp({ GITHUB_APP_CLIENT_ID: 'Iv23liDirect' }, 'suggest')).toEqual({ clientId: 'Iv23liDirect', app: 'direct' });
    // Direct mode without a Direct app: the read-only app still signs people in.
    expect(pickSignInApp({ GITHUB_APP_SUGGEST_CLIENT_ID: 'Iv23liSuggest' }, 'direct', 'write')).toEqual({ clientId: 'Iv23liSuggest', app: 'suggest' });
    expect(pickSignInApp({ GITHUB_APP_CLIENT_ID: 'Iv23liDirect', GITHUB_APP_SUGGEST_CLIENT_ID: 'bad id' })).toEqual({ clientId: 'Iv23liDirect', app: 'direct' });
    expect(pickSignInApp({})).toBeNull();
  });

  it('signs team pages in with Bridge and carries Bridge Direct for the one-time OK (PR 3d)', () => {
    const both = { GITHUB_APP_CLIENT_ID: 'Iv23liDirect', GITHUB_APP_SUGGEST_CLIENT_ID: 'Iv23liSuggest' };
    // Whatever the build's own mode: a team's mode is only known in the browser.
    for (const changes of ['direct', 'suggest', undefined]) {
      expect(signInConfigFrom(both, PREVIEWS, changes, { hosted: true })).toMatchObject({
        clientId: 'Iv23liSuggest',
        app: 'suggest',
        direct: { clientId: 'Iv23liDirect', slug: DIRECT_APP_SLUG },
      });
    }
    expect(signInConfigFrom({ ...both, GITHUB_APP_DIRECT_SLUG: 'acme-bridge-direct' }, PREVIEWS, 'direct', { hosted: true })?.direct?.slug).toBe('acme-bridge-direct');
    expect(signInConfigFrom({ ...both, GITHUB_APP_DIRECT_SLUG: 'bad slug/<x>' }, PREVIEWS, 'direct', { hosted: true })?.direct?.slug).toBe(DIRECT_APP_SLUG);
    // One app only: nothing to ask for on top (that app is the sign-in).
    expect(signInConfigFrom({ GITHUB_APP_CLIENT_ID: 'Iv23liDirect' }, PREVIEWS, 'direct', { hosted: true })).toMatchObject({ app: 'direct' });
    expect(signInConfigFrom({ GITHUB_APP_CLIENT_ID: 'Iv23liDirect' }, PREVIEWS, 'direct', { hosted: true })?.direct).toBeUndefined();
    expect(signInConfigFrom({ GITHUB_APP_SUGGEST_CLIENT_ID: 'Iv23liSuggest' }, PREVIEWS, 'direct', { hosted: true })?.direct).toBeUndefined();
    // The self-hosted site is unchanged: no Direct entry, Direct up front in direct mode.
    expect(signInConfigFrom(both, PREVIEWS, 'direct')).not.toHaveProperty('direct');
    expect(signInConfigFrom(both, PREVIEWS, 'direct')).toEqual(signInConfigFrom(both, PREVIEWS, 'direct', { hosted: false }));
  });

  it('keeps the server and the browser on the same callback path', () => {
    expect(SERVER_CALLBACK_PATH).toBe(CALLBACK_PATH);
  });
});

describe('PKCE and state', () => {
  it('encodes base64url without padding', () => {
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(base64url(new Uint8Array([1]))).toBe('AQ');
  });

  it('makes a 43-character verifier from 32 random bytes', () => {
    const v = randomString(32, (a) => a.fill(7));
    expect(v).toHaveLength(43);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('computes the S256 challenge of RFC 7636 appendix B', async () => {
    const sha256 = async (d: Uint8Array) => {
      const h = createHash('sha256').update(d).digest();
      return h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength) as ArrayBuffer;
    };
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', sha256)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('carries the starting origin in the state, and refuses anything malformed', () => {
    const s = encodeState(NONCE, 'http://localhost:4321');
    expect(decodeState(s)).toEqual({ nonce: NONCE, origin: 'http://localhost:4321' });
    expect(decodeState('short.aHR0cHM6Ly9h')).toBeNull();
    expect(decodeState(`${NONCE}.${base64url(new TextEncoder().encode('https://a.com/path'))}`)).toBeNull();
    expect(decodeState(`${NONCE}.!!`)).toBeNull();
    expect(decodeState(null)).toBeNull();
  });

  it('builds the authorize URL with S256 and no sign-up', () => {
    const u = new URL(authorizeUrl({ clientId: 'Iv1', redirectUri: `${PROD}${CALLBACK_PATH}`, state: 's', challenge: 'c' }));
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'Iv1',
      redirect_uri: `${PROD}${CALLBACK_PATH}`,
      state: 's',
      code_challenge: 'c',
      code_challenge_method: 'S256',
      allow_signup: 'false',
    });
  });
});

describe('origins and callback', () => {
  it('uses the one registered production callback from every origin', () => {
    expect(callbackUrl('https://bridge-docs-git-x-acme.vercel.app', cfg)).toBe(`${PROD}${CALLBACK_PATH}`);
    expect(callbackUrl('http://localhost:4321', { productionOrigin: null })).toBe(`http://localhost:4321${CALLBACK_PATH}`);
  });

  it('forwards only to production, docs previews of this project and local servers', () => {
    expect(originAllowed(PROD, cfg)).toBe(true);
    expect(originAllowed('https://bridge-docs-git-agent-sign-in-acme.vercel.app', cfg)).toBe(true);
    expect(originAllowed('http://localhost:4321', cfg)).toBe(true);
    expect(originAllowed('http://127.0.0.1:8080', cfg)).toBe(true);
    expect(originAllowed('https://evil.example', cfg)).toBe(false);
    expect(originAllowed('https://bridge-docs-git-x-acme.vercel.app.evil.example', cfg)).toBe(false);
    expect(originAllowed('https://bridge-docs-git-x.y-acme.vercel.app', cfg)).toBe(false);
    expect(originAllowed('http://bridge.example.com', cfg)).toBe(false);
    expect(originAllowed('http://localhost.evil.example', cfg)).toBe(false);
    expect(originAllowed('not a url', cfg)).toBe(false);
  });

  it('comes back only to a same-site path, never to the callback itself', () => {
    expect(safeReturnTo('/studio/changes/?pr=3#top')).toBe('/studio/changes/?pr=3#top');
    expect(safeReturnTo('//evil.example/')).toBe('/studio/');
    expect(safeReturnTo('https://evil.example/')).toBe('/studio/');
    expect(safeReturnTo('/\\evil')).toBe('/studio/');
    expect(safeReturnTo(CALLBACK_PATH)).toBe('/studio/');
    expect(safeReturnTo(null)).toBe('/studio/');
  });
});

describe('callback step', () => {
  const here = PROD;
  const now = 1_000_000;
  const state = encodeState(NONCE, here);
  const pending: PendingSignIn = { state, verifier: 'v'.repeat(43), redirectUri: `${PROD}${CALLBACK_PATH}`, returnTo: '/studio/settings/', at: now - 1000 };
  const q = (o: Record<string, string>) => new URLSearchParams(o);

  it('trades the code when the state matches the sign-in this tab started', () => {
    expect(callbackStep(q({ code: 'abc123def456', state }), here, pending, cfg, now)).toEqual({
      kind: 'exchange',
      code: 'abc123def456',
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
      returnTo: '/studio/settings/',
    });
  });

  it('trades the code for the app the tab asked for, and only a well-formed one', () => {
    const asked = { ...pending, app: 'direct' as const, clientId: 'Iv23liDirect' };
    expect(callbackStep(q({ code: 'abc123def456', state }), here, asked, cfg, now)).toMatchObject({ kind: 'exchange', app: 'direct', clientId: 'Iv23liDirect' });
    const bad = callbackStep(q({ code: 'abc123def456', state }), here, { ...asked, clientId: 'x y<' }, cfg, now);
    expect(bad).toMatchObject({ kind: 'exchange' });
    expect(bad).not.toHaveProperty('app');
    expect(bad).not.toHaveProperty('clientId');
    const odd = callbackStep(q({ code: 'abc123def456', state }), here, { ...asked, app: 'admin' as unknown as 'direct' }, cfg, now);
    expect(odd).not.toHaveProperty('app');
  });

  it('forwards a preview sign-in to the preview, with the code and state only', () => {
    const preview = 'https://bridge-docs-git-feat-acme.vercel.app';
    const s = encodeState(NONCE, preview);
    const step = callbackStep(q({ code: 'abc123def456', state: s, extra: 'x' }), here, null, cfg, now);
    expect(step.kind).toBe('relay');
    const u = new URL((step as { url: string }).url);
    expect(u.origin).toBe(preview);
    expect(u.pathname).toBe(CALLBACK_PATH);
    expect(Object.fromEntries(u.searchParams)).toEqual({ code: 'abc123def456', state: s });
  });

  it('never forwards to an origin it does not know', () => {
    const s = encodeState(NONCE, 'https://evil.example');
    expect(callbackStep(q({ code: 'abc123def456', state: s }), here, null, cfg, now)).toEqual({ kind: 'error', message: SIGNIN_TEXT.unknownOrigin, returnTo: '/studio/' });
  });

  it('says what happened when the sign-in cannot finish', () => {
    expect(callbackStep(q({ error: 'access_denied', state }), here, pending, cfg, now)).toMatchObject({ kind: 'error', message: SIGNIN_TEXT.denied, returnTo: '/studio/settings/' });
    expect(callbackStep(q({ code: 'abc123def456', state }), here, null, cfg, now)).toMatchObject({ message: SIGNIN_TEXT.stale });
    expect(callbackStep(q({ code: 'abc123def456', state: encodeState('m'.repeat(32), here) }), here, pending, cfg, now)).toMatchObject({ message: SIGNIN_TEXT.stale });
    expect(callbackStep(q({ code: 'abc123def456', state }), here, { ...pending, at: now - 11 * 60 * 1000 }, cfg, now)).toMatchObject({ message: SIGNIN_TEXT.slow });
    expect(callbackStep(q({ state }), here, pending, cfg, now)).toMatchObject({ message: SIGNIN_TEXT.noCode });
    expect(callbackStep(q({ error: 'redirect_uri_mismatch', state }), here, pending, cfg, now)).toMatchObject({ message: SIGNIN_TEXT.redirectMismatch });
    expect(callbackStep(q({ error: 'application_suspended', state }), here, pending, cfg, now)).toMatchObject({ message: SIGNIN_TEXT.failed });
  });
});

describe('session and refresh', () => {
  const now = 10_000_000;
  const s = sessionFrom({ access_token: 'ghu_x', expires_in: 28800, refresh_token: 'ghr_y', refresh_token_expires_in: 15811200 }, now);

  it('keeps the expiry and the refresh token, never the access token', () => {
    expect(s).toEqual({ kind: 'app', expiresAt: now + 28800 * 1000, refreshToken: 'ghr_y', refreshExpiresAt: now + 15811200 * 1000 });
    expect(JSON.stringify(s)).not.toContain('ghu_x');
    expect(sessionFrom({ access_token: 'ghu_x' }, now)).toEqual({ kind: 'app', expiresAt: null, refreshToken: null, refreshExpiresAt: null });
    expect(sessionFrom({ access_token: 'ghu_x' }, now, 'Iv23liSuggest')).toMatchObject({ clientId: 'Iv23liSuggest' });
  });

  it('refreshes within the margin before expiry, and only with a valid refresh token', () => {
    expect(needsRefresh(s, now)).toBe(false);
    expect(needsRefresh(s, s.expiresAt! - REFRESH_MARGIN_MS + 1)).toBe(true);
    expect(needsRefresh(s, s.expiresAt! + 1)).toBe(true);
    expect(needsRefresh({ ...s, refreshExpiresAt: now - 1 }, s.expiresAt!)).toBe(false);
    expect(canRefresh({ ...s, refreshToken: null }, now)).toBe(false);
    expect(needsRefresh(null, now)).toBe(false);
  });

  it('schedules the refresh five minutes before expiry', () => {
    expect(refreshDelay(s, now)).toBe(28800 * 1000 - REFRESH_MARGIN_MS);
    expect(refreshDelay(s, s.expiresAt! + 5)).toBe(0);
    expect(refreshDelay({ ...s, expiresAt: null }, now)).toBeNull();
  });

  it('turns the token function errors into sentences that say how to fix them', () => {
    expect(exchangeErrorText(503, 'not_configured')).toBe(SIGNIN_TEXT.notConfigured);
    expect(exchangeErrorText(503, 'misconfigured')).toBe(SIGNIN_TEXT.misconfigured);
    expect(exchangeErrorText(400, 'bad_code')).toBe(SIGNIN_TEXT.badCode);
    expect(exchangeErrorText(401, 'bad_refresh_token')).toBe(SIGNIN_TEXT.expired);
    expect(exchangeErrorText(400, 'redirect_uri_mismatch')).toBe(SIGNIN_TEXT.redirectMismatch);
    expect(exchangeErrorText(0)).toBe(SIGNIN_TEXT.unreachable);
    expect(exchangeErrorText(500)).toBe(SIGNIN_TEXT.failed);
  });
});

describe('repository reach', () => {
  it('finds the installation on the owner, all or selected repositories', () => {
    expect(installationFor([{ id: 1, account: { login: 'Acme' }, repository_selection: 'all' }], 'acme')).toEqual({ reach: 'yes' });
    expect(installationFor([{ id: 2, account: { login: 'acme' }, repository_selection: 'selected' }], 'acme')).toEqual({ reach: 'check', id: 2 });
    expect(installationFor([{ id: 3, account: { login: 'other' } }], 'acme')).toEqual({ reach: 'no' });
    expect(installationFor([], 'acme')).toEqual({ reach: 'no' });
  });

  it('says how to fix a wrong account or a missing install', () => {
    expect(noReachText('ana', 'acme/ds')).toMatch(/^@ana cannot edit acme\/ds through Bridge\. Ask the repository owner .* or sign out and sign in with another GitHub account\.$/);
    expect(readOnlyText('ana', 'acme/ds', true)).toMatch(/Ask an owner for write access/);
    expect(readOnlyText('ana', 'acme/ds', false)).toMatch(/This token can read but not write/);
  });

  it('never uses an em dash', () => {
    for (const t of [...Object.values(SIGNIN_TEXT), noReachText('a', 'b/c'), readOnlyText('a', 'b/c', true)]) expect(t).not.toMatch(/\u2014/);
  });
});

describe('token slots per app', () => {
  const signIn = (clientId?: string) => ({ token: true, session: clientId ? { clientId } : {} });
  const pasted = { token: true, session: null };

  it('suffixes storage keys with the app', () => {
    expect(slotKey('bridge.github.token', 'suggest')).toBe('bridge.github.token.suggest');
    expect(slotKey('bridge.github.token', 'direct')).toBe('bridge.github.token.direct');
    expect(slotKey('bridge.github.token', '')).toBe('bridge.github.token');
  });

  it('leaves a browser alone when its token is already in the current slot', () => {
    expect(planSlots({ suggest: signIn('Iv23liSuggest') }, 'suggest', 'Iv23liSuggest')).toEqual({ move: null, clear: [], switched: false });
    expect(planSlots({}, 'suggest', 'Iv23liSuggest')).toEqual({ move: null, clear: [], switched: false });
  });

  it('keeps an old one-app sign-in when the site still signs in with that app (direct)', () => {
    expect(planSlots({ '': signIn() }, 'direct', 'Iv23liDirect')).toEqual({ move: '', clear: [], switched: false });
    expect(planSlots({ '': signIn('Iv23liDirect') }, 'direct', 'Iv23liDirect')).toEqual({ move: '', clear: [], switched: false });
  });

  it('removes an old one-app sign-in on a suggest page and asks to sign in again', () => {
    expect(planSlots({ '': signIn() }, 'suggest', 'Iv23liSuggest')).toEqual({ move: null, clear: [''], switched: true });
  });

  it("keeps the other app's sign-in: token slots are global, one repository's mode never clears them", () => {
    // The current slot is empty: say why the visitor looks signed out, but keep the other app's token for its pages.
    expect(planSlots({ direct: signIn('Iv23liDirect') }, 'suggest', 'Iv23liSuggest')).toEqual({ move: null, clear: [], switched: true });
    expect(planSlots({ suggest: signIn('Iv23liSuggest') }, 'direct', 'Iv23liDirect')).toEqual({ move: null, clear: [], switched: true });
    // Signed in with both apps: nothing to do on either page.
    const both = { suggest: signIn('Iv23liSuggest'), direct: signIn('Iv23liDirect') };
    expect(planSlots(both, 'suggest', 'Iv23liSuggest')).toEqual({ move: null, clear: [], switched: false });
    expect(planSlots(both, 'direct', 'Iv23liDirect')).toEqual({ move: null, clear: [], switched: false });
    // A pasted token kept in the other app's slot stays there too.
    expect(planSlots({ suggest: signIn('Iv23liSuggest'), direct: pasted }, 'suggest', 'Iv23liSuggest')).toEqual({ move: null, clear: [], switched: false });
  });

  it('removes the current sign-in when the app behind it was replaced', () => {
    expect(planSlots({ suggest: signIn('Iv23liOld') }, 'suggest', 'Iv23liSuggest')).toEqual({ move: null, clear: ['suggest'], switched: true });
    expect(planSlots({ '': signIn('Iv23liOld') }, 'direct', 'Iv23liDirect')).toEqual({ move: null, clear: [''], switched: true });
  });

  it('moves a pasted token, which belongs to no app, into an empty current slot', () => {
    expect(planSlots({ '': pasted }, 'suggest', 'Iv23liSuggest')).toEqual({ move: '', clear: [], switched: false });
    expect(planSlots({ '': pasted, suggest: signIn('Iv23liSuggest') }, 'suggest', 'Iv23liSuggest')).toEqual({ move: null, clear: [''], switched: false });
  });

  it('never prompts for a sign-in on a site without a GitHub App', () => {
    expect(planSlots({ direct: signIn('Iv23liDirect') }, '', null)).toEqual({ move: null, clear: ['direct'], switched: false });
    expect(planSlots({ suggest: pasted }, '', null)).toEqual({ move: 'suggest', clear: [], switched: false });
  });
});

describe('code writes that need Bridge Direct on a team page', () => {
  const api = 'https://api.github.com';
  it('sends branches, saves, merges, reviews and ready for review with Bridge Direct', () => {
    expect(needsDirectApp('POST', `${api}/repos/acme/ds/git/refs`)).toBe(true);
    expect(needsDirectApp('PATCH', `${api}/repos/acme/ds/git/refs/heads/bridge/x`)).toBe(true);
    expect(needsDirectApp('PUT', `${api}/repos/acme/ds/contents/tokens/a.json`)).toBe(true);
    expect(needsDirectApp('PUT', `${api}/repos/acme/ds/pulls/3/merge`)).toBe(true);
    expect(needsDirectApp('POST', `${api}/repos/acme/ds/pulls/3/reviews`)).toBe(true);
    expect(needsDirectApp('POST', `${api}/repos/acme/ds/merges`)).toBe(true);
    expect(needsDirectApp('POST', `${api}/graphql`)).toBe(true);
    expect(needsDirectApp('post', '/repos/acme/ds/pulls')).toBe(true);
  });

  it('keeps reads, suggestions and comments on Bridge', () => {
    expect(needsDirectApp('GET', `${api}/repos/acme/ds/git/refs`)).toBe(false);
    expect(needsDirectApp(undefined, `${api}/repos/acme/ds/pulls`)).toBe(false);
    expect(needsDirectApp('HEAD', `${api}/repos/acme/ds`)).toBe(false);
    expect(needsDirectApp('POST', `${api}/repos/acme/ds/issues`)).toBe(false);
    expect(needsDirectApp('POST', `${api}/repos/acme/ds/issues/4/comments`)).toBe(false);
    expect(needsDirectApp('PATCH', `${api}/repos/acme/ds/issues/comments/9`)).toBe(false);
    expect(needsDirectApp('POST', `${api}/repos/acme/ds/issues/4/labels`)).toBe(false);
    expect(needsDirectApp('POST', '/api/github/token')).toBe(false);
    expect(needsDirectApp('PATCH', `${api}/user`)).toBe(false);
  });
});
