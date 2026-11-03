// @vitest-environment jsdom
// Remove a product from Bridge: only the product's entry leaves bridge.config.json (the rest byte for byte), never the
// library; the pull request says nothing is deleted on GitHub; and the whole path writes that one file through a pull
// request, never a repository delete. Words carry no em dash and no tech jargon for designers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMOVE_PRODUCT_WORDS, removeConfirmMatches, removeProductProposal, withoutProduct } from './remove-product';

const CONFIG = `{
  "version": 1,
  "products": [
    { "key": "admin-app", "name": "Art print shop", "repo": "acme/shop", "framework": "react" },
    { "key": "blog", "name": "Blog", "repo": "acme/blog", "framework": "react" },
    { "key": "library", "name": "Library", "path": "packages", "framework": "react", "default": true }
  ],
  "tooling": { "paths": ["apps/"] }
}
`;

describe('withoutProduct', () => {
  it('drops only the product, the rest of the file as it was', () => {
    const next = withoutProduct(CONFIG, 'ADMIN-APP');
    expect(next).toBe(`{
  "version": 1,
  "products": [
    { "key": "blog", "name": "Blog", "repo": "acme/blog", "framework": "react" },
    { "key": "library", "name": "Library", "path": "packages", "framework": "react", "default": true }
  ],
  "tooling": { "paths": ["apps/"] }
}
`);
  });

  it('never the library, never a product the file does not list', () => {
    expect(() => withoutProduct(CONFIG, 'library')).toThrow('The library stays in Bridge.');
    expect(() => withoutProduct(CONFIG, 'nope')).toThrow('The Bridge settings do not list this product.');
    expect(() => withoutProduct('{ "version": 1 }', 'blog')).toThrow();
  });
});

describe('the proposal and the words', () => {
  it('says nothing is deleted on GitHub', () => {
    const p = removeProductProposal({ key: 'admin-app', name: 'Art print shop', repo: 'acme/shop' }, { date: new Date('2026-11-03T10:00:00Z'), tierLabel: 'Tier 3' });
    expect(p.branch).toBe('product-remove-admin-app-20261103');
    expect(p.title).toBe('chore(config): remove the product "Art print shop" from Bridge');
    expect(p.body).toContain('Nothing is deleted on GitHub');
    expect(p.body).toContain('`acme/shop`');
  });

  it('the confirm matches the exact name only', () => {
    expect(removeConfirmMatches(' Art print shop ', 'Art print shop')).toBe(true);
    expect(removeConfirmMatches('art print shop', 'Art print shop')).toBe(false);
    expect(removeConfirmMatches('', 'Art print shop')).toBe(false);
  });

  it('plain words for designers, no em dash', () => {
    const all = [
      REMOVE_PRODUCT_WORDS.more('Shop'),
      REMOVE_PRODUCT_WORDS.rename,
      REMOVE_PRODUCT_WORDS.remove,
      REMOVE_PRODUCT_WORDS.title('Shop'),
      REMOVE_PRODUCT_WORDS.text('Shop'),
      REMOVE_PRODUCT_WORDS.safe,
      REMOVE_PRODUCT_WORDS.confirmLabel('Shop'),
      REMOVE_PRODUCT_WORDS.sent('Shop'),
      REMOVE_PRODUCT_WORDS.waiting,
    ].join(' ');
    expect(all).not.toContain('—');
    expect(all).not.toMatch(/repository|config|fork|branch|pull request/i);
    expect(REMOVE_PRODUCT_WORDS.safe).toContain('Bridge deletes nothing on GitHub');
  });
});

// The path the product page takes (scripts/roles.ts proposeProductRemoval): a GitHub client that records every call.
const calls: string[] = [];
const committed: { path: string; content: string }[][] = [];
vi.mock('../scripts/github-session', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  getToken: () => 'token',
  readRepo: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main' }),
  studioClient: () =>
    new Proxy(
      {},
      {
        get: (_t, name: string) => {
          if (name === 'then') return undefined;
          return async (arg: { files?: { path: string; content: string }[] }) => {
            calls.push(name);
            if (name === 'getFileText') return CONFIG;
            if (name === 'getBranchSha') return null;
            if (name === 'commitToNewBranch') committed.push(arg.files ?? []);
            if (name === 'createPullRequest') return { number: 7, url: 'https://github.com/acme/ds/pull/7' };
            return true;
          };
        },
      },
    ),
}));

describe('proposeProductRemoval', () => {
  afterEach(() => {
    calls.length = 0;
    committed.length = 0;
    vi.restoreAllMocks();
  });

  it('opens a pull request that changes bridge.config.json only, and never deletes a repository', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
    const { proposeProductRemoval } = await import('../scripts/roles');
    const pr = await proposeProductRemoval({ key: 'admin-app', name: 'Art print shop', repo: 'acme/shop' });
    expect(pr).toEqual({ number: 7, url: 'https://github.com/acme/ds/pull/7' });
    expect(calls).toEqual(['getFileText', 'getBranchSha', 'commitToNewBranch', 'createPullRequest', 'addLabels']);
    expect(calls.some((c) => /delete|remove|archive|transfer/i.test(c))).toBe(false);
    expect(committed).toHaveLength(1);
    expect(committed[0]!.map((f) => f.path)).toEqual(['bridge.config.json']);
    expect(committed[0]![0]!.content).not.toContain('"admin-app"');
    expect(committed[0]![0]!.content).toContain('"library"');
    // Nothing reached GitHub on its own either, let alone a DELETE.
    expect(fetchSpy.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });
});
