import { describe, expect, it } from 'vitest';
import { demoWaitingRows, glanceFigures, isBotPull, recentChanges, type DemoPull } from './demo-home';

const DAY = 24 * 3600 * 1000;
const now = Date.parse('2026-10-22T12:00:00Z');
const at = (days: number) => new Date(now - days * DAY).toISOString();
const pull = (n: number, extra: Partial<DemoPull> = {}): DemoPull => ({
  number: n,
  title: `feat(tokens): change ${n}`,
  user: { login: 'ann', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  created_at: at(n),
  updated_at: at(0),
  ...extra,
});

describe('demo home rows', () => {
  it('lists what waits for a review, oldest first, drafts last, never as waiting on the visitor', () => {
    const rows = demoWaitingRows(
      [pull(1), pull(4), pull(2, { draft: true }), pull(9, { user: { login: 'github-actions[bot]', type: 'Bot' } })],
      [{ number: 30, title: 'Tokens: raise contrast', user: { login: 'dana' }, created_at: at(3) }, { number: 31, title: 'A pull request', user: { login: 'x' }, created_at: at(1), pull_request: {} }],
      now,
    );
    expect(rows.map((r) => r.key)).toEqual(['change-4', 'suggestion-30', 'change-1', 'change-2']);
    expect(rows.every((r) => !r.waitsOnYou)).toBe(true);
    expect(rows[0]).toMatchObject({ title: 'Change 4', line: 'ann asks for a review', pill: { label: 'Waiting 4 days', tone: 'warning' }, href: '/studio/changes/?pr=4' });
    expect(rows[1]).toMatchObject({ title: 'Raise contrast', line: 'dana suggests a change' });
    expect(rows[3]).toMatchObject({ line: 'Draft by ann', pill: { label: 'Draft', tone: 'neutral' } });
  });

  it('names Claude AI on agent work', () => {
    const [row] = demoWaitingRows([pull(1, { labels: [{ name: 'source: mcp' }] })], [], now);
    expect(row!.person?.agent).toBe(true);
  });

  it('leaves automation out', () => {
    expect(isBotPull({ user: { login: 'app/github-actions' } })).toBe(true);
    expect(isBotPull({ user: { login: 'dependabot[bot]' } })).toBe(true);
    expect(isBotPull({ user: { login: 'ann' } })).toBe(false);
  });

  it('shows the latest merged changes, newest first', () => {
    const recent = recentChanges([pull(1, { merged_at: at(3) }), pull(2, { merged_at: null }), pull(3, { merged_at: at(1) }), pull(4, { merged_at: at(0), user: { login: 'release[bot]', type: 'Bot' } })], now);
    expect(recent.map((r) => r.number)).toEqual([3, 1]);
    expect(recent[0]!.line).toBe('Merged 1 day ago · ann');
  });
});

describe('the library at a glance', () => {
  it('counts components and tokens, then contrast and adoption when known', () => {
    const f = glanceFigures({ components: 48, tokens: 612, contrast: { total: 296, fail: 0 }, adoption: 94.53 });
    expect(f.map((x) => [x.value, x.label])).toEqual([
      ['48', 'components'],
      ['612', 'tokens'],
      ['296', 'contrast checks pass'],
      ['94.5%', 'adoption in products'],
    ]);
    const failing = glanceFigures({ components: 1, tokens: 1, contrast: { total: 4, fail: 1 }, adoption: null });
    expect(failing.map((x) => x.tone)).toEqual([null, null, 'fail']);
    expect(failing[2]).toMatchObject({ value: '1', label: 'of 4 contrast checks fail' });
    expect(failing.map((x) => x.label).slice(0, 2)).toEqual(['component', 'token']);
    expect(glanceFigures({ components: 0, tokens: 0, contrast: null, adoption: null })).toHaveLength(2);
  });
});
