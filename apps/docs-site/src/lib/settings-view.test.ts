// Studio Settings: approvals in plain words and the Claude connect command.
import { describe, expect, it } from 'vitest';
import { tierSummaries } from './governance';
import { accountView, appReach, approvalRules, changesInConfig, changesProposal, effectiveChanges, INTERIM_APP_TEXT, overrideText, READ_ONLY_APP_TEXT, soloOwnerRow, suggestAppText, plainApprovals, ruleSentence, withChanges } from './settings-view';

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

describe('account', () => {
  const repo = 'acme/ds';
  it('shows a compact row once connected, with the access as a badge and a quiet action', () => {
    expect(accountView('connected', { login: 'ana', write: true, repo })).toEqual({
      zone: false,
      title: 'Connected as @ana',
      detail: 'acme/ds',
      action: 'Reconnect GitHub',
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

  it('offers only Sign in with GitHub when the site has a GitHub App, never a token paste', () => {
    expect(accountView('readonly', { write: null, repo, signIn: true })).toEqual({
      zone: true,
      title: 'Sign in with GitHub to approve and request reviews.',
      detail: 'Until then Studio only reads acme/ds.',
      action: 'Sign in with GitHub',
      actionKind: 'signin',
    });
    expect(accountView('readonly', { write: null, repo })).toMatchObject({ actionKind: 'token' });
    expect(accountView('rejected', { write: null, repo, signIn: true })).toMatchObject({ action: 'Sign in with GitHub', actionKind: 'signin' });
    expect(accountView('rejected', { write: null, repo, signIn: true }).detail).not.toMatch(/token instead|paste/i);
    // A token pasted before the site had a GitHub App: it can only be disconnected, not changed.
    expect(accountView('connected', { login: 'ana', write: true, repo, signIn: true })).toMatchObject({ action: 'Disconnect', actionKind: 'signout' });
    expect(accountView('connected', { login: 'ana', write: true, repo })).toMatchObject({ action: 'Reconnect GitHub', actionKind: 'token' });
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

describe('only owner', () => {
  it('shows the line only when the rule is on and one person holds both roles', () => {
    const owners = { design: ['peterbono'], tech: ['peterbono'] };
    expect(soloOwnerRow({ owners, rights: null, soloOwnerCanApproveBoth: true })).toEqual({ label: 'Only owner', help: 'A design system run by one person.', value: 'As the only owner, @peterbono approves design and code in one review.' });
    expect(soloOwnerRow({ owners, rights: null, soloOwnerCanApproveBoth: false })).toBeNull();
    expect(soloOwnerRow({ owners: { design: ['dana'], tech: ['theo'] }, rights: null, soloOwnerCanApproveBoth: true })).toBeNull();
  });
});

describe('owner override', () => {
  it('names who may merge past missing approvals, and the reason rule', () => {
    expect(overrideText({ allowed: ['ana', 'bo'], requireReason: true, minReasonLength: 20 })).toEqual({
      on: true,
      text: '@ana, @bo may merge a branch when only approvals are missing, with a written reason of 20 characters or more.',
    });
    expect(overrideText({ allowed: ['ana'], requireReason: false }).text).toBe('@ana may merge a branch when only approvals are missing.');
  });

  it('says what happens when nobody may override', () => {
    expect(overrideText({ allowed: [] })).toEqual({ on: false, text: 'Every branch waits for its approvals before it is merged.' });
  });
});

describe('how changes reach your code', () => {
  const FILE = '{\n  "$schema": "./schema.json",\n  "version": 1,\n  "repo": { "owner": "acme", "name": "ds" }\n}\n';

  it('reads the mode from the file, suggestions when it is absent', () => {
    expect(changesInConfig({ changes: 'direct' })).toBe('direct');
    expect(changesInConfig({ changes: 'nope' })).toBeNull();
    expect(changesInConfig({})).toBeNull();
    expect(effectiveChanges(null)).toBe('suggest');
  });

  it('adds `changes` after version and keeps everything else byte for byte', () => {
    const next = withChanges(FILE, 'suggest');
    expect(next).toBe('{\n  "$schema": "./schema.json",\n  "version": 1,\n  "changes": "suggest",\n  "repo": { "owner": "acme", "name": "ds" }\n}\n');
    expect(withChanges(next, 'direct')).toBe(next.replace('"suggest"', '"direct"'));
    expect(withChanges(next, 'suggest')).toBe(next);
  });

  it('says what the GitHub App may do on the repo', () => {
    expect(appReach({ contents: 'write', pull_requests: 'write', issues: 'write' })).toEqual({ writesCode: true, text: 'Can write code, open pull requests and create issues on this repo.' });
    expect(appReach({ contents: 'read', issues: 'write' })).toEqual({ writesCode: false, text: 'Can read code and create issues on this repo.' });
  });

  it('proposes the switch as a configuration pull request, saying plainly what the app can still do', () => {
    const p = changesProposal('suggest', { date: new Date('2026-10-21T10:00:00Z'), prefix: 'bridge/', tierLabel: 'Tier 3', suggestApp: 'direct' });
    expect(p.branch).toBe('bridge/changes-suggest-20261021');
    expect(p.body).toContain('Sets `changes` to `"suggest"`');
    expect(p.body).toContain(INTERIM_APP_TEXT);
    expect(changesProposal('direct', { date: new Date(), tierLabel: 'Tier 3', suggestApp: 'direct' }).body).not.toContain(INTERIM_APP_TEXT);
    const both = changesProposal('suggest', { date: new Date(), tierLabel: 'Tier 3', suggestApp: 'suggest' }).body;
    expect(both).toContain(READ_ONLY_APP_TEXT);
    expect(both).not.toContain(INTERIM_APP_TEXT);
    const none = changesProposal('suggest', { date: new Date(), tierLabel: 'Tier 3' }).body;
    expect(none).not.toContain(INTERIM_APP_TEXT);
    expect(none).not.toContain(READ_ONLY_APP_TEXT);
    expect(INTERIM_APP_TEXT).toBe("Bridge's GitHub App can still write code on this repo. Suggest mode is a Bridge rule until the read-only app ships.");
  });

  it('says suggest mode is a Bridge rule only while Studio signs in with the write app', () => {
    // Only the Direct app configured: suggest mode runs on an app that can write code.
    expect(suggestAppText('direct')).toBe(INTERIM_APP_TEXT);
    // Both apps: Studio signs in with the read-only one in suggest mode.
    expect(suggestAppText('suggest')).toBe(READ_ONLY_APP_TEXT);
    expect(READ_ONLY_APP_TEXT).not.toMatch(/still write|until the read-only app ships/);
    // No GitHub App (a pasted token): nothing to say about an app.
    expect(suggestAppText(null)).toBeNull();
    expect(suggestAppText(undefined)).toBeNull();
  });
});
