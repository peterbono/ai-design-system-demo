// Studio Settings: approvals in plain words and the Claude connect command.
import { describe, expect, it } from 'vitest';
import { tierSummaries } from './governance';
import { adminOnlyText, appReach, CHANGES_PLAIN, RIGHT_PLAIN, TOKEN_VALUES_PLAIN, soloPlain, teamPlain, approvalRules, changesInConfig, changesProposal, effectiveChanges, INTERIM_APP_TEXT, overridePlain, overrideRow, READ_ONLY_APP_TEXT, soloOwnerRow, suggestAppText, plainApprovals, ruleSentence, withChanges } from './settings-view';

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

describe('only owner', () => {
  it('shows the line only when the rule is on and one person holds both roles', () => {
    const owners = { design: ['peterbono'], tech: ['peterbono'] };
    expect(soloOwnerRow({ owners, rights: null, soloOwnerCanApproveBoth: true })).toEqual({ label: 'Only owner', help: 'A design system run by one person.', value: 'As the only owner, peterbono checks the look and the code in one review.' });
    expect(soloOwnerRow({ owners, rights: null, soloOwnerCanApproveBoth: true }, () => 'Florian')?.value).toBe('As the only owner, Florian checks the look and the code in one review.');
    expect(soloOwnerRow({ owners, rights: null, soloOwnerCanApproveBoth: false })).toBeNull();
    expect(soloOwnerRow({ owners: { design: ['dana'], tech: ['theo'] }, rights: null, soloOwnerCanApproveBoth: true })).toBeNull();
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

describe('Settings, owner override row', () => {
  const override = { allowed: ['ann', 'lea'], requireReason: false, minReasonLength: 0 };
  it('names the owners who may use it, never someone who is not an owner, and the reason it always needs', () => {
    // Designer words and names, the same as the hosted team Settings: no merge, branch or @handle.
    expect(overrideRow({ owners: { design: ['ann'], tech: ['theo'] }, override })).toEqual({
      label: 'Exception',
      help: 'Adds a change before every check is in. Owners only.',
      value: 'ann, with a written reason of at least 20 characters.',
    });
    expect(overrideRow({ owners: { design: ['ann'], tech: ['theo'] }, override }, () => 'Dana')?.value).toMatch(/^Dana, /);
    expect(overrideRow({ owners: { design: ['theo'], tech: ['theo'] }, override })).toBeNull();
  });
});

describe('team Settings in designer words (D9)', () => {
  it('names who can change a setting, or says an admin can', () => {
    expect(adminOnlyText(['Sam Rivera'])).toBe('Only Sam Rivera (admin) can change this.');
    expect(adminOnlyText(['Sam Rivera', 'Lee Park', 'Sam Rivera'])).toBe('Only Sam Rivera or Lee Park (admins) can change this.');
    expect(adminOnlyText(['Ana', 'Lee', 'Sam'])).toBe('Only Ana, Lee or Sam (admins) can change this.');
    expect(adminOnlyText([])).toBe('Only an admin of this team can change this.');
  });

  it('says the modes and the rights without developer words', () => {
    const screen = [...Object.values(CHANGES_PLAIN).flatMap((c) => [c.title, c.text]), ...Object.values(RIGHT_PLAIN).flatMap((r) => [r.label, r.help]), soloPlain('Sam'), teamPlain('design-leads')];
    for (const text of screen) {
      expect(text).not.toMatch(/\b(repo|repository|pull request|branch|main|merge|commit|issue)\b/i);
      expect(text).not.toMatch(/@/);
      expect(text).not.toContain('\u2014');
    }
    expect(teamPlain('design-leads')).toBe('the design leads team');
  });

  it('says the owner exception without developer words', () => {
    expect(overridePlain(['Ann', 'Lea'], 20)).toEqual({ label: 'Exception', help: 'Adds a change before every check is in. Owners only.', value: 'Ann and Lea, with a written reason of at least 20 characters.' });
  });
});

describe('token values (docs/BUILD-REQUESTS.md "The rule", decision TV-1)', () => {
  it('ship once the look is approved and the checks pass, no code check; a rename or removal waits for one', () => {
    const w = TOKEN_VALUES_PLAIN;
    expect(w.label).toBe('Token values');
    expect(w.help).toMatch(/in Studio or send from Figma/);
    expect(w.title).toBe('Ship once the look is approved and the automatic checks pass.');
    expect(w.text).toBe('Nobody checks the code. From Figma, sending counts as the approval. A renamed or removed token waits for a code check.');
    // Designer words: no repository, pull request, branch or main, no em dash.
    for (const s of Object.values(w)) expect(s).not.toMatch(/\b(repo|repository|pull request|PR|branch|main|merge)\b|\u2014/i);
  });
});
