// @vitest-environment jsdom
// Arm, keep, take (scripts/pending-action.ts): the action armed right before a save goes to GitHub with a sign-in,
// comes back once on the same page, and an old or unrelated one never resumes anything.
import { beforeEach, describe, expect, it } from 'vitest';
import { ARMED_MAX_AGE_MS, PENDING_ACTION_KEY, PENDING_ACTION_MAX_AGE_MS } from '../lib/pending-action';
import { armPendingAction, clearPendingAction, disarmPendingAction, forgetAction, keepAction, keepPendingAction, keptActionUrl, peekPendingAction, takePendingAction } from './pending-action';

const NOW = 1_800_000_000_000;

beforeEach(() => {
  localStorage.clear();
  disarmPendingAction();
  history.replaceState(null, '', '/studio/t/acme/ds/');
});

describe('pending action across a trip to GitHub', () => {
  it('keeps the armed action with the page and the time, never a token', () => {
    armPendingAction('new-product', { name: 'Atlas', owner: 'art-print-shop-co', copy: true, token: 'ghu_secret' }, NOW);
    expect(keepPendingAction(NOW + 5000)).toBe(true);
    const raw = localStorage.getItem(PENDING_ACTION_KEY)!;
    expect(raw).not.toMatch(/ghu_secret/);
    expect(JSON.parse(raw)).toEqual({ kind: 'new-product', values: { name: 'Atlas', owner: 'art-print-shop-co', copy: true }, url: '/studio/t/acme/ds/', at: NOW + 5000 });
  });

  it('a plain sign-in keeps nothing: nothing armed, armed long before, or the save went through', () => {
    expect(keepPendingAction(NOW)).toBe(false);
    armPendingAction('rename-product', { key: 'shop', to: 'Atlas' }, NOW);
    expect(keepPendingAction(NOW + ARMED_MAX_AGE_MS + 1)).toBe(false);
    armPendingAction('retry', { label: 'send the new team name' }, NOW);
    disarmPendingAction();
    expect(keepPendingAction(NOW)).toBe(false);
    expect(localStorage.getItem(PENDING_ACTION_KEY)).toBeNull();
  });

  it('is taken once, by its own kind, on its own page', () => {
    armPendingAction('start-exploration', { sentence: 'Softer buttons', target: 'library' }, NOW);
    keepPendingAction(NOW);
    expect(takePendingAction('new-product', NOW)).toBeNull();
    expect(takePendingAction('start-exploration', NOW, localStorage, '/studio/t/acme/ds/settings/')).toBeNull();
    expect(takePendingAction('start-exploration', NOW)).toMatchObject({ values: { sentence: 'Softer buttons', target: 'library' } });
    expect(takePendingAction('start-exploration', NOW)).toBeNull();
  });

  it('Install on GitHub keeps the step at once; GitHub\'s access page finds the way back; closing forgets it', () => {
    expect(keepAction('add-product', {}, NOW)).toBe(true);
    expect(keptActionUrl(NOW)).toBe('/studio/t/acme/ds/');
    // Another kind is left alone.
    forgetAction('new-product', NOW);
    expect(keptActionUrl(NOW)).toBe('/studio/t/acme/ds/');
    forgetAction('add-product', NOW);
    expect(keptActionUrl(NOW)).toBeNull();
  });

  it('expires after 15 minutes and is dropped', () => {
    keepAction('new-product', { name: 'Atlas' }, NOW);
    expect(peekPendingAction(NOW + PENDING_ACTION_MAX_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem(PENDING_ACTION_KEY)).toBeNull();
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
    armPendingAction('new-product', { name: 'Atlas' }, NOW);
    expect(keepPendingAction(NOW, blocked)).toBe(false);
    expect(peekPendingAction(NOW, blocked)).toBeNull();
    expect(keptActionUrl(NOW, blocked)).toBeNull();
    expect(() => clearPendingAction(blocked)).not.toThrow();
  });
});
