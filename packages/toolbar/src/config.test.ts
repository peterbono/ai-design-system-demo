import { describe, expect, it } from 'vitest';
import { buildFromConfig } from './config';
import { studioChangeUrl } from './session';

const config = {
  repo: { owner: 'the-bridge-company', name: 'ai-design-system-demo', defaultBranch: 'main' },
  tokens: { root: 'packages/tokens/src' },
  previews: {
    apps: { admin: 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app' },
    production: { docs: 'https://bridge.floriangouloubi.com', admin: 'https://bridge-demo.floriangouloubi.com' },
  },
  products: [
    { key: 'admin', name: 'Admin demo', path: 'apps/admin', preview: 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app' },
    {
      key: 'admin-app',
      name: 'Product admin',
      repo: 'the-bridge-company/art-print-shop',
      preview: 'https://bridge-product-admin-git-{branch}-peterbonos-projects.vercel.app',
      production: 'https://bridge-product-admin.vercel.app',
    },
  ],
};

describe('buildFromConfig', () => {
  it('reads a product with its own repository: its pull requests, production and preview', () => {
    const b = buildFromConfig(config, 'the-bridge-company/ai-design-system-demo', 'admin-app');
    expect(b).toMatchObject({
      owner: 'the-bridge-company',
      repo: 'art-print-shop',
      studio: 'https://bridge.floriangouloubi.com',
      production: 'https://bridge-product-admin.vercel.app',
      preview: 'https://bridge-product-admin-git-{branch}-peterbonos-projects.vercel.app',
      product: 'admin-app',
      ds: 'the-bridge-company/ai-design-system-demo',
      deployEnv: null,
    });
  });

  it('reads a product of the design system repository from previews when it has no URLs of its own', () => {
    const b = buildFromConfig({ ...config, products: [{ key: 'admin', name: 'Admin demo', path: 'apps/admin' }] }, 'the-bridge-company/ai-design-system-demo', 'admin');
    expect(b).toMatchObject({ owner: 'the-bridge-company', repo: 'ai-design-system-demo', production: 'https://bridge-demo.floriangouloubi.com', preview: 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app' });
  });

  it("a deploy of the design team's copy reads the copy and its previews; any other repository changes nothing", () => {
    const withCopy = { ...config, products: [{ ...config.products[1]!, design: { repo: 'the-bridge-company/art-print-shop-design', preview: 'https://aps-design-git-{branch}.vercel.app' } }] };
    expect(buildFromConfig(withCopy, 'the-bridge-company/ai-design-system-demo', 'admin-app', { repo: 'The-Bridge-Company/art-print-shop-design' })).toMatchObject({
      owner: 'the-bridge-company',
      repo: 'art-print-shop-design',
      preview: 'https://aps-design-git-{branch}.vercel.app',
    });
    expect(buildFromConfig(withCopy, 'the-bridge-company/ai-design-system-demo', 'admin-app', { repo: 'someone/else' })).toMatchObject({ repo: 'art-print-shop', preview: 'https://bridge-product-admin-git-{branch}-peterbonos-projects.vercel.app' });
    expect(buildFromConfig(withCopy, 'the-bridge-company/ai-design-system-demo', 'admin-app')).toMatchObject({ repo: 'art-print-shop' });
  });

  it('lets the product override the config, null included', () => {
    const b = buildFromConfig(config, 'the-bridge-company/ai-design-system-demo', 'admin-app', { production: 'https://shop.example.com', studio: null, deployEnv: 'preview' });
    expect(b).toMatchObject({ production: 'https://shop.example.com', studio: null, deployEnv: 'preview' });
  });

  it('says nothing for an unknown product, a broken config or a repository that is not owner/name', () => {
    expect(buildFromConfig(config, 'the-bridge-company/ai-design-system-demo', 'nope')).toBeNull();
    expect(buildFromConfig(null, 'the-bridge-company/ai-design-system-demo', 'admin')).toBeNull();
    expect(buildFromConfig(config, 'not a repo', 'admin')).toBeNull();
  });
});

describe('studioChangeUrl', () => {
  it('opens a design system change by pull request and a product exploration by exploration and product', () => {
    const ds = buildFromConfig(config, 'the-bridge-company/ai-design-system-demo', 'admin')!;
    const own = buildFromConfig(config, 'the-bridge-company/ai-design-system-demo', 'admin-app')!;
    expect(studioChangeUrl(ds, 12)).toBe('https://bridge.floriangouloubi.com/studio/changes/?pr=12');
    expect(studioChangeUrl(own, 3)).toBe('https://bridge.floriangouloubi.com/studio/changes/?exploration=3&product=admin-app');
    expect(studioChangeUrl({ ...own, studio: null }, 3)).toBe('https://github.com/the-bridge-company/art-print-shop/pull/3');
  });
});
