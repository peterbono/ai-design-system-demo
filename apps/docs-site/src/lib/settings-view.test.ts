// Studio Settings: approvals in plain words and the Claude connect command.
import { describe, expect, it } from 'vitest';
import { tierSummaries } from './governance';
import { accountView, approvalRules, mcpAddCommand, overrideText, plainApprovals, ruleSentence } from './settings-view';

const GOVERNANCE = `# Governance

## Risk tiers

| Tier | Examples | PR state | Required approvals | Changeset |
| ---- | -------- | -------- | ------------------ | --------- |
| 1, low | Docs, story fixes, a11y fixes with no visual change | Ready for review | 1 code owner | none |
| 2, medium | New component, new variant or prop, visual tweak using existing tokens | Draft | Design owner + tech owner | \`minor\` |
| 3, high | Token added, changed, renamed or removed; breaking prop change | Draft | Design owner **and** tech owner, mandatory | \`minor\` |

## Review gates
`;

describe('approval rules', () => {
  it('turns the governance tiers into plain rules, riskiest first, without tier numbers', () => {
    const rules = approvalRules(tierSummaries(GOVERNANCE));
    expect(rules.map(ruleSentence)).toEqual([
      'Token changes: design owner + tech owner.',
      'New component or variant: design owner + tech owner.',
      'Docs fixes: one owner.',
    ]);
    expect(rules.map(ruleSentence).join(' ')).not.toMatch(/tier/i);
  });

  it('falls back to the governance example when a kind has no plain name', () => {
    expect(approvalRules([{ tier: 2, approvals: '2 code owners', example: 'Icon swaps' }])).toEqual([{ tier: 2, what: 'Icon swaps', who: 'two owners' }]);
  });

  it('reads markdown emphasis and conjunctions as plain text', () => {
    expect(plainApprovals('Design owner **and** tech owner, mandatory')).toBe('design owner + tech owner');
    expect(plainApprovals('1 code owner')).toBe('one owner');
    expect(plainApprovals('Design owner + tech owner')).toBe('design owner + tech owner');
  });

  it('reads the real docs/GOVERNANCE.md', () => {
    const rules = approvalRules(tierSummaries());
    expect(rules).toHaveLength(3);
    expect(rules[0]!.what).toBe('Token changes');
  });
});

describe('connect your Claude', () => {
  it('builds the one command for the repository and never fills the token in', () => {
    expect(mcpAddCommand('acme/ds')).toBe('claude mcp add bridge -s user -e GITHUB_TOKEN=<your token> -- npx -y @bridge-ds/mcp --repo acme/ds');
    expect(mcpAddCommand('acme/ds')).not.toMatch(/gh[pousr]_|github_pat_/);
  });
});

describe('account', () => {
  const repo = 'acme/ds';
  it('shows a compact row once connected, with the access as a badge and a quiet action', () => {
    expect(accountView('connected', { login: 'ana', write: true, repo })).toEqual({
      zone: false,
      title: 'Connected as @ana',
      detail: 'acme/ds',
      action: 'Change token',
      actionKind: 'token',
      badge: { label: 'Can edit', tone: 'success' },
    });
    expect(accountView('connected', { login: 'ana', write: false, repo }).badge).toEqual({ label: 'Read only', tone: 'neutral' });
    expect(accountView('connected', { login: 'ana', write: null, repo }).badge).toBeUndefined();
  });

  it('opens the Harbor zone with the primary action only when Studio cannot act', () => {
    expect(accountView('readonly', { write: null, repo })).toMatchObject({ zone: true, action: 'Connect GitHub' });
    expect(accountView('rejected', { write: null, repo })).toMatchObject({ zone: true, action: 'Reconnect GitHub' });
    expect(accountView('checking', { write: null, repo })).toEqual({ zone: false, title: 'Checking your GitHub connection.' });
  });

  it('leads with Sign in with GitHub when the site has a GitHub App, the token paste staying a quiet second way', () => {
    expect(accountView('readonly', { write: null, repo, signIn: true })).toEqual({
      zone: true,
      title: 'Sign in with GitHub to approve and send changes.',
      detail: 'Until then Studio only reads acme/ds.',
      action: 'Sign in with GitHub',
      actionKind: 'signin',
      secondary: 'Use a token instead',
    });
    expect(accountView('readonly', { write: null, repo })).toMatchObject({ actionKind: 'token' });
    expect(accountView('readonly', { write: null, repo }).secondary).toBeUndefined();
    expect(accountView('rejected', { write: null, repo, signIn: true })).toMatchObject({ action: 'Sign in with GitHub', actionKind: 'signin', secondary: 'Use a token instead' });
  });

  it('signs out a signed-in account, and says so when its sign-in expired', () => {
    expect(accountView('connected', { login: 'ana', write: true, repo, mode: 'app', signIn: true })).toMatchObject({ action: 'Sign out', actionKind: 'signout', detail: 'acme/ds' });
    expect(accountView('rejected', { write: null, repo, mode: 'app', signIn: true })).toEqual({
      zone: true,
      title: 'Your GitHub sign-in expired.',
      detail: 'Studio could not renew it. Sign in again to keep editing.',
      action: 'Sign in again',
      actionKind: 'signin',
    });
  });

  it('tells a signed-in account without access how to fix it (wrong account, app not installed, read only)', () => {
    const none = accountView('connected', { login: 'ana', write: false, repo, mode: 'app', reach: false });
    expect(none.badge).toEqual({ label: 'No access', tone: 'neutral' });
    expect(none.detail).toMatch(/^@ana cannot edit acme\/ds through Bridge\..*sign in with another GitHub account\.$/);
    const read = accountView('connected', { login: 'ana', write: false, repo, mode: 'app', reach: true });
    expect(read.badge).toEqual({ label: 'Read only', tone: 'neutral' });
    expect(read.detail).toMatch(/Ask an owner for write access/);
  });

  it('never uses an em dash', () => {
    for (const s of ['checking', 'connected', 'readonly', 'rejected'] as const) {
      for (const extra of [{}, { signIn: true }, { mode: 'app' as const, signIn: true, reach: false }]) {
        expect(JSON.stringify(accountView(s, { login: 'a', write: false, repo, ...extra }))).not.toContain('\u2014');
      }
    }
  });
});

describe('owner override', () => {
  it('names who may ship past missing approvals, and the reason rule', () => {
    expect(overrideText({ allowed: ['ana', 'bo'], requireReason: true, minReasonLength: 20 })).toEqual({
      on: true,
      text: '@ana, @bo may ship a change when only approvals are missing, with a written reason of 20 characters or more.',
    });
    expect(overrideText({ allowed: ['ana'], requireReason: false }).text).toBe('@ana may ship a change when only approvals are missing.');
  });

  it('says what happens when nobody may override', () => {
    expect(overrideText({ allowed: [] })).toEqual({ on: false, text: 'Every change waits for its approvals before it ships.' });
  });
});
