import { describe, expect, it } from 'vitest';
import { overviewProtectionLine, PROTECT_ADMIN_ONLY, protectionRow, type ProtectionRowState } from './protection-view';

const RULES = 'https://github.com/acme/ds/settings/rules';
const ALL = ['review', 'checks', 'history', 'deletion'] as const;

describe('protectionRow', () => {
  it('protected: a quiet line and a link to the rule, no action', () => {
    const v = protectionRow({ kind: 'protected', missing: [], url: 'https://github.com/acme/ds/rules/1' }, RULES);
    expect(v.text).toBe('Protected: every change goes through review.');
    expect(v.action).toBeUndefined();
    expect(v.link).toEqual({ label: 'Open on GitHub', href: 'https://github.com/acme/ds/rules/1' });
    expect(protectionRow({ kind: 'protected', missing: [] }, RULES).link?.href).toBe(RULES);
  });

  it('unprotected and partial: one action on the row', () => {
    expect(protectionRow({ kind: 'unprotected', missing: [...ALL] }, RULES)).toEqual({ text: 'Your library can be changed without review.', action: 'Protect the library' });
    const p = protectionRow({ kind: 'partial', missing: ['checks'] }, RULES);
    expect(p.action).toBe('Complete protection');
    expect(p.text).toBe('Partly protected: checks do not have to pass.');
  });

  it('unknown, no token and loading: one quiet line, no action', () => {
    for (const kind of ['unknown', 'no-token', 'loading'] as const) {
      const v = protectionRow(kind === 'unknown' ? { kind, missing: [...ALL] } : { kind }, RULES);
      expect(v.action).toBeUndefined();
      expect(v.link).toBeUndefined();
      expect(v.text.length).toBeGreaterThan(10);
    }
  });

  it('no token: the way in follows the site', () => {
    expect(protectionRow({ kind: 'no-token' }, RULES).text).toBe('Connect GitHub to see whether every change goes through review.');
    expect(protectionRow({ kind: 'no-token' }, RULES, true).text).toBe('Sign in to see whether every change goes through review.');
  });

  it('designer words on the row: no ruleset, branch or force push, no em dash', () => {
    const states: ProtectionRowState[] = [
      { kind: 'protected', missing: [] },
      { kind: 'unprotected', missing: [...ALL] },
      { kind: 'partial', missing: ['review', 'history', 'deletion'] },
      { kind: 'unknown', missing: [...ALL] },
      { kind: 'no-token' },
      { kind: 'loading' },
    ];
    for (const s of states) expect(protectionRow(s, RULES).text).not.toMatch(/ruleset|branch|force push|\u2014/i);
  });
});

describe('overviewProtectionLine', () => {
  it('owners only, unprotected only', () => {
    expect(overviewProtectionLine({ kind: 'unprotected', missing: [...ALL] }, true)).toBe('Your library can be changed without review. Protect it in Settings.');
    expect(overviewProtectionLine({ kind: 'unprotected', missing: [...ALL] }, false)).toBeNull();
    expect(overviewProtectionLine({ kind: 'partial', missing: ['checks'] }, true)).toBeNull();
    expect(overviewProtectionLine({ kind: 'unknown', missing: [...ALL] }, true)).toBeNull();
  });
});

describe('protectionRow for someone who is not a GitHub admin', () => {
  it('offers no action they would be refused, and says who can', () => {
    expect(protectionRow({ kind: 'unprotected', missing: [...ALL] }, RULES, false, false)).toEqual({ text: `Your library can be changed without review. ${PROTECT_ADMIN_ONLY}` });
    expect(protectionRow({ kind: 'partial', missing: ['checks'] }, RULES, false, false).action).toBeUndefined();
    expect(protectionRow({ kind: 'unprotected', missing: [...ALL] }, RULES, false, true).action).toBe('Protect the library');
    expect(protectionRow({ kind: 'unprotected', missing: [...ALL] }, RULES, false, null).action).toBe('Protect the library');
    expect(PROTECT_ADMIN_ONLY).toBe('Only a GitHub admin of the library can turn this on.');
  });
  it('the unknown line says what it cannot see in designer words', () => {
    expect(protectionRow({ kind: 'unknown', missing: [...ALL] }, RULES).text).not.toMatch(/\b(merge|main)\b/);
  });
});
