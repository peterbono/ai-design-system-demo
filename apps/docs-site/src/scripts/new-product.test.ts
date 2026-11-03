// Start a new product on GitHub (scripts/new-product.ts): the starter is generated into the account with the viewer's
// own sign-in, Bridge waits until its branch answers, then links it to the library (best effort).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { READY_MAX_MS, TEMPLATE_REPO } from '../lib/new-product';

const gh = vi.hoisted(() => ({ write: vi.fn(), get: vi.fn() }));
vi.mock('./github-session', () => ({
  ghWrite: (...a: unknown[]) => gh.write(...a),
  ghGet: (...a: unknown[]) => gh.get(...a),
  readRepo: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main' }),
}));

import { linkProductCode, startProductCode } from './new-product';

beforeEach(() => {
  gh.write.mockReset();
  gh.get.mockReset();
});

describe('startProductCode', () => {
  it('generates the starter in the account, private, and waits until its branch answers', async () => {
    gh.write.mockResolvedValue({ full_name: 'acme/shop', name: 'shop', default_branch: 'main' });
    gh.get.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 })).mockResolvedValue({ data: { name: 'main' } });
    const sleep = vi.fn(async () => undefined);
    const repo = await startProductCode({ owner: 'acme', slug: 'shop', name: 'Shop' }, { sleep });
    expect(gh.write).toHaveBeenCalledWith('POST', `/repos/${TEMPLATE_REPO}/generate`, expect.objectContaining({ owner: 'acme', name: 'shop', private: true, include_all_branches: false }));
    expect(gh.get).toHaveBeenCalledWith('/repos/acme/shop/branches/main', { fresh: true });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(repo).toEqual({ full: 'acme/shop', name: 'shop', defaultBranch: 'main' });
  });

  it('stops waiting after READY_MAX_MS', async () => {
    gh.write.mockResolvedValue({ full_name: 'acme/shop', name: 'shop', default_branch: 'main' });
    gh.get.mockRejectedValue(new Error('Not Found'));
    let t = 0;
    const repo = await startProductCode({ owner: 'acme', slug: 'shop', name: 'Shop' }, { now: () => t, sleep: async (ms) => void (t += ms) });
    expect(t).toBeGreaterThanOrEqual(READY_MAX_MS);
    expect(repo.full).toBe('acme/shop');
  });

  it("throws GitHub's refusal untouched", async () => {
    const refusal = Object.assign(new Error('name already exists on this account'), { status: 422 });
    gh.write.mockRejectedValue(refusal);
    await expect(startProductCode({ owner: 'acme', slug: 'shop', name: 'Shop' })).rejects.toBe(refusal);
  });
});

describe('linkProductCode', () => {
  const repo = { full: 'acme/shop', name: 'shop', defaultBranch: 'main' };

  it("writes .bridge/product.json over the starter's own", async () => {
    gh.get.mockResolvedValue({ data: { sha: 'abc' } });
    gh.write.mockResolvedValue({});
    expect(await linkProductCode(repo, 'shop')).toBe(true);
    const [method, path, body] = gh.write.mock.calls[0]! as [string, string, { content: string; sha: string; branch: string }];
    expect([method, path, body.sha, body.branch]).toEqual(['PUT', '/repos/acme/shop/contents/.bridge/product.json', 'abc', 'main']);
    expect(JSON.parse(atob(body.content))).toEqual({ version: 1, designSystem: 'acme/ds', product: 'shop' });
  });

  it('is best effort: false when GitHub refuses', async () => {
    gh.get.mockRejectedValue(new Error('Not Found'));
    gh.write.mockRejectedValue(Object.assign(new Error('Resource not accessible by integration'), { status: 403 }));
    expect(await linkProductCode(repo, 'shop')).toBe(false);
  });
});
