import { describe, expect, it } from 'vitest';
import { ALREADY_ANSWERED, answerLeadOnGitHub, askLeadOnGitHub, askOtherLeadOnGitHub, handOverOnGitHub, leadChangesOnGitHub, leadQuestionOnGitHub, notDoingOnGitHub, takeBackOnGitHub, tellDevelopersOnGitHub } from '../src/exploration-done-github';
import { explorationPrBody, isNotDoing, leadTurnOf, openDecisionOf, parseExplorationBody, withDoneExploring } from '../src/explorations';
import { archiveExplorationOnGitHub } from '../src/explorations-github';
import { GitHubClient } from '../src/github-client';

function world(start?: (b: string) => string) {
  const writes: { method: string; path: string; body: any }[] = [];
  const first = explorationPrBody({ name: 'Orders', purpose: 'Faster', slug: 'orders' }, { owner: 'acme', repo: 'shop', packages: [], apps: {} });
  const pull = { number: 4, node_id: 'PR_4', html_url: 'https://github.com/acme/shop/pull/4', title: 'Exploration: Orders', state: 'open', draft: true, body: start ? start(first) : first, labels: [{ name: 'exploration' }], head: { ref: 'explore/orders', sha: 'c1' }, base: { ref: 'main' }, user: { login: 'ann' }, updated_at: '', created_at: '' };
  const res = (status: number, b: unknown) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => b, text: async () => JSON.stringify(b) });
  const f = (async (url: string, init?: { method?: string; body?: string }) => {
    const path = url.replace('https://api.github.com', '').split('?')[0]!;
    const method = init?.method ?? 'GET';
    const b = init?.body ? JSON.parse(init.body) : {};
    if (method !== 'GET') writes.push({ method, path, body: b });
    if (path === '/repos/acme/shop/pulls/4') {
      if (method === 'PATCH') Object.assign(pull, b);
      return res(200, pull);
    }
    if (path === '/repos/acme/shop/issues/4/comments') return res(201, { id: 1, body: b.body, user: { login: 'x' }, html_url: '', created_at: '' });
    if (path === '/repos/acme/dev/issues/7/comments') return res(201, { id: 2, body: b.body, user: { login: 'x' }, html_url: '', created_at: '' });
    if (path === '/repos/acme/dev/issues/7') return res(200, { number: 7, state: 'closed' });
    if (path.startsWith('/repos/acme/shop/issues/4/labels')) {
      if (method === 'POST') pull.labels = [...pull.labels, ...(b.labels ?? []).map((name: string) => ({ name }))];
      return res(200, []);
    }
    if (path.includes('/commits')) return res(200, []);
    return res(404, { message: `no route ${method} ${path}` });
  }) as unknown as ConstructorParameters<typeof GitHubClient>[2];
  const gh = new GitHubClient('acme/shop', 't', f, { attempts: 1, baseDelayMs: 0, sleep: async () => {} }, { etags: false, protectedBranches: ['main'], branchPrefix: 'explore/' });
  return { gh, pull, writes };
}

const asked = async () => {
  const w = world();
  await askLeadOnGitHub(w.gh, 4, { openedBy: 'ann', leads: ['flo'] });
  return w;
};

describe('a lead answers', () => {
  it('names the leads asked, and the version', async () => {
    const { pull } = await asked();
    expect(parseExplorationBody(pull.body)).toMatchObject({ leadAskedTo: ['flo'], leadAskedSha: 'c1' });
  });
  it('a question keeps it waiting, the answer gives it back', async () => {
    const { gh, pull } = await asked();
    await leadQuestionOnGitHub(gh, 4, { text: 'Which tab?', lead: 'flo' });
    expect(leadTurnOf(pull.body)).toBe('designer');
    await answerLeadOnGitHub(gh, 4, { text: 'Orders', by: 'ann' });
    expect(leadTurnOf(pull.body)).toBe('lead');
  });
  it('changes come back with the answer and the same ask', async () => {
    const { gh, pull, writes } = await asked();
    await leadChangesOnGitHub(gh, 4, { note: 'Tighter', lead: 'flo' });
    await answerLeadOnGitHub(gh, 4, { by: 'ann', leads: ['flo'] });
    expect(leadTurnOf(pull.body)).toBe('lead');
    expect(writes.at(-1)!.body.body).toContain('@flo');
  });
  it('a second lead hears it was answered', async () => {
    const { gh } = await asked();
    await leadChangesOnGitHub(gh, 4, { note: 'Tighter', lead: 'flo' });
    await expect(leadChangesOnGitHub(gh, 4, { note: 'Me too', lead: 'dana' })).rejects.toThrow(ALREADY_ANSWERED);
    await expect(leadQuestionOnGitHub(gh, 4, { text: 'x', lead: 'dana' })).rejects.toThrow(ALREADY_ANSWERED);
  });
  it('someone else is asked by name', async () => {
    const { gh, pull } = await asked();
    await askOtherLeadOnGitHub(gh, 4, { to: ['dana'], lead: 'flo' });
    expect(parseExplorationBody(pull.body)?.leadAskedTo).toEqual(['dana']);
    await expect(askOtherLeadOnGitHub(gh, 4, { to: [], lead: 'flo' })).rejects.toThrow('nobody else');
  });
  it('not doing this ends it with the reason, its work kept', async () => {
    const { gh, pull } = await asked();
    await notDoingOnGitHub(gh, 4, { reason: 'Billing covers it', lead: 'flo' });
    expect(isNotDoing(pull.body)).toBe(true);
    expect(openDecisionOf(pull.body)?.text).toBe('Billing covers it');
    expect(pull.labels.map((l) => l.name)).toContain('archived');
    expect(pull.state).toBe('open');
  });
});

describe('after the hand-off', () => {
  const handed = () =>
    world((b) => withDoneExploring(b, { branch: 'explore/orders', doneAt: '2026-11-07T10:00:00.000Z', doneSha: 'c1', task: 'https://github.com/acme/dev/issues/7', leadOkBy: 'flo' }));
  it('take it back: the task leaves with the reason, the yes goes, the designer reads why', async () => {
    const { gh, pull, writes } = handed();
    pull.labels = [{ name: 'ready-for-devs' }];
    await takeBackOnGitHub(gh, 4, { reason: 'The date hides', lead: 'flo' });
    expect(writes.find((w) => w.path === '/repos/acme/dev/issues/7/comments')?.body.body).toContain('The date hides');
    expect(writes.find((w) => w.path === '/repos/acme/dev/issues/7')?.body).toMatchObject({ state: 'closed', state_reason: 'not_planned' });
    expect(parseExplorationBody(pull.body)?.leadOkBy).toBeUndefined();
    expect(openDecisionOf(pull.body)).toMatchObject({ kind: 'take-back', text: 'The date hides' });
  });
  it('developers started: it stays, a word reaches them on their task', async () => {
    const own = world((b) => withDoneExploring(b, { branch: 'explore/orders', doneAt: '2026-11-07T10:00:00.000Z', doneSha: 'c1' }));
    own.pull.labels = [{ name: 'ready-for-devs' }];
    own.pull.head.sha = 'c2';
    await expect(takeBackOnGitHub(own.gh, 4, { reason: 'x', lead: 'flo' })).rejects.toThrow('Developers already work');
    const { gh, writes } = handed();
    await tellDevelopersOnGitHub(gh, 4, { text: 'Keep the date', byName: 'Florian' });
    expect(writes.at(-1)).toMatchObject({ path: '/repos/acme/dev/issues/7/comments' });
    expect(writes.at(-1)!.body.body).toContain('Keep the date');
  });
});

describe('the words stay', () => {
  it('a hand-over names the new keeper', async () => {
    const { gh, pull } = await asked();
    await handOverOnGitHub(gh, 4, { to: { login: 'dino' }, toName: 'Dino', reason: 'On leave', by: 'flo' });
    expect(parseExplorationBody(pull.body)?.author).toBe('dino');
    expect(parseExplorationBody(pull.body)?.decisions?.at(-1)).toMatchObject({ kind: 'handed', to: ['Dino'], text: 'On leave' });
  });
  it('archiving someone else\'s work keeps the reason', async () => {
    const { gh, pull } = await asked();
    await archiveExplorationOnGitHub(gh, 4, { reason: 'Stale', by: 'flo' });
    expect(parseExplorationBody(pull.body)?.decisions?.at(-1)).toMatchObject({ kind: 'archived', text: 'Stale' });
  });
});

describe('Take it back', () => {
  it('writes the decision with Back to exploring, once', async () => {
    const w = world((b) => withDoneExploring(b, { branch: 'explore/orders', doneAt: '2026-01-01T00:00:00Z', doneSha: 'c1', checks: null }));
    await takeBackOnGitHub(w.gh, 4, { reason: 'Keep the date', lead: 'flo' });
    expect(openDecisionOf(w.pull.body)).toMatchObject({ kind: 'take-back', text: 'Keep the date', by: 'flo' });
    expect(w.writes.filter((x) => x.method === 'PATCH' && x.path === '/repos/acme/shop/pulls/4')).toHaveLength(1);
  });
});
