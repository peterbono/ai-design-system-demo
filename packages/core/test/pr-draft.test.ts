import { describe, expect, it } from 'vitest';
import { GitHubClient, type FetchLike } from '../src/github-client';

const once = { attempts: 1, baseDelayMs: 0, sleep: async () => undefined };

/** A pull request read and the GraphQL endpoint, recording what was sent. */
function fake(pr: { node_id?: string; draft?: boolean; state?: string }, graphql: unknown = { data: { convertPullRequestToDraft: { pullRequest: { number: 7, isDraft: true } } } }) {
  const calls: { url: string; body: unknown }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = url.endsWith('/graphql') ? graphql : pr;
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
  };
  return { calls, client: (token = 't') => new GitHubClient('acme/ds', token, f, once) };
}

describe('convertToDraft', () => {
  it('sends convertPullRequestToDraft with the node id of the pull request', async () => {
    const gh = fake({ node_id: 'PR_7', draft: false, state: 'open' });
    await gh.client().convertToDraft(7);
    const mutation = gh.calls.find((c) => c.url.endsWith('/graphql'));
    expect(mutation?.body).toMatchObject({ variables: { id: 'PR_7' } });
    expect(JSON.stringify(mutation?.body)).toContain('convertPullRequestToDraft');
  });

  it('does nothing for a draft, and refuses a closed pull request', async () => {
    const draft = fake({ node_id: 'PR_7', draft: true, state: 'open' });
    await draft.client().convertToDraft(7);
    expect(draft.calls.some((c) => c.url.endsWith('/graphql'))).toBe(false);
    await expect(fake({ node_id: 'PR_7', draft: false, state: 'closed' }).client().convertToDraft(7)).rejects.toThrow(/only an open one/);
  });

  it('reports GraphQL errors with what to do instead, and needs a token', async () => {
    const gh = fake({ node_id: 'PR_7', draft: false, state: 'open' }, { errors: [{ message: 'Resource not accessible by personal access token' }] });
    await expect(gh.client().convertToDraft(7)).rejects.toThrow(/Resource not accessible[\s\S]*Convert to draft/);
    await expect(gh.client('').convertToDraft(7)).rejects.toThrow(/needs a GitHub token/);
  });
});
