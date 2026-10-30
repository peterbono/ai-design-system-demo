import { describe, expect, it } from 'vitest';
import { buildFromConfig } from './config';
import { studioChangeUrl } from './session';

const config = {
  repo: { owner: 'peterbono', name: 'ai-design-system-demo', defaultBranch: 'main' },
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
      repo: 'peterbono/bridge-product-admin',
      preview: 'https://bridge-product-admin-git-{branch}-peterbonos-projects.vercel.app',
      production: 'https://bridge-product-admin.vercel.app',
    },
  ],
};

describe('buildFromConfig', () => {
  it('reads a product with its own repository: its pull requests, production and preview', () => {
    const b = buildFromConfig(config, 'peterbono/ai-design-system-demo', 'admin-app');
    expect(b).toMatchObject({
      owner: 'peterbono',
      repo: 'bridge-product-admin',
      studio: 'https://bridge.floriangouloubi.com',
      production: 'https://bridge-product-admin.vercel.app',
      preview: 'https://bridge-product-admin-git-{branch}-peterbonos-projects.vercel.app',
      product: 'admin-app',
      ds: 'peterbono/ai-design-system-demo',
      deployEnv: null,
    });
  });

  it('reads a product of the design system repository from previews when it has no URLs of its own', () => {
    const b = buildFromConfig({ ...config, products: [{ key: 'admin', name: 'Admin demo', path: 'apps/admin' }] }, 'peterbono/ai-design-system-demo', 'admin');
    expect(b).toMatchObject({ owner: 'peterbono', repo: 'ai-design-system-demo', production: 'https://bridge-demo.floriangouloubi.com', preview: 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app' });
  });

  it('lets the product override the config, null included', () => {
    const b = buildFromConfig(config, 'peterbono/ai-design-system-demo', 'admin-app', { production: 'https://shop.example.com', studio: null, deployEnv: 'preview' });
    expect(b).toMatchObject({ production: 'https://shop.example.com', studio: null, deployEnv: 'preview' });
  });

  it('says nothing for an unknown product, a broken config or a repository that is not owner/name', () => {
    expect(buildFromConfig(config, 'peterbono/ai-design-system-demo', 'nope')).toBeNull();
    expect(buildFromConfig(null, 'peterbono/ai-design-system-demo', 'admin')).toBeNull();
    expect(buildFromConfig(config, 'not a repo', 'admin')).toBeNull();
  });
});

describe('studioChangeUrl', () => {
  it('opens a design system change by pull request and a product exploration by exploration and product', () => {
    const ds = buildFromConfig(config, 'peterbono/ai-design-system-demo', 'admin')!;
    const own = buildFromConfig(config, 'peterbono/ai-design-system-demo', 'admin-app')!;
    expect(studioChangeUrl(ds, 12)).toBe('https://bridge.floriangouloubi.com/studio/changes/?pr=12');
    expect(studioChangeUrl(own, 3)).toBe('https://bridge.floriangouloubi.com/studio/changes/?exploration=3&product=admin-app');
    expect(studioChangeUrl({ ...own, studio: null }, 3)).toBe('https://github.com/peterbono/bridge-product-admin/pull/3');
  });
});
