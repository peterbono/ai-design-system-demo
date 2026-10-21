import { describe, expect, it } from 'vitest';
import type { SuggestionListItem } from '@bridge-ds/core';
import { suggestionRows, teamBranchesRoute } from './team-branches';

describe('teamBranchesRoute', () => {
  it('opens a branch, an exploration (a branch too) or a suggestion in place, else the list', () => {
    expect(teamBranchesRoute('')).toEqual({ view: 'list' });
    expect(teamBranchesRoute('?pr=12')).toEqual({ view: 'pr', n: 12 });
    expect(teamBranchesRoute('?exploration=7')).toEqual({ view: 'pr', n: 7 });
    expect(teamBranchesRoute('?suggestion=3&pr=4')).toEqual({ view: 'suggestion', n: 3 });
    expect(teamBranchesRoute('?pr=abc')).toEqual({ view: 'list' });
    expect(teamBranchesRoute('?pr=-2')).toEqual({ view: 'list' });
  });
});

const item = (over: Partial<SuggestionListItem>): SuggestionListItem => ({
  number: 1,
  title: 'Tokens: softer borders',
  url: 'https://github.com/acme/ds/issues/1',
  author: 'ana',
  createdAt: '2026-10-01T10:00:00Z',
  state: 'open',
  stateReason: null,
  labels: [],
  kind: 'token-change',
  tier: 3,
  linkedPrs: [],
  status: 'needs-review',
  ...over,
});

describe('suggestionRows', () => {
  it('keeps open suggestions, newest first, with their status and a thumb by kind', () => {
    const rows = suggestionRows([
      item({ number: 1 }),
      item({ number: 2, createdAt: '2026-10-05T10:00:00Z', kind: 'docs', title: 'Docs: button wording' }),
      item({ number: 3, state: 'closed' }),
    ]);
    expect(rows.map((r) => r.number)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ title: 'Button wording', thumb: { kind: 'icon', icon: 'guidance' } });
    expect(rows[1]).toMatchObject({ title: 'Softer borders', thumb: { kind: 'icon', icon: 'token' } });
    expect(rows[1]!.pill.label).toBeTruthy();
  });
});
