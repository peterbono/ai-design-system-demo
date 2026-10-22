// The browser side of /api/invites: it carries the sign-in, never fakes success, and turns a site without the invites
// server (404, an HTML page, 503 not_configured) into the one "not available yet" sentence. Also the people the email
// field suggests from commits, and the invitation token read from the address fragment.
import { afterEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ token: 'ghu_test' as string | null }));
vi.mock('./github-session', () => ({ getToken: () => session.token }));

import { acceptInvite, InvitesError, InvitesUnavailable, listInvites, sendInvites, setInvitesFetch } from './invites-api';
import { peopleFromCommits } from './members';
import { tokenFromHash } from '../components/ds/studio/InviteAccept';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  setInvitesFetch(null);
  session.token = 'ghu_test';
});

describe('invites api', () => {
  it('sends the sign-in and the role, and returns the results', async () => {
    const f = vi.fn(async () => json(200, { results: [{ email: 'a@b.co', status: 'sent' }] }));
    setInvitesFetch(f);
    expect(await sendInvites('acme/ds', { role: 'reviewer', reviewAs: 'tech' }, [{ email: 'a@b.co' }])).toEqual([{ email: 'a@b.co', status: 'sent' }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/invites');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghu_test');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'invite', repo: 'acme/ds', role: 'reviewer', reviewAs: 'tech', people: [{ email: 'a@b.co' }] });
  });

  it('says invites are not available when the site has no server or it is not set up', async () => {
    for (const res of [new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), json(404, {}), json(503, { error: 'not_configured', message: 'x' })]) {
      setInvitesFetch(async () => res);
      await expect(listInvites('acme/ds')).rejects.toBeInstanceOf(InvitesUnavailable);
    }
  });

  it("passes the server's sentence through on a refusal, and asks to sign in without a token", async () => {
    setInvitesFetch(async () => json(403, { error: 'not_admin', message: 'Only admins of acme/ds can invite people.' }));
    await expect(acceptInvite('t'.repeat(43))).rejects.toMatchObject({ message: 'Only admins of acme/ds can invite people.', status: 403 });
    session.token = null;
    const f = vi.fn();
    setInvitesFetch(f);
    await expect(listInvites('acme/ds')).rejects.toBeInstanceOf(InvitesError);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('caps and the invited email', () => {
  it('turns a 429 into a sentence, never silent, with the server words or the default', async () => {
    setInvitesFetch(async () => json(429, { error: 'limit', message: "This team reached today's invite limit. Try again tomorrow.", limit: 'team' }));
    await expect(sendInvites('acme/ds', { role: 'view' }, [{ email: 'a@b.co' }])).rejects.toMatchObject({ status: 429, code: 'limit', message: "This team reached today's invite limit. Try again tomorrow.", details: { limit: 'team' } });
    setInvitesFetch(async () => json(429, {}));
    await expect(sendInvites('acme/ds', { role: 'view' }, [{ email: 'a@b.co' }])).rejects.toMatchObject({ status: 429, message: "You reached today's invite limit. Try again tomorrow." });
  });

  it('carries the masked address and the account when an invite is for another email', async () => {
    setInvitesFetch(async () => json(403, { error: 'email_mismatch', message: 'x', sentTo: 'm\u2022\u2022\u2022@acme.design', login: 'leo' }));
    await expect(acceptInvite('t'.repeat(43))).rejects.toMatchObject({ code: 'email_mismatch', details: { sentTo: 'm\u2022\u2022\u2022@acme.design', login: 'leo' } });
  });
});

describe('people the email field suggests', () => {
  it('keeps one entry per real email, never GitHub relays or bots', () => {
    const people = peopleFromCommits([
      { author: { login: 'ann' }, commit: { author: { name: 'Ann Lind', email: 'Ann@Acme.design' } } },
      { author: { login: 'ann' }, commit: { author: { name: 'Ann Lind', email: 'ann@acme.design' } } },
      { author: { login: 'leo' }, commit: { author: { name: 'Leo', email: '123+leo@users.noreply.github.com' } } },
      { author: { login: 'renovate[bot]' }, commit: { author: { name: 'renovate', email: 'bot@renovateapp.com' } } },
      { author: null, commit: { author: { name: 'Sam', email: 'sam@acme.design' } } },
    ]);
    expect(people).toEqual([
      { name: 'Ann Lind', email: 'ann@acme.design', login: 'ann' },
      { name: 'Sam', email: 'sam@acme.design' },
    ]);
  });
});

describe('the invitation link', () => {
  it('reads the token from the fragment only', () => {
    const t = 'A'.repeat(43);
    expect(tokenFromHash(`#t=${t}`)).toBe(t);
    expect(tokenFromHash(`#x=1&t=${t}`)).toBe(t);
    expect(tokenFromHash('#t=short')).toBeNull();
    expect(tokenFromHash('#t=<script>')).toBeNull();
    expect(tokenFromHash('')).toBeNull();
  });
});
