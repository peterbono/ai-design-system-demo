import { describe, expect, it } from 'vitest';
import type { DecisionKind } from '@bridge-ds/core';
import { addsLeadWords, handsOff, LEAD_KINDS } from '../../api/_lib/lead-gate';

const body = (e: Record<string, unknown>) => `Text\n\n<!-- bridge-exploration ${JSON.stringify({ name: 'Orders', ...e })} -->`;
const yes = { kind: 'looks-right', at: '2026-11-07T00:00:00Z', round: 1, by: 'flo' };
const team = { hasLeads: true };

describe('what only a lead writes in a block', () => {
  it('a designer answering, asking or taking it back passes', () => {
    const asked = body({ leadAskedAt: 'x', decisions: [{ ...yes, kind: 'question' }] });
    expect(addsLeadWords(asked, body({ leadAskedAt: 'x', decisions: [{ ...yes, kind: 'question' }, { kind: 'answer', at: 'y', round: 1, byName: 'Ann' }] }), team)).toBe(false);
    expect(addsLeadWords(body({}), body({ leadAskedAt: 'x', leadAskedTo: ['flo'] }), team)).toBe(false);
    expect(addsLeadWords(body({ doneAt: 'x', leadOkBy: 'flo' }), body({ reopenedAt: 'y' }), team)).toBe(false);
  });
  it('a decision of a lead is refused, every kind', () => {
    for (const kind of LEAD_KINDS) expect(addsLeadWords(body({}), body({ decisions: [{ ...yes, kind }] }), team)).toBe(true);
  });
  it('a decision already there stays allowed', () => {
    expect(addsLeadWords(body({ decisions: [yes] }), body({ decisions: [yes], reopenedAt: 'y' }), team)).toBe(false);
  });
  it('another name on a decision is a new decision', () => {
    expect(addsLeadWords(body({ decisions: [yes] }), body({ decisions: [{ ...yes, by: 'dana' }] }), team)).toBe(true);
  });
  it("a lead's yes is refused", () => {
    expect(addsLeadWords(body({}), body({ leadOkBy: 'flo' }), team)).toBe(true);
  });
  it('Done exploring goes through a lead on a team with one', () => {
    expect(addsLeadWords(body({}), body({ doneAt: 'x' }), team)).toBe(true);
    expect(addsLeadWords(body({}), body({ doneAt: 'x' }), { hasLeads: false })).toBe(false);
  });
  it('a body with no block says nothing', () => {
    expect(addsLeadWords(body({}), 'plain text', team)).toBe(false);
  });
  it('the label that hands it over', () => {
    expect(handsOff(['ready-for-devs'], 'ready-for-devs')).toBe(true);
    expect(handsOff(['exploration'], 'ready-for-devs')).toBe(false);
  });
});

describe('the kinds', () => {
  it('match core: every decision but the designer\'s answer', () => {
    const kinds: DecisionKind[] = ['looks-right', 'changes', 'question', 'not-doing', 'take-back', 'asked-someone', 'handed', 'archived', 'answer'];
    expect(kinds.filter((k) => !LEAD_KINDS.has(k))).toEqual(['answer']);
  });
});
