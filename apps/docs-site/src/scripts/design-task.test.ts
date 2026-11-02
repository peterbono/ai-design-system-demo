// The developers' task read: its comments only when it has some (one read, since Done exploring), the shipped review
// once, and the designer's reply through the viewer's own write route.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gh = vi.hoisted(() => ({ get: vi.fn(), write: vi.fn() }));
vi.mock('./github-session', () => ({ ghGet: gh.get, ghWrite: gh.write }));

import { readDesignTask, replyOnTask } from './design-task';

const TASK = 'https://github.com/acme/shop/issues/7';
const issue = (over: Record<string, unknown> = {}) => ({ data: { state: 'open', state_reason: null, closed_at: null, assignees: [], comments: 0, labels: [{ name: 'from-design' }], ...over } });

beforeEach(() => gh.get.mockReset());

describe('readDesignTask', () => {
  it('reads no comments when the task has none', async () => {
    gh.get.mockImplementation(async (path = '') => (path.endsWith('/issues/7') ? issue() : { data: [] }));
    const t = await readDesignTask(TASK, { doneAt: '2026-10-31T00:00:00Z' });
    expect(t).toMatchObject({ state: 'open', labels: ['from-design'], comments: null });
    expect(gh.get.mock.calls.some((c) => String(c[0]).includes('/comments'))).toBe(false);
  });

  it('reads the comments since Done exploring in one call, keeping only what Bridge reads', async () => {
    gh.get.mockImplementation(async (path = '') => {
      if (path.endsWith('/issues/7')) return issue({ comments: 2, labels: ['needs-design'] });
      if (path.includes('/comments')) return { data: [{ body: 'Red or orange?', user: { login: 'sam', type: 'User', email: 'x' }, created_at: '2026-11-01T00:00:00Z', reactions: {} }] };
      return { data: [] };
    });
    const t = await readDesignTask(TASK, { doneAt: '2026-10-31T00:00:00Z' });
    expect(gh.get.mock.calls.map((c) => c[0])).toContain('/repos/acme/shop/issues/7/comments?per_page=100&since=2026-10-31T00%3A00%3A00.000Z');
    expect(t!.comments).toEqual([{ body: 'Red or orange?', user: { login: 'sam', type: 'User' }, created_at: '2026-11-01T00:00:00Z' }]);
    expect(t!.labels).toEqual(['needs-design']);
    // Being built does not need them.
    gh.get.mockClear();
    await readDesignTask(TASK, { comments: false });
    expect(gh.get.mock.calls.some((c) => String(c[0]).includes('/comments'))).toBe(false);
  });

  it('once shipped, reads who said it looks right on the merged version, once a session', async () => {
    const merged = { event: 'cross-referenced', source: { issue: { number: 21, html_url: 'https://github.com/acme/shop/pull/21', state: 'closed', pull_request: { merged_at: '2026-11-01T00:00:00Z' }, repository: { full_name: 'acme/shop' } } } };
    gh.get.mockImplementation(async (path = '') => {
      if (path.endsWith('/issues/7')) return issue({ state: 'closed', state_reason: 'completed', closed_at: '2026-11-01T00:00:00Z' });
      if (path.includes('/timeline')) return { data: [merged] };
      if (path.includes('/issues/21/comments')) return { data: [{ body: 'Design review from Bridge: looks right.', user: { login: 'ann' }, created_at: '2026-10-31T10:00:00Z' }] };
      return { data: [] };
    });
    expect((await readDesignTask(TASK, { shipped: true }))!.shippedAnswer).toEqual({ kind: 'looks-right', login: 'ann' });
    await readDesignTask(TASK, { shipped: true });
    expect(gh.get.mock.calls.filter((c) => String(c[0]).includes('/issues/21/comments'))).toHaveLength(1);
    // Without asking for it (the lists), never read.
    gh.get.mockClear();
    expect((await readDesignTask(TASK))!.shippedAnswer).toBeUndefined();
  });
});

describe('replyOnTask', () => {
  it("posts on the developers' task with the viewer's client, never empty", async () => {
    const createIssueComment = vi.fn(async () => ({ id: 1, url: 'u' }));
    const forRepo = vi.fn(() => ({ createIssueComment }));
    const client = { withBranchPrefix: vi.fn(() => ({ forRepo })) };
    await replyOnTask(client, TASK, '  Oldest first.  ');
    expect(forRepo).toHaveBeenCalledWith('acme/shop');
    expect(createIssueComment).toHaveBeenCalledWith(7, 'Oldest first.');
    await expect(replyOnTask(client, TASK, '   ')).rejects.toThrow('Write your answer first.');
  });
});
