// Check the build (board R4): who must say it looks right, on which commit, and the words Bridge signs on the
// developers' pull request (api/_lib/build-check.ts, lib/build-check-view.ts, lib/pm-view.ts pmHomeRow).
import { describe, expect, it } from 'vitest';
import { buildComment, buildStateOf, devPullOfEvents, taskOfUrl, type BuildWord } from '../../api/_lib/build-check';
import { designReviewOf } from './review-state';
import { buildRows } from './build-check-view';
import { pmHomeRow } from './pm-view';

const w = (role: BuildWord['role'], kind: BuildWord['kind'], sha: string, extra: Partial<BuildWord> = {}): BuildWord => ({ role, kind, sha, byName: role, at: '2026-11-07T10:00:00Z', ...extra });

describe('where the check stands', () => {
  it('waits for the designer and the PM, then says yes', () => {
    expect(buildStateOf([], 'h1', { pm: true, lead: false }).state).toBe('pending');
    expect(buildStateOf([w('designer', 'looks-right', 'h1')], 'h1', { pm: true, lead: false })).toMatchObject({ state: 'pending', description: 'Waiting for the product manager' });
    expect(buildStateOf([w('designer', 'looks-right', 'h1'), w('pm', 'looks-right', 'h1')], 'h1', { pm: true, lead: false }).state).toBe('success');
  });

  it('a push after a yes asks again; a word on the head counts', () => {
    const words = [w('designer', 'looks-right', 'h1'), w('pm', 'looks-right', 'h1')];
    expect(buildStateOf(words, 'h2', { pm: true, lead: false }).state).toBe('pending');
  });

  it('any Needs changes on the head stops it; the lead counts only when the library changed', () => {
    const st = buildStateOf([w('designer', 'looks-right', 'h1'), w('pm', 'changes', 'h1', { text: 'Date cut', why: 'build' })], 'h1', { pm: true, lead: false });
    expect(st).toMatchObject({ state: 'failure', description: 'pm asked for changes' });
    expect(buildStateOf([w('designer', 'looks-right', 'h1')], 'h1', { pm: false, lead: true }).state).toBe('pending');
    expect(buildStateOf([w('designer', 'looks-right', 'h1'), w('lead', 'looks-right', 'h1')], 'h1', { pm: false, lead: true }).state).toBe('success');
    // A lead's word when not needed still shows, and a Needs changes from them still stops it.
    expect(buildStateOf([w('designer', 'looks-right', 'h1'), w('lead', 'changes', 'h1', { text: 'x' })], 'h1', { pm: false, lead: false }).state).toBe('failure');
  });
});

describe('reading GitHub', () => {
  it('the task and the developers\' open pull request that links it', () => {
    expect(taskOfUrl('https://github.com/Acme/Shop/issues/7')).toEqual({ repo: 'acme/shop', number: 7 });
    expect(taskOfUrl('https://github.com/acme/shop/pull/7')).toBeNull();
    // A task link written before the organization was renamed reads under its current name.
    expect(taskOfUrl('https://github.com/art-print-shop-co/art-print-shop/issues/7')).toEqual({ repo: 'the-bridge-company/art-print-shop', number: 7 });
    const ev = (n: number, state: string, repo = 'acme/shop', draft = false) => ({ event: 'cross-referenced', source: { issue: { number: n, html_url: `https://github.com/${repo}/pull/${n}`, state, draft, pull_request: {}, repository: { full_name: repo } } } });
    expect(devPullOfEvents([ev(9, 'closed'), ev(10, 'open'), ev(11, 'open', 'acme/other')], 'Acme/Shop')).toEqual({ number: 10, url: 'https://github.com/acme/shop/pull/10', draft: false });
    expect(devPullOfEvents('nope', 'acme/shop')).toBeNull();
  });

  it('signs the comment, and the review reader still reads it', () => {
    const yes = buildComment({ kind: 'looks-right', byName: 'Dino', role: 'pm' });
    expect(yes).toContain('Dino (product manager)');
    expect(designReviewOf([{ body: yes, user: { login: 'bridge[bot]' } }])).toMatchObject({ kind: 'looks-right' });
    const no = buildComment({ kind: 'changes', why: 'design', text: 'Keep the date', byName: 'Mia', role: 'designer' });
    expect(designReviewOf([{ body: no, user: { login: 'bridge[bot]' } }])).toMatchObject({ kind: 'changes', text: 'The design must change, a new version comes back from the designer: Keep the date' });
  });
});

describe('in words', () => {
  it('names who checks; the lead is not needed when no library piece changed', () => {
    const rows = buildRows([{ role: 'designer', required: true, state: 'looks-right', byName: 'Mia' }, { role: 'pm', required: true, state: 'waiting' }], { designer: 'Mia', pm: 'Dino', lead: null });
    expect(rows.map((r) => [r.name, r.part, r.stateLine])).toEqual([
      ['Mia', 'designer', 'Looks right'],
      ['Dino', 'product manager', 'Waiting'],
      ['Design lead', '', 'Not needed: no library piece changed'],
    ]);
  });

  it("the PM's Home: their opinion while it runs, the build once ready", () => {
    const body = (e: Record<string, unknown>) => `x\n\n<!-- bridge-exploration ${JSON.stringify({ name: 'Late tag', startedAt: '2026-11-01T00:00:00Z', ...e })} -->`;
    expect(pmHomeRow(body({}), { buildReady: false })?.line('Mia')).toBe('Mia would like your opinion');
    expect(pmHomeRow(body({ decisions: [{ kind: 'pm-ok', at: 'x', round: 1 }] }), { buildReady: false })).toBeNull();
    expect(pmHomeRow(body({ doneAt: 'x' }), { buildReady: false })).toBeNull();
    expect(pmHomeRow(body({ doneAt: 'x' }), { buildReady: true })).toMatchObject({ action: 'Check' });
  });
});
