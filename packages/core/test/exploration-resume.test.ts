import { describe, expect, it } from 'vitest';
import {
  actorName,
  changedThings,
  continueLines,
  explorationActivity,
  explorationStage,
  humanAuthorOf,
  isClaudeAssisted,
  isClaudeCommit,
  lastActivity,
  listThings,
  parseContinueLine,
  shortAgo,
  startedWhen,
  subjectWords,
  thingOf,
  whereItStands,
  wordsOf,
  type BranchCommitLike,
} from '../src/exploration-resume';

const commit = (sha: string, message: string, date: string, login = 'florian'): BranchCommitLike => ({ sha, commit: { message, author: { name: login, date } }, author: { login } });
const NOW = new Date('2026-10-30T14:00:00Z');

describe('explorationStage', () => {
  it('is not started while only Bridge notes changed', () => {
    expect(explorationStage({ status: 'active', files: ['.bridge/explorations/orders.md'] })).toBe('not-started');
    expect(explorationStage({ status: 'active', files: [] })).toBe('not-started');
  });
  it('is exploring once something else changed, or when the files cannot be read', () => {
    expect(explorationStage({ status: 'active', files: ['.bridge/explorations/orders.md', 'apps/admin/src/OrdersTable.tsx'] })).toBe('exploring');
    expect(explorationStage({ status: 'active', files: null })).toBe('exploring');
  });
  it('keeps later states and archived ones out', () => {
    expect(explorationStage({ status: 'ready', files: [] })).toBe('handed');
    expect(explorationStage({ status: 'active', archived: true, files: [] })).toBe('handed');
  });
});

describe('continueLines', () => {
  it('names a design system exploration by its number', () => {
    expect(continueLines({ number: 611, name: 'Orders: bulk actions', productName: 'Admin demo' })).toEqual({
      app: 'Continue Bridge exploration #611 "Orders: bulk actions" in Admin demo and use the Bridge library.',
      terminal: 'claude "Continue Bridge exploration #611"',
    });
  });
  it('names a product repository exploration as the MCP server accepts it', () => {
    const l = continueLines({ number: 12, name: 'Checkout "fast"', productName: 'Shop', product: 'shop', repo: 'acme/shop' });
    expect(l.terminal).toBe('claude "Continue Bridge exploration shop#12"');
    expect(l.app).toBe('Continue Bridge exploration shop#12 "Checkout \'fast\'" in Shop and use the Bridge library.');
    expect(l.app).not.toContain('—');
  });
  it('reads the line back', () => {
    expect(parseContinueLine('claude "Continue Bridge exploration #611"')).toBe('#611');
    expect(parseContinueLine('continue bridge exploration Shop#12 "x"')).toBe('shop#12');
    expect(parseContinueLine('Continue the work')).toBeNull();
  });
});

describe('what changed, in words', () => {
  it('maps files to components and screens', () => {
    expect(wordsOf('BulkActionsBar')).toBe('Bulk actions bar');
    expect(wordsOf('DSBridgePanel')).toBe('DS bridge panel');
    expect(thingOf('apps/admin/src/orders/OrdersTable.tsx')).toBe('Orders table');
    expect(thingOf('packages/react/src/components/Button/Button.module.css')).toBe('Button');
    expect(thingOf('packages/react/src/components/Button/index.ts')).toBe('Button');
    expect(thingOf('apps/shop/src/pages/checkout/index.tsx')).toBe('Checkout screen');
    expect(thingOf('packages/tokens/src/semantic/light/color.json')).toBe('Tokens');
    expect(thingOf('apps/admin/src/lib/format.ts')).toBeNull();
    expect(thingOf('apps/admin/src/OrdersTable.test.tsx')).toBeNull();
    expect(thingOf('.bridge/explorations/x.md')).toBeNull();
  });
  it('lists them without repeats', () => {
    const things = changedThings(['apps/admin/src/OrdersTable.tsx', 'apps/admin/src/OrdersTable.module.css', 'apps/admin/src/BulkActionsBar.tsx']);
    expect(things).toEqual(['Orders table', 'Bulk actions bar']);
    expect(listThings(things)).toBe('Orders table and Bulk actions bar');
    expect(listThings(['A', 'B', 'C', 'D'])).toBe('A, B and 2 more');
  });
  it('turns commit subjects into words', () => {
    expect(subjectWords('feat(orders): add row selection to the Orders table')).toBe('added row selection to the Orders table');
    expect(subjectWords('Bulk actions bar — three actions')).toBe('changed bulk actions bar, three actions');
    expect(subjectWords('fix: fix spacing (#12)')).toBe('fixed spacing');
  });
});

describe('activity', () => {
  const commits = [
    commit('a', 'chore(explore): start Orders: bulk actions', '2026-10-29T10:00:00Z'),
    commit('b', 'feat: add row selection to the Orders table\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', '2026-10-30T11:50:00Z'),
    commit('c', 'feat: add a Bulk actions bar\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', '2026-10-30T12:00:00Z'),
  ];
  it('lists the newest first, the person credited with Claude, the start last', () => {
    const ev = explorationActivity({ commits, author: 'florian', limit: 3 });
    expect(ev.map((e) => [actorName(e, { florian: 'Florian' }), e.text])).toEqual([
      ['Florian with Claude', 'added a Bulk actions bar'],
      ['Florian with Claude', 'added row selection to the Orders table'],
      ['Florian', 'started the exploration'],
    ]);
  });
  it('credits Claude alone when no person authored the commit', () => {
    const bot = { sha: 'x', commit: { message: 'feat: add x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', author: { name: 'bridge-ds[bot]', date: '2026-10-30T12:00:00Z' } }, author: { login: 'bridge-ds[bot]' } };
    const anon = { sha: 'y', commit: { message: 'feat: add y\n\nCo-Authored-By: Claude <noreply@anthropic.com>', author: { date: '2026-10-30T12:00:00Z' } } };
    const account = { sha: 'z', commit: { message: 'feat: add z', author: { name: 'Claude', date: '2026-10-30T12:00:00Z' } }, author: null };
    expect([bot, anon, account].map(isClaudeCommit)).toEqual([true, true, true]);
    expect(isClaudeCommit(commits[1]!)).toBe(false);
    expect(isClaudeAssisted(commits[1]!)).toBe(true);
    expect(humanAuthorOf(commits[1]!)).toBe('florian');
  });
  it('says the last change from the files when they name things', () => {
    expect(lastActivity({ commits, files: ['apps/admin/src/OrdersTable.tsx', 'apps/admin/src/BulkActionsBar.tsx'], author: 'florian' })).toMatchObject({ who: 'florian', claude: false, withClaude: true, text: 'changed Orders table and Bulk actions bar' });
    expect(lastActivity({ commits, files: ['apps/admin/src/lib/x.ts'], author: 'florian' })?.text).toBe('added a Bulk actions bar');
    expect(lastActivity({ commits: commits.slice(0, 1), files: [], author: 'florian' })).toBeNull();
  });
  it('says where it stands without technical words', () => {
    const events = explorationActivity({ commits, author: 'florian' });
    const s = whereItStands({ name: 'Orders', stage: 'exploring', events, files: ['apps/admin/src/OrdersTable.tsx'], now: NOW });
    expect(s).toBe('So far it changes Orders table. Last: florian with Claude added a Bulk actions bar, 2 h ago.');
    expect(s).not.toMatch(/commit|branch|pull request/);
    expect(whereItStands({ name: 'Orders', stage: 'not-started', events: [], files: [] })).toBe('"Orders" is started but nothing is built yet.');
  });
});

describe('time in words', () => {
  it('says how long ago', () => {
    expect(shortAgo('2026-10-30T13:59:30Z', NOW)).toBe('just now');
    expect(shortAgo('2026-10-30T13:40:00Z', NOW)).toBe('20 min ago');
    expect(shortAgo('2026-10-30T12:00:00Z', NOW)).toBe('2 h ago');
    expect(shortAgo('2026-10-29T10:00:00Z', NOW)).toBe('Yesterday');
    expect(shortAgo('2026-10-26T10:00:00Z', NOW)).toBe('4 days ago');
  });
  it('says when it started', () => {
    expect(startedWhen('2026-10-30T08:00:00', new Date('2026-10-30T14:00:00'))).toBe('today');
    expect(startedWhen('2026-10-29T08:00:00', new Date('2026-10-30T14:00:00'))).toBe('yesterday');
  });
});
