// @vitest-environment jsdom
// Arm, freeze, keep, take (scripts/pending-action.ts): the action armed right before the write goes to GitHub with the
// consent, comes back once on the same page, and an old or unrelated one never resumes anything.
import { beforeEach, describe, expect, it } from 'vitest';
import { PENDING_ACTION_KEY, PENDING_ACTION_MAX_AGE_MS } from '../lib/pending-action';
import { armPendingAction, clearPendingAction, disarmPendingAction, freezeArmed, keepPendingAction, peekPendingAction, takePendingAction } from './pending-action';

const NOW = 1_800_000_000_000;

beforeEach(() => {
  sessionStorage.clear();
  disarmPendingAction();
  history.replaceState(null, '', '/studio/t/acme/ds/');
});

describe('pending action across the consent', () => {
  it('keeps the armed action with the page and the time, never a token', () => {
    armPendingAction('new-product', { name: 'Atlas', owner: 'art-print-shop-co', copy: true, token: 'ghu_secret' }, NOW);
    freezeArmed(NOW + 2000);
    expect(keepPendingAction(NOW + 5000)).toBe(true);
    const raw = sessionStorage.getItem(PENDING_ACTION_KEY)!;
    expect(raw).not.toMatch(/ghu_secret/);
    expect(JSON.parse(raw)).toEqual({ kind: 'new-product', values: { name: 'Atlas', owner: 'art-print-shop-co', copy: true }, url: '/studio/t/acme/ds/', at: NOW + 5000 });
  });

  it('nothing armed, or armed long before the consent: a plain retry', () => {
    freezeArmed(NOW);
    keepPendingAction(NOW);
    expect(peekPendingAction(NOW)?.kind).toBe('retry');
    armPendingAction('rename-product', { key: 'shop', to: 'Atlas' }, NOW);
    freezeArmed(NOW + 5 * 60_000);
    keepPendingAction(NOW + 5 * 60_000);
    expect(peekPendingAction(NOW + 5 * 60_000)).toMatchObject({ kind: 'retry', values: {} });
  });

  it('is taken once, by its own kind, on its own page', () => {
    armPendingAction('start-exploration', { sentence: 'Softer buttons', target: 'library' }, NOW);
    freezeArmed(NOW);
    keepPendingAction(NOW);
    expect(takePendingAction('new-product', NOW)).toBeNull();
    expect(takePendingAction('start-exploration', NOW, sessionStorage, '/studio/t/acme/ds/settings/')).toBeNull();
    expect(takePendingAction('start-exploration', NOW)).toMatchObject({ values: { sentence: 'Softer buttons', target: 'library' } });
    expect(takePendingAction('start-exploration', NOW)).toBeNull();
  });

  it('expires after 15 minutes and is dropped', () => {
    armPendingAction('new-product', { name: 'Atlas' }, NOW);
    freezeArmed(NOW);
    keepPendingAction(NOW);
    expect(peekPendingAction(NOW + PENDING_ACTION_MAX_AGE_MS + 1)).toBeNull();
    expect(sessionStorage.getItem(PENDING_ACTION_KEY)).toBeNull();
  });

  it('works without storage (blocked): nothing kept, nothing thrown', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    freezeArmed(NOW);
    expect(keepPendingAction(NOW, blocked)).toBe(false);
    expect(peekPendingAction(NOW, blocked)).toBeNull();
    expect(() => clearPendingAction(blocked)).not.toThrow();
  });
});
