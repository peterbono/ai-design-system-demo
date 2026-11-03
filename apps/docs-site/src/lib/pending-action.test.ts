// What someone was doing when Bridge sent them to GitHub for Bridge Direct's OK (lib/pending-action.ts): kept small,
// never a credential, dropped after 15 minutes, only for the page it came from, and the line in Bridge's words.
import { describe, expect, it } from 'vitest';
import { DIRECT_CONSENT } from './gh-wording';
import { cleanValues, directWaitLine, makePendingAction, onPage, parsePendingAction, PENDING_ACTION_MAX_AGE_MS, resumeLine } from './pending-action';

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

  it('says what happens next in Bridge words, or the usual line without the OK', () => {
    expect(resumeLine({ kind: 'new-product', values: { name: 'Atlas' } }, true)).toBe('GitHub gave the OK. Create Atlas now?');
    expect(resumeLine({ kind: 'add-product', values: { name: 'Shop' } }, true)).toBe('GitHub gave the OK. Add Shop now?');
    expect(resumeLine({ kind: 'start-exploration', values: {} }, true)).toBe('GitHub gave the OK. Start this exploration now?');
    expect(resumeLine({ kind: 'rename-product', values: { to: 'Atlas' } }, true)).toBe('GitHub gave the OK. Rename it to Atlas now?');
    expect(resumeLine({ kind: 'remove-product', values: { name: 'Shop' } }, true)).toBe('GitHub gave the OK. Remove Shop from Bridge now?');
    expect(resumeLine({ kind: 'new-brand', values: { name: 'Ocean' } }, true)).toBe('GitHub gave the OK. Send Ocean for review now?');
    expect(resumeLine({ kind: 'retry', values: { label: 'send the new team name' } }, true)).toBe('GitHub gave the OK. You can send the new team name now.');
    expect(resumeLine({ kind: 'retry', values: {} }, true)).toMatch(/^GitHub gave the OK\. /);
    for (const kind of ['new-product', 'retry'] as const) expect(resumeLine({ kind, values: { name: 'Atlas' } }, false)).toBe(DIRECT_CONSENT.needed);
    const all = (['new-product', 'add-product', 'start-exploration', 'rename-product', 'remove-product', 'new-brand', 'retry'] as const).map((kind) => resumeLine({ kind, values: {} }, true));
    for (const line of all) expect(line).not.toMatch(/—/);
  });

  it('reads the line of a write that waits for Bridge Direct, and nothing else', () => {
    expect(directWaitLine({ detail: 'direct-consent', message: DIRECT_CONSENT.needed })).toBe(DIRECT_CONSENT.needed);
    expect(directWaitLine({ detail: 'direct-not-installed', message: 'Saving changes is not set up for this team yet.' })).toMatch(/not set up/);
    expect(directWaitLine(new Error('boom'))).toBeNull();
    expect(directWaitLine(null)).toBeNull();
  });
});
