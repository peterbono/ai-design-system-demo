import { describe, expect, it } from 'vitest';
import { explorationPrBody, withDecision, withDoneExploring, withLeadAsked, withLeadAskedTo, withoutLeadAsked } from '@bridge-ds/core';
import { decisionRows, decisionTag, designerZoneTitle, leadHomeRow, nextName, sayerName } from './lead-decisions';

const start = explorationPrBody({ name: 'Late tag', purpose: 'p', slug: 'late-tag', author: 'ann' }, { owner: 'o', repo: 'r', packages: [], apps: {} });
const asked = withLeadAsked(start, { at: '2026-11-07T10:00:00.000Z', by: 'ann' });
const lead = { viewer: 'flo', lead: true, own: false };
const designer = { viewer: 'ann', lead: false, own: true };

describe('the Decisions list', () => {
  it('names who said it and what, newest first', () => {
    const rows = decisionRows(
      [
        { kind: 'changes', at: 't1', round: 1, by: 'flo', text: 'Tighter' },
        { kind: 'answer', at: 't2', round: 2, byName: 'Ann' },
        { kind: 'handed', at: 't3', round: 2, by: 'flo', to: ['Mia'] },
        { kind: 'asked-someone', at: 't4', round: 2, by: 'flo', to: ['dana'] },
      ],
      { flo: 'Florian', dana: 'Dana' },
    );
    expect(rows.map((r) => `${r.name} ${r.verb}`)).toEqual(['Florian asked Dana to review', 'Florian handed it over to Mia', 'Ann answered', 'Florian asked for changes']);
    expect(rows[3]!.why).toBe('Tighter');
  });
  it('reads a display name before a login, and never the name prefix', () => {
    expect(sayerName({ by: 'name:Goulou' })).toBe('Goulou');
    expect(sayerName({ byName: 'Ann', by: 'ann' })).toBe('Ann');
  });
});

describe('the tag and the zone', () => {
  it('says what the talk made of it', () => {
    expect(decisionTag({ kind: 'changes' }, 'Ann')).toEqual({ label: 'Needs changes', tone: 'danger' });
    expect(decisionTag({ kind: 'question' }, 'Ann')).toEqual({ label: 'Waiting for Ann', tone: 'info' });
    expect(decisionTag({ kind: 'not-doing' }, 'Ann')).toEqual({ label: 'Not doing this', tone: 'neutral' });
    expect(decisionTag(null, 'Ann')).toBeNull();
    expect(designerZoneTitle('changes', 'Florian')).toBe('Florian asks for changes');
    expect(designerZoneTitle('question', 'Florian')).toBe('Florian has a question');
  });
  it('names a reopened exploration after it', () => {
    expect(nextName('Late tag')).toBe('Late tag 2');
    expect(nextName('Late tag 2')).toBe('Late tag 3');
  });
});

describe('the Home of a lead and a designer (board L6)', () => {
  it('a lead has it in Needs you only while the next word is theirs', () => {
    expect(leadHomeRow(asked, lead)).toMatchObject({ where: 'needs', line: 'ann is done exploring', action: 'Review' });
    expect(leadHomeRow(asked, { ...lead, lead: false })).toBeNull();
  });
  it('asked by name: the other leads no longer see it', () => {
    const to = withDecision(withLeadAskedTo(asked, ['dana']), { kind: 'asked-someone', at: 't', by: 'flo', to: ['dana'] });
    expect(leadHomeRow(to, lead)).toBeNull();
    expect(leadHomeRow(to, { ...lead, viewer: 'dana' })?.line).toBe('flo asks you to look');
  });
  it('a question: quiet for the lead who asked, Needs you for the designer', () => {
    const q = withDecision(asked, { kind: 'question', at: 't', by: 'flo', text: 'Which tab?' });
    expect(leadHomeRow(q, lead)).toMatchObject({ where: 'waiting', line: 'waiting for ann' });
    expect(leadHomeRow(q, { ...lead, viewer: 'dana' })).toBeNull();
    expect(leadHomeRow(q, designer)).toMatchObject({ where: 'needs', line: 'flo has a question', action: 'Answer' });
  });
  it('the answer moves it up', () => {
    const a = withDecision(withDecision(asked, { kind: 'question', at: 't', by: 'flo', text: 'Which?' }), { kind: 'answer', at: 't2', by: 'ann', text: 'Orders' });
    expect(leadHomeRow(a, lead)).toMatchObject({ where: 'needs', line: 'ann answered your question' });
  });
  it('changes wait on the designer, then a new ask on the lead', () => {
    const c = withDecision(withoutLeadAsked(asked), { kind: 'changes', at: 't', by: 'flo', text: 'Tighter' });
    expect(leadHomeRow(c, designer)?.line).toBe('flo asked for changes');
    expect(leadHomeRow(c, lead)?.where).toBe('waiting');
    const back = withLeadAsked(withDecision(c, { kind: 'answer', at: 't2', by: 'ann', text: 'Done' }), { at: 't3', by: 'ann' });
    expect(leadHomeRow(back, lead)?.line).toBe('ann answered your changes');
  });
  it('nothing once it went to the developers', () => {
    expect(leadHomeRow(withDoneExploring(asked, { branch: 'explore/late-tag', doneAt: 't' }), lead)).toBeNull();
  });
});
