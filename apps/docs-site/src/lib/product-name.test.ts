import { describe, expect, it } from 'vitest';
import { productNameProblem, productNameProposal, withProductName, PRODUCT_NAME_WORDS } from './product-name';

const config = `{
  "version": 1,
  "name": "Acme",
  "products": [
    { "key": "admin", "name": "Admin demo" },
    {
      "key": "shop",
      "name": "Art print shop",
      "repo": "acme/shop"
    }
  ],
  "other": [1, 2]
}
`;

const products = [
  { key: 'admin', name: 'Admin demo' },
  { key: 'shop', name: 'Art print shop' },
];

describe('product name', () => {
  it('checks what an admin typed and says how to fix it', () => {
    expect(productNameProblem('   ', 'Art print shop', products, 'shop')).toBe('Type a name for the product.');
    expect(productNameProblem('x'.repeat(61), 'Art print shop', products, 'shop')).toBe('Keep it to 60 characters.');
    expect(productNameProblem(' Art  print shop ', 'Art print shop', products, 'shop')).toMatch(/different name/);
    expect(productNameProblem('admin DEMO', 'Art print shop', products, 'shop')).toBe('Another product already has this name. Pick a different one.');
    expect(productNameProblem('Print shop', 'Art print shop', products, 'shop')).toBeNull();
    expect(productNameProblem('x'.repeat(60), 'Art print shop', products, 'shop')).toBeNull();
  });

  it('changes only products[i].name, the rest byte for byte', () => {
    const next = withProductName(config, 'shop', '  Print   shop ');
    expect(next).toBe(config.replace('"name": "Art print shop"', '"name": "Print shop"'));
    expect(withProductName(config, 'admin', 'Back office')).toBe(config.replace('"key": "admin", "name": "Admin demo"', '"key": "admin", "name": "Back office"'));
    expect(withProductName(config, 'shop', 'Art print shop')).toBe(config);
    expect(() => withProductName(config, 'nope', 'X')).toThrow();
    expect(() => withProductName('{ "version": 1 }', 'shop', 'X')).toThrow();
  });

  it('opens a pull request named for the rename, configuration only', () => {
    const p = productNameProposal({ key: 'shop', from: 'Art print shop', to: 'Print shop' }, { date: new Date('2026-10-31T10:00:00Z'), prefix: 'bridge/', tierLabel: 'Tier 3 (guardrail)' });
    expect(p.branch).toBe('bridge/product-name-shop-20261031');
    expect(p.title).toBe('chore(config): rename the product "Art print shop" to "Print shop"');
    expect(p.body).toContain('products[key=shop].name');
    expect(p.body).toContain('Tier 3 (guardrail)');
  });

  it('speaks Bridge, no em dash', () => {
    expect(JSON.stringify(PRODUCT_NAME_WORDS) + PRODUCT_NAME_WORDS.rename('Shop')).not.toMatch(/\u2014|pull request|merge(?!d)/i);
  });
});
