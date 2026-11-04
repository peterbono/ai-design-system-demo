// @vitest-environment jsdom
// What Add a product reads on GitHub (scripts/add-product.ts): the installation the GitHub step opens, found under the
// team's current or old name, and the team's own account id when there is none, so the step never lands on GitHub's
// "Where do you want to install?" while the team's account is known.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gh = vi.hoisted(() => ({
  mode: 'app' as 'app' | 'token',
  owner: 'the-bridge-company',
  answers: {} as Record<string, unknown>,
  fails: new Set<string>(),
  calls: [] as string[],
}));

vi.mock('./github-session', () => {
  class GitHubError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  class RateLimitError extends Error {
    constructor(public resetAt: Date | null) {
      super('busy');
    }
  }
  return {
    GitHubError,
    RateLimitError,
    currentViewer: () => ({ login: 'peterbono' }),
    readRepo: () => ({ owner: gh.owner, repo: 'ai-design-system-demo', defaultBranch: 'main' }),
    sessionMode: () => gh.mode,
    ghGet: async (path: string) => {
      gh.calls.push(path);
      const key = path.split('?')[0]!;
      if (gh.fails.has(key)) throw new GitHubError(500, `GitHub answered 500 for ${path}`);
      if (!(key in gh.answers)) throw new GitHubError(404, `GitHub answered 404 for ${path}`);
      return { data: gh.answers[key], stale: false };
    },
  };
});

const ORG = { login: 'the-bridge-company', id: 351104414, type: 'Organization' };
const load = () => import('./add-product');

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  gh.mode = 'app';
  gh.owner = 'the-bridge-company';
  gh.fails = new Set();
  gh.calls = [];
  gh.answers = {
    // The library itself, as the page reads it: its owner carries the account's id.
    '/repos/the-bridge-company/ai-design-system-demo': { full_name: 'the-bridge-company/ai-design-system-demo', owner: ORG },
    '/orgs/the-bridge-company': ORG,
    '/user/repos': [],
  };
});
afterEach(() => localStorage.clear());

describe('readProductAccess', () => {
  it("finds the team's installation even when GitHub still lists it under the account's old name", async () => {
    gh.answers['/user/installations'] = {
      installations: [
        { id: 1, account: { login: 'someone', type: 'User', id: 5 } },
        { id: 177521165, account: { login: 'art-print-shop-co', type: 'Organization', id: 351104414 } },
      ],
    };
    gh.answers['/user/installations/1/repositories'] = { repositories: [] };
    gh.answers['/user/installations/177521165/repositories'] = { repositories: [{ full_name: 'the-bridge-company/shop', name: 'shop' }] };
    const a = await (await load()).readProductAccess([]);
    expect(a.installation?.id).toBe(177521165);
    expect(a.account).toBe('the-bridge-company');
    expect(a.accountId).toBe(351104414);
    expect(a.repos.map((r) => r.full)).toEqual(['the-bridge-company/shop']);
  });

  it("with no installation, still knows the team's account id (the GitHub step goes straight to it)", async () => {
    gh.answers['/user/installations'] = { installations: [] };
    const a = await (await load()).readProductAccess([]);
    expect(a.installation).toBeNull();
    expect(a.account).toBe('the-bridge-company');
    expect(a.accountId).toBe(351104414);
    expect(gh.calls).toContain('/repos/the-bridge-company/ai-design-system-demo');
    // Never Bridge's people read, which answers names and photos only.
    expect(gh.calls.some((c) => c.startsWith('/users/'))).toBe(false);
  });

  it('signed in with a token of their own: no installation list, the account id all the same', async () => {
    gh.mode = 'token';
    gh.answers['/user/repos'] = [{ full_name: 'the-bridge-company/shop', name: 'shop' }, { full_name: 'the-bridge-company/ai-design-system-demo', name: 'ai-design-system-demo' }];
    const a = await (await load()).readProductAccess([{ key: 'shop', name: 'Shop', repo: 'the-bridge-company/shop' } as never]);
    expect(a.installation).toBeNull();
    expect(a.accountId).toBe(351104414);
    expect(a.repos).toEqual([]);
    // One product seen, already in the team: the empty step says so.
    expect(a.seen).toBe(1);
    expect(gh.calls).not.toContain('/user/installations?per_page=100');
  });

  it("an old address of the team reads the account under its current name", async () => {
    gh.owner = 'art-print-shop-co';
    gh.answers['/user/installations'] = { installations: [] };
    const a = await (await load()).readProductAccess([]);
    expect(a.account).toBe('the-bridge-company');
    expect(a.accountId).toBe(351104414);
  });

  it("the library's address from before it moved (peterbono) opens the account it lives in now", async () => {
    gh.owner = 'peterbono';
    gh.answers['/user/installations'] = { installations: [{ id: 177521165, account: { login: 'the-bridge-company', type: 'Organization', id: 351104414 } }, { id: 3, account: { login: 'other', type: 'User', id: 9 } }] };
    gh.answers['/user/installations/177521165/repositories'] = { repositories: [] };
    gh.answers['/user/installations/3/repositories'] = { repositories: [] };
    const a = await (await load()).readProductAccess([]);
    expect(a.installation?.id).toBe(177521165);
    expect(a.account).toBe('the-bridge-company');
  });
});

describe('readOwnerAccount and teamAccount', () => {
  it("asks GitHub once, then keeps the id in this browser", async () => {
    const m = await load();
    expect(await m.readOwnerAccount()).toEqual({ id: 351104414, type: 'Organization' });
    vi.resetModules();
    gh.calls = [];
    const again = await load();
    expect(await again.readOwnerAccount()).toEqual({ id: 351104414, type: 'Organization' });
    expect(gh.calls).toEqual([]);
  });

  it("the library not readable: the organization's public page says it", async () => {
    gh.fails.add('/repos/the-bridge-company/ai-design-system-demo');
    expect(await (await load()).readOwnerAccount()).toEqual({ id: 351104414, type: 'Organization' });
    expect(gh.calls).toContain('/orgs/the-bridge-company');
  });

  it('says nothing when GitHub does not answer, and asks again next time', async () => {
    gh.fails.add('/repos/the-bridge-company/ai-design-system-demo');
    gh.fails.add('/orgs/the-bridge-company');
    const m = await load();
    expect(await m.readOwnerAccount()).toBeNull();
    gh.fails.clear();
    expect((await m.readOwnerAccount())?.id).toBe(351104414);
  });

  it("when the products could not be read, the team's account and its id are still known", async () => {
    gh.fails.add('/user/installations');
    const m = await load();
    await expect(m.readProductAccess([])).rejects.toThrow(/500/);
    expect(await m.teamAccount()).toEqual({ account: 'the-bridge-company', accountId: 351104414 });
  });
});
