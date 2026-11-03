import { describe, expect, it } from 'vitest';
import {
  CLOUDFLARE_IMPORT_URL,
  NEW_PRODUCT_WORDS as W,
  addressLine,
  askOwnerMessage,
  newProductProblem,
  ownersFrom,
  productPointer,
  refusalLine,
  slugFor,
  startRefusal,
  vercelImportUrl,
} from './new-product';

describe('Start a new product: rules and words', () => {
  it('makes a GitHub name from the product name', () => {
    expect(slugFor('Art print shop')).toBe('art-print-shop');
    expect(slugFor('  Café & Crème  ')).toBe('cafe-creme');
    expect(slugFor('Back_office 2')).toBe('back-office-2');
    expect(slugFor('!!!')).toBe('');
    expect(slugFor('a'.repeat(80))).toHaveLength(60);
    expect(slugFor(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59));
  });

  it('says its address in plain words', () => {
    expect(addressLine('acme', 'shop')).toBe('Its address: acme/shop');
    expect(addressLine('acme', '')).toBe('Its address: acme/…');
  });

  it("lists where it can live: the team's account first, each account once", () => {
    expect(ownersFrom('acme', [{ full: 'Acme/shop' }, { full: 'studio/site' }, { full: 'studio/app' }])).toEqual(['acme', 'studio']);
    expect(ownersFrom(null, [])).toEqual([]);
    expect(ownersFrom('', [{ full: 'studio/site' }])).toEqual(['studio']);
  });

  it('checks the name and the place before GitHub is asked', () => {
    const products = [{ name: 'Shop', repo: 'acme/shop' }, { name: 'Site', repo: 'acme/site', design: { repo: 'acme/new-thing' } }];
    expect(newProductProblem({ name: ' ', owner: 'acme' }, products)).toBe('Type a name for the product.');
    expect(newProductProblem({ name: '***', owner: 'acme' }, products)).toBe('Use at least one letter or digit in the name.');
    expect(newProductProblem({ name: 'shop', owner: 'acme' }, products)).toMatch(/already has this name/);
    expect(newProductProblem({ name: 'New thing', owner: 'acme' }, products)).toMatch(/already lists a product at this address/);
    expect(newProductProblem({ name: 'Checkout', owner: null }, products)).toBe('Pick where it lives.');
    expect(newProductProblem({ name: 'Checkout', owner: 'acme' }, products)).toBeNull();
  });

  it('opens the hosts on their own pages, nothing secret in the links', () => {
    expect(vercelImportUrl('acme/art-print-shop')).toBe('https://vercel.com/new/import?s=https%3A%2F%2Fgithub.com%2Facme%2Fart-print-shop');
    expect(CLOUDFLARE_IMPORT_URL).toMatch(/^https:\/\/dash\.cloudflare\.com\//);
  });

  it("reads GitHub's refusal", () => {
    expect(startRefusal({ status: 422, message: 'Repository creation failed.', detail: 'name already exists on this account' })).toBe('taken');
    expect(startRefusal({ status: 422, message: 'Repository creation failed.' })).toBe('taken');
    expect(startRefusal({ status: 422, message: 'Visibility can only be public' })).toBe('other');
    expect(startRefusal({ status: 403, detail: 'Resource not accessible by integration' })).toBe('app-permission');
    expect(startRefusal({ status: 403, detail: 'You need admin access to the organization before adding a repository to it.' })).toBe('no-permission');
    expect(startRefusal({ status: 404, detail: 'Not Found' })).toBe('no-permission');
    expect(startRefusal({ status: 429 })).toBe('busy');
    expect(startRefusal({ status: 403, detail: 'API rate limit exceeded' })).toBe('busy');
    expect(startRefusal({ status: 500 })).toBe('other');
    expect(startRefusal(null)).toBe('other');
  });

  it('says each refusal in designer words, with the ask-an-owner message when an owner decides', () => {
    const x = { owner: 'acme', slug: 'shop', name: 'Shop' };
    expect(refusalLine('taken', x)).toEqual({ line: 'acme already has something called shop. Pick a different name.' });
    const app = refusalLine('app-permission', x);
    expect(app.ask?.label).toBe('Ask an owner of acme');
    expect(app.ask?.message).toBe(askOwnerMessage('acme', 'app-permission', 'Shop'));
    expect(refusalLine('no-permission', x).ask?.message).toMatch(/let me create products in acme/);
    expect(refusalLine('busy', x).ask).toBeUndefined();
    const all = [...Object.values(W).map((v) => (typeof v === 'function' ? v('Shop') : v)), ...(['taken', 'app-permission', 'no-permission', 'busy', 'other'] as const).flatMap((k) => {
      const r = refusalLine(k, x);
      return [r.line, r.ask?.label ?? ''];
    })].join(' ');
    expect(all).not.toMatch(/repositor|template|fork|config|token|—/i);
  });

  it('writes the same link to the library that bridge connect writes', () => {
    expect(JSON.parse(productPointer('acme/ds', 'shop'))).toEqual({ version: 1, designSystem: 'acme/ds', product: 'shop' });
  });
});
