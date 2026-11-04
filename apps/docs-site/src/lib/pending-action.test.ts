// What someone was doing when Bridge sent them to GitHub and back (lib/pending-action.ts): kept small, never a
// credential, dropped after 15 minutes, only for the page it came from, and the line in Bridge's words.
import { describe, expect, it } from 'vitest';
import { GitHubError } from '@bridge-ds/core';
import { cleanValues, makePendingAction, onPage, parsePendingAction, PENDING_ACTION_MAX_AGE_MS, resumeLine, SIGN_IN_TO_FINISH, signInNeededLine } from './pending-action';

const NOW = 1_800_000_000_000;

describe('pending action', () => {
  it('keeps plain values only, never anything that looks like a credential', () => {
    expect(cleanValues({ name: 'Atlas', copy: true, n: 2, gone: null, token: 'ghu_x', accessToken: 'x', verifier: 'v', nested: { a: 1 }, fn: () => 1, nan: Number.NaN })).toEqual({
      name: 'Atlas',
      copy: true,
      n: 2,
      gone: null,
    });
    expect(cleanValues({ long: 'a'.repeat(5000) }).long).toHaveLength(2000);
  });

  it('round-trips through storage, then expires after 15 minutes', () => {
    const a = makePendingAction('new-product', { name: 'Atlas', owner: 'art-print-shop-co', copy: true }, '/studio/t/acme/ds/', NOW)!;
    const raw = JSON.stringify(a);
    expect(parsePendingAction(raw, NOW + 1000)).toEqual(a);
    expect(parsePendingAction(raw, NOW + PENDING_ACTION_MAX_AGE_MS)).toEqual(a);
    expect(parsePendingAction(raw, NOW + PENDING_ACTION_MAX_AGE_MS + 1)).toBeNull();
  });

  it('drops broken, unknown, other-site or future ones', () => {
    expect(parsePendingAction(null, NOW)).toBeNull();
    expect(parsePendingAction('{', NOW)).toBeNull();
    expect(parsePendingAction(JSON.stringify({ kind: 'delete-everything', values: {}, url: '/', at: NOW }), NOW)).toBeNull();
    expect(parsePendingAction(JSON.stringify({ kind: 'retry', values: {}, url: 'https://evil.example/', at: NOW }), NOW)).toBeNull();
    expect(parsePendingAction(JSON.stringify({ kind: 'retry', values: {}, url: '//evil.example/', at: NOW }), NOW)).toBeNull();
    expect(parsePendingAction(JSON.stringify({ kind: 'retry', values: {}, url: '/', at: NOW + 3_600_000 }), NOW)).toBeNull();
    expect(makePendingAction('retry', {}, 'https://evil.example/', NOW)).toBeNull();
  });

  it('belongs to the page it was kept on (the hash and a trailing slash do not count)', () => {
    const a = { url: '/studio/t/acme/ds/?view=explorations#top' };
    expect(onPage(a, '/studio/t/acme/ds?view=explorations')).toBe(true);
    expect(onPage(a, '/studio/t/acme/ds/')).toBe(false);
    expect(onPage({ url: '/studio/t/acme/ds/' }, '/studio/t/acme/ds/settings/')).toBe(false);
  });

  it('says what happens next in Bridge words, or to sign in again without a sign-in', () => {
    expect(resumeLine({ kind: 'new-product', values: { name: 'Atlas' } }, true)).toBe('Back from GitHub. Create Atlas now?');
    expect(resumeLine({ kind: 'add-product', values: { name: 'Shop' } }, true)).toBe('Back from GitHub. Add Shop now?');
    expect(resumeLine({ kind: 'add-product', values: {} }, true)).toBe('Back from GitHub. Pick your product to add it.');
    expect(resumeLine({ kind: 'start-exploration', values: {} }, true)).toBe('Back from GitHub. Start this exploration now?');
    expect(resumeLine({ kind: 'rename-product', values: { to: 'Atlas' } }, true)).toBe('Back from GitHub. Rename it to Atlas now?');
    expect(resumeLine({ kind: 'remove-product', values: { name: 'Shop' } }, true)).toBe('Back from GitHub. Remove Shop from Bridge now?');
    expect(resumeLine({ kind: 'new-brand', values: { name: 'Ocean' } }, true)).toBe('Back from GitHub. Send Ocean for review now?');
    expect(resumeLine({ kind: 'retry', values: { label: 'send the new team name' } }, true)).toBe('Back from GitHub. You can send the new team name now.');
    expect(resumeLine({ kind: 'retry', values: {} }, true)).toMatch(/^Back from GitHub\. /);
    for (const kind of ['new-product', 'retry'] as const) expect(resumeLine({ kind, values: { name: 'Atlas' } }, false)).toBe(SIGN_IN_TO_FINISH);
    const all = (['new-product', 'add-product', 'start-exploration', 'rename-product', 'remove-product', 'new-brand', 'retry'] as const).map((kind) => resumeLine({ kind, values: {} }, true));
    for (const line of [...all, SIGN_IN_TO_FINISH]) expect(line).not.toMatch(/\u2014|token|OAuth|install|permission/i);
  });

  it('says to sign in again when that fixes it, never "Ask an owner", and nothing for any other error', () => {
    const expired = new GitHubError(401, 'Bad credentials', 'Bad credentials', { auth: 'rejected' });
    expect(signInNeededLine(expired, { kind: 'rejected', text: 'Your GitHub sign-in expired. Sign in again to keep editing.' })).toBe('Your GitHub sign-in expired. Sign in again to keep editing.');
    expect(signInNeededLine(new GitHubError(401, 'Sign in with GitHub first.', 'no-token'), null)).toBe('Sign in with GitHub first.');
    // A real refusal (no access) keeps its own words.
    expect(signInNeededLine(new GitHubError(403, 'Forbidden'), { kind: 'missing-permission', text: 'x' })).toBeNull();
    expect(signInNeededLine(new Error('boom'), null)).toBeNull();
    expect(signInNeededLine(null, null)).toBeNull();
  });
});
