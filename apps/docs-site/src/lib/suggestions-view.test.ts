import { describe, expect, it } from 'vitest';
import type { SuggestionApprovals, SuggestionPayloadV1 } from '@bridge-ds/core';
import {
  applyLines,
  approvalRows,
  approveLabel,
  declineAudience,
  kindLabel,
  missingRoles,
  modeOfFile,
  proofChips,
  reviewedLine,
  shortTitle,
  staleLines,
  statusBadge,
  suggestionGate,
  suggestionHref,
  suggestionKey,
  suggestionNeed,
  suggestionOfKey,
  suggestionQueueKind,
  suggestionThumb,
  SUGGESTION_WORDS,
  tokenRows,
  viewerRoles,
  waitsOnViewer,
} from './suggestions-view';
import { queueBuckets } from './review-queue';
import { jargonIn } from './vocabulary';
import { person } from './home-model';

const owners = { design: ['dana'], tech: ['theo'] };

const approvals = (x: Partial<SuggestionApprovals> = {}): SuggestionApprovals => ({ approvers: [], changesRequested: [], design: false, tech: false, stale: [], ignored: [], ...x });

const payload = (x: Partial<SuggestionPayloadV1> = {}): SuggestionPayloadV1 => ({
  schema: 'bridge.suggestion/1',
  kind: 'token-change',
  title: 'Tokens: darker default background',
  summary: 'Reads better on wide screens.',
  source: 'studio',
  createdAt: '2026-10-18T09:00:00Z',
  base: { ref: 'main', sha: 'abc' },
  tier: { tier: 3, bump: 'minor' },
  tokens: {
    edits: [],
    changes: [
      { kind: 'changed', path: 'color.bg.default', file: 'semantic/light.tokens.json', before: '{color.neutral.0}', after: '{color.neutral.50}', beforeCss: '#ffffff', afterCss: '#f5f7f9' },
      { kind: 'changed', path: 'color.bg.default', file: 'semantic/dark.tokens.json', before: '{color.neutral.0}', after: '{color.neutral.50}', beforeCss: '#ffffff', afterCss: '#f5f7f9' },
      { kind: 'added', path: 'color.bg.quiet', file: 'semantic/light.tokens.json', after: '#eef2f6', afterCss: '#eef2f6' },
    ],
  },
  checks: {
    newErrors: 0,
    contrast: [
      { pair: 'text.default on bg.default', mode: 'light', before: 15.2, after: 14.1, min: 4.5, pass: true },
      { pair: 'text.default on bg.default', mode: 'dark', before: 13, after: 12.4, min: 4.5, pass: true },
    ],
    blocked: null,
    impact: 14,
  },
  ...x,
});

describe('links and keys', () => {
  it('opens in Branches and keys the queue row', () => {
    expect(suggestionHref(42)).toBe('/studio/changes/?suggestion=42');
    expect(suggestionKey(42)).toBe('suggestion-42');
    expect(suggestionOfKey('suggestion-42')).toBe(42);
    expect(suggestionOfKey('change-42')).toBeNull();
    expect(suggestionOfKey(null)).toBeNull();
  });
});

describe('queue mapping', () => {
  it('maps a status onto the buckets the queue counts', () => {
    expect(suggestionQueueKind('needs-review', ['design', 'tech'])).toBe('needs-design');
    expect(suggestionQueueKind('needs-review', ['tech'])).toBe('needs-tech');
    expect(suggestionQueueKind('needs-review', [])).toBe('needs-approval');
    expect(suggestionQueueKind('changes-requested')).toBe('changes-requested');
    expect(suggestionQueueKind('outdated')).toBe('conflict');
    expect(suggestionQueueKind('approved')).toBe('ready-to-apply');
    expect(suggestionQueueKind('applying')).toBe('applying');
    expect(suggestionQueueKind('applied')).toBeNull();
    expect(suggestionQueueKind('declined')).toBeNull();
  });

  it('lands in one bucket of review-queue, the single source of the counts', () => {
    expect(queueBuckets([suggestionQueueKind('approved'), suggestionQueueKind('needs-review', ['design']), 'needs-design'])).toEqual([
      { bucket: 'design', n: 2 },
      { bucket: 'apply', n: 1 },
    ]);
  });
});

describe('who it waits on', () => {
  it('knows the roles of the viewer', () => {
    expect(viewerRoles('Dana', owners)).toEqual(['design', 'approval']);
    expect(viewerRoles('ann', owners)).toEqual([]);
    expect(viewerRoles(null, owners)).toEqual([]);
  });

  it('waits on an owner whose role is missing, never on the author or a done reviewer', () => {
    const base = { status: 'needs-review' as const, viewer: 'dana', author: 'ann', owners };
    expect(waitsOnViewer({ ...base, missing: ['design', 'tech'] })).toBe(true);
    expect(waitsOnViewer({ ...base, missing: ['tech'] })).toBe(false);
    expect(waitsOnViewer({ ...base, missing: [] })).toBe(true);
    expect(waitsOnViewer({ ...base, missing: ['design'], reviewed: true })).toBe(false);
    expect(waitsOnViewer({ ...base, missing: ['design'], author: 'Dana' })).toBe(false);
    expect(waitsOnViewer({ ...base, missing: ['design'], viewer: 'ann2' })).toBe(false);
    expect(waitsOnViewer({ ...base, missing: ['design'], status: 'approved' })).toBe(false);
  });

  it('once approved, waits on a developer (a tech owner) to apply it, never on a designer', () => {
    const base = { status: 'approved' as const, missing: [], author: 'ann', owners };
    const tech = owners.tech[0]!;
    expect(waitsOnViewer({ ...base, viewer: tech })).toBe(true);
    expect(waitsOnViewer({ ...base, viewer: 'dana' })).toBe(owners.tech.some((l) => l.toLowerCase() === 'dana'));
  });

  it('with no owner configured, waits on people who can edit the library', () => {
    const none = { design: [], tech: [] };
    expect(waitsOnViewer({ status: 'needs-review', missing: [], viewer: 'x', author: 'ann', owners: none, collaborator: true })).toBe(true);
    expect(waitsOnViewer({ status: 'needs-review', missing: [], viewer: 'x', author: 'ann', owners: none })).toBe(false);
  });

  it('builds the row Home and the queue show', () => {
    const row = suggestionNeed({ number: 42, title: 'Darker default background', createdAt: '2026-10-18T09:00:00Z' }, person('ann', 'Ann Leroy'), Date.parse('2026-10-21T09:00:00Z'));
    expect(row).toMatchObject({ key: 'suggestion-42', kind: 'review', href: '/studio/changes/?suggestion=42', line: 'Ann suggests a change', waitsOnYou: true, pill: { label: 'Waiting 3 days', tone: 'warning' } });
    expect(row.number).toBeUndefined();
  });

  it('counts the missing roles from the approvals on the current version', () => {
    expect(missingRoles(3, approvals({ design: true, approvers: ['dana'] }))).toEqual(['tech']);
    expect(missingRoles(1, approvals())).toEqual(['approval']);
    expect(missingRoles(3, undefined)).toEqual([]);
  });
});

describe('what changes', () => {
  it('reads one row per token and value, with the modes it changes in', () => {
    const rows = tokenRows(payload());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      path: 'color.bg.default',
      kind: 'changed',
      before: { alias: 'color.neutral.0', css: '#ffffff', hex: '#ffffff' },
      after: { alias: 'color.neutral.50', css: '#f5f7f9', hex: '#f5f7f9' },
      contexts: ['light', 'dark'],
    });
    expect(rows[1]).toMatchObject({ path: 'color.bg.quiet', kind: 'added', before: null, after: { alias: null, hex: '#eef2f6' } });
  });

  it('reads the mode from the file name', () => {
    expect(modeOfFile('semantic/light.tokens.json')).toBe('light');
    expect(modeOfFile('semantic/dark/color.tokens.json')).toBe('dark');
    expect(modeOfFile('primitives/color.tokens.json')).toBe('');
  });

  it('draws the main token as the thumbnail, docs as text', () => {
    expect(suggestionThumb(payload())).toMatchObject({ kind: 'color', token: 'color.bg.default' });
    expect(suggestionThumb(payload({ kind: 'docs', tokens: undefined }))).toEqual({ kind: 'text' });
  });

  it('says the kind and the title in Studio words', () => {
    expect(kindLabel('token-change')).toBe('Token change');
    expect(kindLabel(undefined)).toBe('Suggestion');
    expect(shortTitle('Tokens: darker default background')).toBe('Darker default background');
    expect(shortTitle('Button: docs for the danger tone')).toBe('Docs for the danger tone');
    expect(shortTitle('No subject here')).toBe('No subject here');
  });
});

describe('proof chips', () => {
  it('shows the three proofs when everything passes', () => {
    expect(proofChips(payload()).map((c) => [c.label, c.tone])).toEqual([
      ['Design system checks', 'success'],
      ['Contrast light and dark', 'success'],
      ['Used in 14 places', 'neutral'],
    ]);
  });

  it('names the theme of a brand and theme combo, never its key', () => {
    const p = payload();
    p.checks.contrast = p.checks.contrast.map((c) => ({ ...c, mode: 'brand=bridge,theme=light,density=comfortable' }));
    expect(proofChips(p)[1]!.label).toBe('Contrast light');
  });

  it('says what fails, and today wins over the checks recorded when suggested', () => {
    const p = payload();
    p.checks.contrast[1]!.pass = false;
    expect(proofChips(p)[1]).toMatchObject({ label: '1 contrast pair fails', tone: 'danger' });
    const today = proofChips(payload(), { newErrors: 2, newFailures: [{ pair: 'a on b' }, { pair: 'c on d' }] });
    expect(today[0]).toMatchObject({ label: '2 design system errors', tone: 'danger' });
    expect(today[1]).toMatchObject({ label: '2 contrast pairs fail', tone: 'danger' });
    expect(today[0]!.detail).toContain("today's main");
  });

  it('leaves contrast and usage out of a docs change', () => {
    expect(proofChips(payload({ kind: 'docs', checks: { newErrors: 0, contrast: [], blocked: null, impact: 0 } })).map((c) => c.key)).toEqual(['checks']);
  });
});

describe('stale', () => {
  it('says an approval for an older version no longer counts', () => {
    const [line] = staleLines({ stale: ['dana'], names: { dana: 'Dana' } });
    expect(line).toMatchObject({ tone: 'warning', title: 'Approved for an older version' });
    expect(line!.text).toContain('Dana approved it before it changed');
  });

  it('says when main moved under it, and when it still applies', () => {
    expect(staleLines({ stale: [], mainMoved: true, conflicts: [{ path: 'color.bg.default', detail: 'color.bg.default changed since it was suggested (now #eeeeee, suggested from #ffffff).' }] })[0]).toMatchObject({ tone: 'danger', title: 'Main changed since it was suggested' });
    expect(staleLines({ stale: [], mainMoved: true, conflicts: [] })[0]).toMatchObject({ tone: 'success', title: 'Still applies cleanly' });
    expect(staleLines({ stale: [], mainMoved: true })).toEqual([]);
  });
});

describe('the gate', () => {
  const base = { status: 'needs-review' as const, viewer: 'dana', author: 'ann', owners, tier: 3 as const, approvals: approvals(), signInLine: 'Sign in to review', names: { theo: 'Theo' } };

  it('tells the author of an approved suggestion there is nothing left for them', () => {
    expect(suggestionGate({ ...base, viewer: 'ann', status: 'approved' }).why).toBe('Approved. A developer applies it next: nothing more for you to do.');
    expect(suggestionGate({ ...base, viewer: 'ann' }).why).toMatch(/^You suggested it, so someone else approves it/);
  });

  it('lets an owner approve the part that is missing', () => {
    const g = suggestionGate(base);
    expect(g).toMatchObject({ canApprove: true, canRequestChanges: true, canDecline: true, role: 'design', covers: ['design'], why: null });
    expect(approveLabel(g, 3)).toBe('Approve for design');
    expect(approveLabel(g, 1)).toBe('Approve');
    // One person who holds both roles signs one part: never both alone (core summarizeApprovals).
    const both = suggestionGate({ ...base, owners: { design: ['dana'], tech: ['dana'] } });
    expect(both.covers).toEqual(['design']);
    expect(approveLabel(both, 3)).toBe('Approve for design');
    const solo = suggestionGate({ ...base, owners: { design: ['dana'], tech: ['dana'] }, approvals: approvals({ approvers: ['dana'], design: true }) });
    expect(solo.why).toBe('You approved this version. It waits for a tech approval from someone else.');
  });

  it('lets the only owner sign both parts when governance.soloOwnerCanApproveBoth is on', () => {
    const g = suggestionGate({ ...base, owners: { design: ['dana'], tech: ['dana'] }, soloOwner: 'dana' });
    expect(g).toMatchObject({ canApprove: true, covers: ['design', 'tech'], why: 'As the only owner, your approval covers design and code.' });
    expect(approveLabel(g, 3)).toBe('Approve');
    expect(suggestionGate({ ...base, owners: { design: ['dana'], tech: ['dana'] }, soloOwner: 'dana', viewer: 'ann' }).canApprove).toBe(false);
  });

  it('tells everyone else why', () => {
    expect(suggestionGate({ ...base, viewer: null }).why).toBe('Sign in to review.');
    expect(suggestionGate({ ...base, viewer: 'zoe' })).toMatchObject({ canApprove: false, canRequestChanges: false, canDecline: false, why: 'Only the design system owners approve suggestions: @dana or Theo.' });
    expect(suggestionGate({ ...base, viewer: 'ann' }).why).toContain('You suggested it');
    expect(suggestionGate({ ...base, status: 'applying' }).why).toBe('A developer is applying it. The review is done.');
    expect(suggestionGate({ ...base, status: 'declined' }).canDecline).toBe(false);
  });

  it('says when the viewer is done and who is still expected', () => {
    const g = suggestionGate({ ...base, approvals: approvals({ approvers: ['dana'], design: true }) });
    expect(g).toMatchObject({ canApprove: false, canRequestChanges: true, why: 'You approved this version. It waits for a tech approval from Theo.' });
    const other = suggestionGate({ ...base, viewer: 'dana', approvals: approvals({ approvers: ['dee'], design: true }) });
    expect(other.why).toBe('Your part is done. It waits for a tech approval from Theo.');
  });

  it('holds an outdated suggestion until it is sent again', () => {
    expect(suggestionGate({ ...base, status: 'outdated' })).toMatchObject({ canApprove: false, canRequestChanges: false, canDecline: true });
  });
});

describe('approvals and apply', () => {
  it('lists who approves, by role', () => {
    expect(approvalRows({ tier: 3, approvals: approvals({ approvers: ['dana'], design: true }), owners, names: { dana: 'Dana' } })).toEqual([
      { label: 'Design approval', state: 'approved', text: 'Approved by Dana' },
      { label: 'Tech approval', state: 'waiting', text: 'Waiting for @theo' },
    ]);
    expect(approvalRows({ tier: 1, approvals: approvals({ changesRequested: ['theo'] }), owners })[0]).toMatchObject({ label: 'One approval', state: 'changes' });
  });

  it('says how a developer applies it', () => {
    expect(applyLines(42)).toEqual([
      { label: 'In a terminal', value: 'npx bridge apply 42' },
      { label: 'With Claude', value: 'Apply Bridge suggestion #42' },
    ]);
  });
});

describe('words', () => {
  it('has no developer jargon and no em dash on Studio surfaces', () => {
    const lines = [
      ...Object.values(SUGGESTION_WORDS).map((w) => (typeof w === 'function' ? w('Ann') : w)),
      statusBadge('approved').label,
      statusBadge('applying').label,
      reviewedLine('approve', 'X', 'approved'),
      reviewedLine('request-changes', 'X'),
      reviewedLine('decline', 'X'),
      declineAudience('ann'),
      ...staleLines({ stale: ['dana'], mainMoved: true, conflicts: [] }).map((s) => `${s.title} ${s.text}`),
      ...proofChips(payload()).map((c) => `${c.label} ${c.detail}`),
      suggestionGate({ status: 'needs-review', viewer: 'zoe', author: 'ann', owners, tier: 3, approvals: approvals(), signInLine: '' }).why ?? '',
    ];
    for (const l of lines) {
      expect(jargonIn(l)).toEqual([]);
      expect(l).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
