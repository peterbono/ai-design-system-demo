import { describe, expect, it } from 'vitest';
import { parseExplorationBody, trimGitHub } from '@bridge-ds/core';
import { isPullList, slimPullList } from '../../api/_lib/slim-pulls';

const links = (kind: string) => Object.fromEntries(['followers', 'following', 'gists', 'starred', 'subscriptions', 'organizations', 'repos', 'events', 'received_events'].map((k) => [`${k}_url`, `https://api.github.com/${kind}/${k}`]));
const user = (login: string) => ({ login, id: 7, node_id: 'U_1', avatar_url: `https://avatars.example/${login}`, gravatar_id: '', url: `https://api.github.com/users/${login}`, html_url: `https://github.com/${login}`, type: 'User', user_view_type: 'public', site_admin: false, ...links('users') });
const repo = (full_name: string) => ({
  id: 3,
  node_id: 'R_1',
  name: full_name.split('/')[1],
  full_name,
  private: false,
  owner: user(full_name.split('/')[0]!),
  html_url: `https://github.com/${full_name}`,
  description: 'x'.repeat(200),
  fork: false,
  url: `https://api.github.com/repos/${full_name}`,
  default_branch: 'main',
  topics: ['a'],
  stargazers_count: 4,
  permissions: { admin: false },
  license: { key: 'mit' },
  ...links('repos'),
});
const BODY = `Long report.\n\n${'A line of the report.\n'.repeat(2000)}\nRequested by Ann Leroy (@annleroy).\n`;
const pull = (over: Record<string, unknown> = {}) => ({
  url: 'https://api.github.com/repos/o/r/pulls/9',
  id: 1,
  node_id: 'PR_1',
  html_url: 'https://github.com/o/r/pull/9',
  diff_url: 'https://github.com/o/r/pull/9.diff',
  patch_url: 'https://github.com/o/r/pull/9.patch',
  issue_url: 'https://api.github.com/repos/o/r/issues/9',
  number: 9,
  state: 'closed',
  locked: false,
  title: 'A change',
  user: user('ann'),
  body: BODY,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
  closed_at: '2026-11-02T00:00:00Z',
  merged_at: '2026-11-02T00:00:00Z',
  merge_commit_sha: 'abc',
  assignees: [user('leo')],
  requested_reviewers: [user('mia')],
  requested_teams: [{ name: 'Design', slug: 'design', id: 2, node_id: 'T_1', url: 'https://api.github.com/teams/2', html_url: 'https://github.com/orgs/o/teams/design' }],
  labels: [{ id: 5, node_id: 'L_1', url: 'https://api.github.com/labels/x', name: 'exploration', color: 'fff', default: false, description: null }],
  milestone: null,
  draft: true,
  commits_url: 'https://api.github.com/x',
  review_comments_url: 'https://api.github.com/x',
  review_comment_url: 'https://api.github.com/x',
  comments_url: 'https://api.github.com/x',
  statuses_url: 'https://api.github.com/x',
  head: { label: 'o:bridge/x', ref: 'bridge/x', sha: 'def', user: user('o'), repo: repo('o/r') },
  base: { label: 'o:main', ref: 'main', sha: '123', user: user('o'), repo: repo('o/r') },
  _links: { self: { href: 'https://api.github.com/x' } },
  author_association: 'MEMBER',
  auto_merge: { enabled_by: user('ann'), merge_method: 'squash', commit_title: 't', commit_message: 'm' },
  active_lock_reason: null,
  ...over,
});
const slimmed = (list: unknown[]) => JSON.parse(slimPullList(JSON.stringify(list))) as Record<string, any>[];

describe('slimPullList', () => {
  it('keeps what the pages read and drops what they do not', () => {
    const p = slimmed([pull()])[0]!;
    expect(p).toMatchObject({ number: 9, title: 'A change', state: 'closed', draft: true, html_url: 'https://github.com/o/r/pull/9', merged_at: '2026-11-02T00:00:00Z', merge_commit_sha: 'abc', author_association: 'MEMBER', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' });
    expect(p.user).toEqual({ login: 'ann', id: 7, avatar_url: 'https://avatars.example/ann', html_url: 'https://github.com/ann', type: 'User' });
    expect(p.head).toMatchObject({ ref: 'bridge/x', sha: 'def', label: 'o:bridge/x', repo: { full_name: 'o/r', fork: false, default_branch: 'main', owner: { login: 'o' } } });
    expect(p.base).toMatchObject({ ref: 'main', sha: '123', repo: { full_name: 'o/r' } });
    expect(p.labels).toEqual([{ id: 5, name: 'exploration', color: 'fff', default: false, description: null }]);
    expect(p.assignees[0].login).toBe('leo');
    expect(p.requested_reviewers[0].login).toBe('mia');
    expect(p.requested_teams[0]).toMatchObject({ name: 'Design', slug: 'design' });
    expect(p.auto_merge.enabled_by.login).toBe('ann');
    for (const gone of ['url', 'node_id', 'diff_url', 'patch_url', 'issue_url', 'commits_url', 'comments_url', 'statuses_url', '_links']) expect(p).not.toHaveProperty(gone);
    expect(p.head.repo).not.toHaveProperty('stargazers_count');
  });

  it('never touches a body: exploration blocks and requester lines stay, however long the report', () => {
    const block = '<!-- bridge:exploration\n{"v":1,"name":"Checkout","task":"https://github.com/o/r/issues/7","doneAt":"2026-11-01T00:00:00.000Z"}\n-->';
    for (const body of [BODY, `${block}\n\n${BODY}`, `${BODY}\n\n${block}`, null, '']) {
      const p = pull({ body });
      expect(slimmed([p])[0]!.body).toBe(body);
      expect(parseExplorationBody(slimmed([p])[0]!.body)).toEqual(parseExplorationBody(body));
    }
  });

  it('keeps a deleted fork gone (head.repo null) and a fork named', () => {
    const [a, b] = slimmed([pull({ head: { ref: 'x', sha: '1', user: null, repo: null } }), pull({ head: { ref: 'y', sha: '2', user: user('z'), repo: { ...repo('z/r'), fork: true } } })]);
    expect(a!.head.repo).toBeNull();
    expect(b!.head.repo).toMatchObject({ full_name: 'z/r', fork: true });
  });

  it('reads as the public demo teams already read these lists (core trimGitHub)', () => {
    const list = [pull(), pull({ number: 10, head: { ref: 'x', sha: '1', user: null, repo: null }, auto_merge: null })];
    expect(slimmed(list)).toEqual(trimGitHub(list));
  });

  it('leaves anything that is not a JSON list as it is', () => {
    for (const body of ['', 'not json', '{"message":"Not Found"}', 'null']) expect(slimPullList(body)).toBe(body);
    expect(slimPullList('[]')).toBe('[]');
  });

  it('weighs under a third on a list without long bodies', () => {
    const list = Array.from({ length: 10 }, (_, i) => pull({ number: i, body: 'short' }));
    expect(slimPullList(JSON.stringify(list)).length).toBeLessThan(JSON.stringify(list).length / 3);
  });

  it('applies to the list only: one pull request and its parts stay whole', () => {
    expect(isPullList(['pulls'])).toBe(true);
    for (const rest of [['pulls', '3'], ['pulls', '3', 'files'], ['issues'], []]) expect(isPullList(rest)).toBe(false);
  });
});
