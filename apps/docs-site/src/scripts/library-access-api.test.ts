import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./github-session', () => ({ getToken: () => 'ghu_dana' }));

import { AccessError, AccessUnavailable, libraryAccess, readLibraryFile, requestSignIn, saveLibraryAccess, setAccessFetch, verifySignIn } from './library-access-api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => setAccessFetch(null));

describe('the browser side of /api/library-access', () => {
  it('reads a team once per page, and asks again when told to', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json(200, { available: true, setting: { mode: 'email', domains: ['acme.design'], source: 'github' }, session: null }));
    setAccessFetch(f);
    expect(await libraryAccess('acme/ds')).toEqual({ available: true, setting: { mode: 'email', domains: ['acme.design'], source: 'github' }, session: null });
    await libraryAccess('ACME/ds');
    expect(f).toHaveBeenCalledTimes(1);
    await libraryAccess('acme/ds', true);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0]![0]).toBe('/api/library-access?repo=acme%2Fds');
  });

  it('reads "not available" from a site without the server, a static page, an error or no network: the Library opens as before', async () => {
    for (const r of [new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), json(404, {}), json(503, { error: 'not_configured' }), json(500, { message: 'x' })]) {
      setAccessFetch(async () => r);
      expect(await libraryAccess('acme/ds')).toEqual({ available: false, setting: null, session: null });
    }
    setAccessFetch(async () => Promise.reject(new Error('offline')));
    expect(await libraryAccess('acme/ds')).toEqual({ available: false, setting: null, session: null });
  });

  it('never trusts a malformed answer', async () => {
    setAccessFetch(async () => json(200, { available: true, setting: { mode: 'everyone', domains: 'x' }, session: { domain: 1 } }));
    expect(await libraryAccess('acme/ds')).toEqual({ available: true, setting: null, session: null });
  });

  it('saves with the GitHub sign-in, and says the server sentence when refused', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => (JSON.parse(String(init?.body)).mode === 'team' ? json(403, { error: 'forbidden', message: 'Only admins can change who reads the library.' }) : json(200, { setting: { mode: 'anyone', domains: [] } })));
    setAccessFetch(f);
    expect(await saveLibraryAccess('acme/ds', 'anyone', [])).toEqual({ mode: 'anyone', domains: [] });
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer ghu_dana');
    await expect(saveLibraryAccess('acme/ds', 'team', [])).rejects.toMatchObject({ name: 'AccessError', status: 403, message: 'Only admins can change who reads the library.' });
  });

  it('sends the sign-in without any GitHub token, and maps not configured to AccessUnavailable', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json(200, { sent: true }));
    setAccessFetch(f);
    await requestSignIn('acme/ds', 'mia@acme.design');
    expect(f.mock.calls[0]![1]!.headers).not.toHaveProperty('Authorization');
    setAccessFetch(async () => json(503, { error: 'not_configured', message: 'x' }));
    await expect(requestSignIn('acme/ds', 'mia@acme.design')).rejects.toBeInstanceOf(AccessUnavailable);
    setAccessFetch(async () => json(429, { error: 'limit', message: 'Too many sign-in links were asked from this network today. Try again tomorrow.' }));
    await expect(requestSignIn('acme/ds', 'mia@acme.design')).rejects.toBeInstanceOf(AccessError);
  });

  it('spends a link and forgets the cached answer, so the session reads back', async () => {
    let n = 0;
    setAccessFetch(async (_u, init) => (init?.method === 'POST' ? json(200, { ok: true, session: { domain: 'acme.design' } }) : json(200, { available: true, setting: null, session: n++ ? { domain: 'acme.design' } : null })));
    expect((await libraryAccess('acme/ds')).session).toBeNull();
    expect(await verifySignIn('acme/ds', 't'.repeat(43))).toEqual({ domain: 'acme.design' });
    expect((await libraryAccess('acme/ds')).session).toEqual({ domain: 'acme.design' });
  });

  it("reads a private Library's file, or rejects with the server's sentence, marked as this site's", async () => {
    setAccessFetch(async () => new Response('{"version":1}', { status: 200 }));
    expect(await readLibraryFile('acme/ds', 'snapshot')).toBe('{"version":1}');
    setAccessFetch(async () => json(404, { error: 'not_published', message: 'This library is not published yet.' }));
    await expect(readLibraryFile('acme/ds', 'snapshot')).rejects.toMatchObject({ status: 404, source: 'bridge', message: 'This library is not published yet.' });
  });
});
