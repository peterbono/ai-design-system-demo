import { describe, expect, it } from 'vitest';
import type { ProductConfig } from '@bridge-ds/core';
import { CLOUDFLARE_IMPORT_URL, PREVIEWS_STEP_WORDS as W, vercelImportUrl } from './new-product';
import { codeOf, hasPreviews, hostOf, isTeamAdmin, otherHost, previewsStep, showsPreviewsStep, suggestedHost } from './product-previews';

const poster: ProductConfig = { key: 'poster', name: 'Poster studio', repo: 'acme/poster-studio' };
const shop: ProductConfig = { key: 'shop', name: 'Art print shop', repo: 'acme/shop', preview: 'https://{branch}.shop.pages.dev', production: 'https://shop.pages.dev' };
const admin: ProductConfig = { key: 'admin', name: 'Admin', repo: 'acme/admin', preview: 'https://admin-git-{branch}-acme.vercel.app' };
const library: ProductConfig = { key: 'library', name: 'Library', default: true };
const vercelLibrary = { apps: { docs: 'https://docs-git-{branch}-acme.vercel.app' }, production: { docs: 'https://docs.acme.com' } };

describe('hostOf', () => {
  it('reads the host from the address, templates included', () => {
    expect(hostOf('https://{branch}.shop.pages.dev')).toBe('cloudflare');
    expect(hostOf('https://shop.pages.dev/')).toBe('cloudflare');
    expect(hostOf('https://admin-git-{branch}-acme.vercel.app')).toBe('vercel');
    expect(hostOf('https://ADMIN.VERCEL.APP/path')).toBe('vercel');
  });

  it('knows nothing of a custom domain or a look-alike', () => {
    expect(hostOf('https://shop.acme.com')).toBeNull();
    expect(hostOf('https://pages.dev.acme.com')).toBeNull();
    expect(hostOf('https://notvercel.app')).toBeNull();
    expect(hostOf('')).toBeNull();
    expect(hostOf(undefined)).toBeNull();
    expect(hostOf('shop.pages.dev')).toBeNull();
  });
});

describe('suggestedHost', () => {
  it("names the host the team's other products use", () => {
    expect(suggestedHost(poster, [shop, poster, library], vercelLibrary)).toEqual({ host: 'cloudflare', source: 'products' });
    expect(suggestedHost(poster, [admin, poster, library], null)).toEqual({ host: 'vercel', source: 'products' });
  });

  it("counts a product's design copy and its production address too", () => {
    const copied: ProductConfig = { key: 'copied', name: 'Copied', repo: 'acme/c', design: { repo: 'acme/c-design', preview: 'https://{branch}.c-design.pages.dev' } };
    expect(suggestedHost(poster, [copied, poster], null).host).toBe('cloudflare');
    expect(suggestedHost(poster, [{ key: 'p', name: 'P', production: 'https://p.vercel.app' }, poster], null).host).toBe('vercel');
  });

  it('takes the host most products use, the first one met on a tie', () => {
    const shop2: ProductConfig = { key: 'shop2', name: 'Shop 2', preview: 'https://{branch}.s2.pages.dev' };
    expect(suggestedHost(poster, [admin, shop, shop2, poster], null).host).toBe('cloudflare');
    expect(suggestedHost(poster, [admin, { key: 's', name: 'S', preview: 'https://{branch}.s.pages.dev' }, poster], null).host).toBe('vercel');
  });

  it("never reads the product itself, and falls back to the library's host, then Vercel", () => {
    const cf = { ...poster, preview: 'https://{branch}.poster.pages.dev' };
    expect(suggestedHost(cf, [cf, library], vercelLibrary)).toEqual({ host: 'vercel', source: 'library' });
    expect(suggestedHost(poster, [poster, library], { apps: { docs: 'https://{branch}.docs.pages.dev' } })).toEqual({ host: 'cloudflare', source: 'library' });
    // Custom domains only: nothing to go on.
    expect(suggestedHost(poster, [{ key: 'x', name: 'X', production: 'https://x.acme.com' }, poster, library], { production: { docs: 'https://docs.acme.com' } })).toEqual({ host: 'vercel', source: 'default' });
    expect(suggestedHost(poster, [poster], null)).toEqual({ host: 'vercel', source: 'default' });
  });
});

describe('the step', () => {
  it('sees previews in any preview or production address of the product', () => {
    expect(hasPreviews(poster)).toBe(false);
    expect(hasPreviews(shop)).toBe(true);
    expect(hasPreviews({ ...poster, production: 'https://poster.acme.com' })).toBe(true);
    expect(hasPreviews({ ...poster, design: { repo: 'acme/p-design', preview: 'https://{branch}.p.pages.dev' } })).toBe(true);
    // A product of the library's repository may set its previews under previews.apps / previews.production.
    expect(hasPreviews({ key: 'admin', name: 'Admin', path: 'apps/admin' }, { apps: { admin: 'https://admin-git-{branch}.vercel.app' } })).toBe(true);
    expect(hasPreviews({ key: 'admin', name: 'Admin', path: 'apps/admin' }, { apps: { docs: 'https://docs-git-{branch}.vercel.app' } })).toBe(false);
  });

  it('shows only to an admin of a real team, on a product with no previews yet, never the library', () => {
    expect(showsPreviewsStep({ admin: true, sample: false, product: poster })).toBe(true);
    expect(showsPreviewsStep({ admin: false, sample: false, product: poster })).toBe(false);
    expect(showsPreviewsStep({ admin: true, sample: true, product: poster })).toBe(false);
    expect(showsPreviewsStep({ admin: true, sample: false, product: shop })).toBe(false);
    expect(showsPreviewsStep({ admin: true, sample: false, product: library })).toBe(false);
    expect(showsPreviewsStep({ admin: true, sample: false, product: null })).toBe(false);
  });

  it('counts GitHub admins and team admins, never leads nor members', () => {
    expect(isTeamAdmin({ admin: true })).toBe(true);
    expect(isTeamAdmin({ repoAdmin: true })).toBe(true);
    expect(isTeamAdmin({ admin: false })).toBe(false);
    expect(isTeamAdmin({ admin: false, write: true } as { admin: boolean })).toBe(false);
    expect(isTeamAdmin(null)).toBe(false);
  });

  it("opens the host's own page for the product's code, the design copy first", () => {
    const s = previewsStep(poster, [shop, poster, library], null, 'acme/library');
    expect(s).toEqual({ host: 'cloudflare', source: 'products', connect: CLOUDFLARE_IMPORT_URL, other: vercelImportUrl('acme/poster-studio') });
    expect(previewsStep(poster, [admin, poster], null, null).connect).toBe(vercelImportUrl('acme/poster-studio'));
    expect(codeOf({ ...poster, design: { repo: 'acme/poster-design' } }, 'acme/library')).toBe('acme/poster-design');
    expect(codeOf({ key: 'in', name: 'In', path: 'apps/in' }, 'acme/library')).toBe('acme/library');
    expect(previewsStep({ key: 'in', name: 'In' }, [], null, null).connect).toBe('https://vercel.com/new');
    expect(otherHost('vercel')).toBe('cloudflare');
  });

  it('says it in designer words, never an em dash', () => {
    const lines = (['products', 'library', 'default'] as const).map((source) => W.line({ name: 'Poster studio', host: 'Cloudflare', source }));
    expect(lines[0]).toBe('Your other products show their previews on Cloudflare. Connect Poster studio there too and every exploration gets its own preview.');
    for (const line of [...lines, W.title, W.note, W.connect('Vercel'), W.other('Vercel')]) {
      expect(line).not.toContain('—');
      expect(line).not.toMatch(/repositor|deploy|config|fork|branch/i);
    }
  });
});
