import { describe, expect, it } from 'vitest';
import type { BranchCommitLike } from '@bridge-ds/core';
import { activityRows, avatarOf, faceOf, headlineOf, libraryPreviewApp, pageLines, startedTail } from './exploration-page';

const NOW = new Date('2026-10-30T14:00:00Z');
const c = (sha: string, message: string, date: string, login = 'florian'): BranchCommitLike => ({ sha, commit: { message, author: { name: login, date } }, author: { login } });
const CLAUDE = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const commits = [
  c('a', 'chore(explore): start Orders: bulk actions', '2026-10-29T10:00:00Z'),
  c('b', `feat: add row selection to the Orders table${CLAUDE}`, '2026-10-30T11:55:00Z'),
  c('d', 'tweak the empty state copy', '2026-10-30T11:58:00Z', 'dana'),
  c('e', `feat: add a Bulk actions bar: Mark shipped, Export, Cancel${CLAUDE}`, '2026-10-30T12:00:00Z'),
];

describe('exploration page model', () => {
  it('names people by their name, Claude as Claude, with GitHub photos for accounts only', () => {
    expect(faceOf('florian', false, { florian: 'Florian' })).toEqual({ login: 'florian', name: 'Florian', agent: false, avatar: 'https://github.com/florian.png?size=64' });
    expect(faceOf('claude', true)).toMatchObject({ name: 'Claude', agent: true, avatar: null });
    expect(avatarOf('ann@example.com')).toBeNull();
    expect(avatarOf('github-actions[bot]')).toBeNull();
  });

  it('says who started it, where and when', () => {
    expect(startedTail('Admin demo', '2026-10-30T09:00:00Z', NOW)).toBe('Admin demo · today');
    expect(startedTail('Admin demo', null)).toBe('Admin demo');
  });

  it('lists the last 3 events, newest first', () => {
    const rows = activityRows({ commits, author: 'florian', startedAt: '2026-10-29T10:00:00Z', names: { florian: 'Florian', dana: 'Dana' }, now: NOW });
    expect(rows.map((r) => `${r.who.name} ${r.text}, ${r.when}`)).toEqual(['Claude added a Bulk actions bar: Mark shipped, Export, Cancel, 2 h ago', 'Dana tweaked the empty state copy, 2 h ago', 'Claude added row selection to the Orders table, 2 h ago']);
  });

  it('says the last change from the files, else from the latest commit; nothing before the first change', () => {
    expect(headlineOf({ commits, files: ['apps/admin/src/OrdersTable.tsx', 'apps/admin/src/BulkActionsBar.tsx'], author: 'florian', now: NOW })).toMatchObject({ who: { name: 'Claude' }, text: 'changed Orders table and Bulk actions bar', when: '2 h ago' });
    expect(headlineOf({ commits, files: ['apps/admin/src/lib/x.ts'], author: 'florian', now: NOW })?.text).toBe('added a Bulk actions bar: Mark shipped, Export, Cancel');
    expect(headlineOf({ commits: commits.slice(0, 1), files: ['.bridge/explorations/orders.md'], author: 'florian' })).toBeNull();
  });

  it('copies the line Claude resolves, in the app and in a terminal', () => {
    expect(pageLines({ number: 12, name: 'Checkout', productName: 'Shop', product: 'shop', repo: 'acme/shop' })).toEqual({ app: 'Continue Bridge exploration shop#12 "Checkout" in Shop and use the Bridge library.', terminal: 'claude "Continue Bridge exploration shop#12"' });
  });

  it('opens the library app the exploration changes', () => {
    const apps = { docs: 'https://docs-{branch}', storybook: 'https://sb-{branch}', admin: 'https://admin-{branch}' };
    expect(libraryPreviewApp(['apps/docs-site/src/x.ts'], apps)).toBe('docs');
    expect(libraryPreviewApp(['apps/admin/src/App.tsx'], apps)).toBe('admin');
    expect(libraryPreviewApp(['packages/react/src/components/Button/Button.tsx'], apps)).toBe('storybook');
    expect(libraryPreviewApp(['packages/core/src/x.ts'], apps)).toBe('docs');
    expect(libraryPreviewApp(null, {})).toBeNull();
  });
});
