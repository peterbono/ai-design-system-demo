import { describe, expect, it } from 'vitest';
import { draftOf, edgeCaseGroups, notesCountLine, updateOfDraft } from './exploration-notes-view';

const N = {
  context: 'c',
  decisions: ['A'],
  edgeCases: [
    { component: 'Button', state: 'Loading', covered: true },
    { component: 'Toast', state: 'Long', covered: false },
    { component: 'button', state: 'Error', covered: false, note: 'red' },
  ],
  openQuestions: [],
  nextStep: 'n',
};

describe('exploration notes view', () => {
  it('counts in words, singular and plural', () => {
    expect(notesCountLine(N)).toBe('1 decision · 1 of 3 edge cases covered');
    expect(notesCountLine({ ...N, decisions: [], edgeCases: [], openQuestions: ['q', 'r'] })).toBe('2 open questions');
    expect(notesCountLine({ ...N, decisions: [], edgeCases: [] })).toBe('');
  });

  it('groups edge cases by component, any case', () => {
    expect(edgeCaseGroups(N.edgeCases).map((g) => [g.component, g.cases.length])).toEqual([
      ['Button', 2],
      ['Toast', 1],
    ]);
  });

  it('names only the sections the form changed; list lines lose their bullets', () => {
    expect(updateOfDraft(N, draftOf(N))).toEqual({});
    const d = { ...draftOf(N), decisions: 'A\n- B\n\n', nextStep: ' n ' };
    expect(updateOfDraft(N, d)).toEqual({ decisions: ['A', 'B'] });
    expect(updateOfDraft(N, { ...draftOf(N), edgeCases: [] })).toEqual({ edgeCases: [] });
    expect(updateOfDraft(N, { ...draftOf(N), edgeCases: [...N.edgeCases, { component: '', state: ' ', covered: false }] })).toEqual({});
  });
});
