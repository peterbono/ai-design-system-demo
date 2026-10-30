import { describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCTS, productMarks, productOfBranch, type ProductConfig } from '@bridge-ds/core';
import { claudePrompt, featureHref, featureName, featureProblems, featureProducts, firstStep, initialProduct, productParam } from './create-branch';

const THREE: ProductConfig[] = [
  { key: 'admin', name: 'Admin demo', path: 'apps/admin' },
  { key: 'shop', name: 'Shop', repo: 'acme/shop' },
  { key: 'library', name: 'Library', path: 'packages', default: true },
];

describe('create branch, product first', () => {
  it('builds features in every product but the library', () => {
    expect(featureProducts(THREE).map((p) => p.key)).toEqual(['admin', 'shop']);
    expect(featureProducts(DEFAULT_PRODUCTS).map((p) => p.key)).toEqual(['admin']);
    expect(featureProducts([{ key: 'library', name: 'Library', default: true }])).toEqual([]);
    expect(featureProducts([])).toEqual([]);
  });

  it('skips the kind question when only the library exists', () => {
    expect(firstStep(featureProducts(THREE))).toBe('kind');
    expect(firstStep(featureProducts([{ key: 'library', name: 'Library' }]))).toBe('library');
  });

  it('preselects the product the page came from, else the only one, else none', () => {
    const choices = featureProducts(THREE);
    expect(initialProduct(choices, 'shop')).toBe('shop');
    expect(initialProduct(choices, 'Admin demo')).toBe('admin');
    expect(initialProduct(choices, 'library')).toBeNull();
    expect(initialProduct(choices, null)).toBeNull();
    expect(initialProduct(featureProducts(DEFAULT_PRODUCTS), null)).toBe('admin');
    expect(productParam('?product=shop&x=1')).toBe('shop');
    expect(productParam('?product=')).toBeNull();
    expect(productParam('')).toBeNull();
  });

  it('names the work from the sentence, under 60 characters at a word', () => {
    expect(featureName('  Billing screen with overdue invoices. ')).toBe('Billing screen with overdue invoices');
    const long = 'A billing screen that lists every overdue invoice with reminders and a bulk pay action';
    const n = featureName(long);
    expect(n.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(n)).toBe(true);
    expect(n.endsWith(' ')).toBe(false);
  });

  it('says how to fix each field', () => {
    const choices = featureProducts(THREE);
    expect(featureProblems({ product: 'admin', sentence: 'Billing screen', jira: '' }, choices)).toEqual({});
    expect(featureProblems({ product: 'admin', sentence: 'Billing screen', jira: 'ds-42' }, choices)).toEqual({});
    const p = featureProblems({ product: null, sentence: '  ', jira: 'nope' }, choices);
    expect(p.product).toMatch(/Pick the product/);
    expect(p.sentence).toMatch(/Say what you are building/);
    expect(p.jira).toMatch(/like DS-42/);
    expect(featureProblems({ product: 'library', sentence: 'x', jira: '' }, choices).product).toBeDefined();
    expect(featureProblems({ product: 'admin', sentence: '### --', jira: '' }, choices).sentence).toMatch(/letters or digits/);
  });

  it('hands off to Claude with one line that sets it up and hands control back, and lands on the branch', () => {
    const line = claudePrompt({ sentence: 'Billing screen with overdue invoices', product: THREE[0]!, number: 160 });
    expect(line).toBe('Open Bridge exploration #160 "Billing screen with overdue invoices" in Admin demo (apps/admin) and use the Bridge library. I\'ll tell you what to explore.');
    expect(line).not.toMatch(/missing|Build|\u2014/);
    expect(claudePrompt({ sentence: 'Cart', product: THREE[1]!, number: 3 })).toContain('"Cart" in Shop (acme/shop) and use');
    expect(claudePrompt({ sentence: 'x', product: { key: 'k', name: 'K' }, number: 1 })).toContain('"x" in K and use');
    expect(featureHref(160)).toBe('/studio/changes/?exploration=160');
  });

  it('labels a feature so the Branches page groups it under its product (core rule)', () => {
    const labels = productMarks(THREE, THREE[1]!).labels;
    expect(productOfBranch(THREE, { files: null, labels: ['exploration', ...labels] }).key).toBe('shop');
  });
});
