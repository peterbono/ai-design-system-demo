import { describe, expect, it } from 'vitest';
import { buildReport, type PullRequestSummary } from '@bridge-ds/core';
import { GUIDANCE_REASON, groupCountLine, guidanceHistoryEntry, guidancePulls, isGuidanceEntry } from './history-guidance';

const pull = (n: number, x: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: n,
  title: `Change ${n}`,
  state: 'closed',
  draft: false,
  author: 'bridge-design-studio[bot]',
  headRef: `docs/card-20261024-${n}`,
  headSha: `sha${n}`,
  baseRef: 'main',
  labels: [],
  url: `https://github.com/acme/flow/pull/${n}`,
  updatedAt: '2026-10-24T10:00:00Z',
  mergedAt: '2026-10-24T10:00:00Z',
  ...x,
});

describe('usage guidance in History', () => {
  it('keeps merged guidance branches into the base that the token history does not list', () => {
    const pulls = [pull(1), pull(2, { mergedAt: undefined }), pull(3, { headRef: 'tokens/x' }), pull(4, { baseRef: 'dev' }), pull(5)];
    expect(guidancePulls(pulls, 'main', new Set([5])).map((p) => p.number)).toEqual([1]);
  });

  it('makes an entry without token changes, marked as guidance, named after who asked', () => {
    const e = guidanceHistoryEntry(pull(7, { title: 'Card: write titles as nouns' }), 'Priya Shah');
    expect(e).toMatchObject({ id: 'pr-7', author: 'Priya Shah', title: 'Card: write titles as nouns', tier: 1, changes: [], reasons: [GUIDANCE_REASON] });
    expect(isGuidanceEntry(e)).toBe(true);
    expect(isGuidanceEntry({ ...e, reasons: [] })).toBe(false);
  });

  it('sits in the release timeline next to token changes', () => {
    const r = buildReport({ source: 'github', label: 'acme/flow@main', ref: 'main', entries: [guidanceHistoryEntry(pull(7), 'Priya')], releases: [], truncated: false });
    expect(r.entries).toHaveLength(1);
    expect(r.timeline[0]?.version).toBe('Unreleased');
  });

  it('counts each kind in a release group', () => {
    const g = guidanceHistoryEntry(pull(7), 'Priya');
    const t = { reasons: [], changes: [{} as never] };
    expect(groupCountLine([t, t, g])).toBe('2 token changes, 1 guidance change');
    expect(groupCountLine([g])).toBe('1 guidance change');
    expect(groupCountLine([t])).toBe('1 token change');
  });
});
