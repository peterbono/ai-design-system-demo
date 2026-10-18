import { describe, expect, it } from 'vitest';
import { overviewProtectionLine, protectionDetails, protectionRow, type ProtectionRowState } from './protection-view';

const RULES = 'https://github.com/acme/ds/settings/rules';
const ALL = ['review', 'checks', 'history', 'deletion'] as const;

describe('protectionRow', () => {
  it('protected: a quiet line and a link to the rule, no action', () => {
    const v = protectionRow({ kind: 'protected', missing: [], url: 'https://github.com/acme/ds/rules/1' }, RULES);
    expect(v.text).toBe('Protected: every change goes through review.');
    expect(v.action).toBeUndefined();
    expect(v.link).toEqual({ label: 'View on GitHub', href: 'https://github.com/acme/ds/rules/1' });
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

describe('protectionDetails', () => {
  it('names the ruleset, the rules and the checks for developers', () => {
    const d = protectionDetails('main', ['Guardrails', 'Docs site']).join('\n');
    expect(d).toContain('"Protect the library (main)"');
    expect(d).toContain('force pushes');
    expect(d).toContain('Guardrails, Docs site');
    expect(protectionDetails('main', []).join('\n')).toContain('Requires no status checks');
  });
});
