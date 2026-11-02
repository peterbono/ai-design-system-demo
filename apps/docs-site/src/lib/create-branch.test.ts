import { describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCTS, productMarks, productOfBranch, type ProductConfig } from '@bridge-ds/core';
import { adminBlockedFix, askAdmin, blockIsAdmins, claudePrompt,
  connectorPrompt, featureHref, featureName, featurePurpose, featureProblems, featureProducts, featureRepo, initialTarget, LIBRARY_TARGET,
  libraryLead, productParam, productRepoBlockedLine, startTargets } from './create-branch';

const THREE: ProductConfig[] = [
  { key: 'admin', name: 'Admin demo', path: 'apps/admin' },
  { key: 'shop', name: 'Shop', repo: 'acme/shop' },
  { key: 'library', name: 'Library', path: 'packages', default: true },
];

describe('start an exploration, in a product or the library', () => {
  it('builds features in every product but the library', () => {
    expect(featureProducts(THREE).map((p) => p.key)).toEqual(['admin', 'shop']);
    expect(featureProducts(DEFAULT_PRODUCTS).map((p) => p.key)).toEqual(['admin']);
    expect(featureProducts([{ key: 'library', name: 'Library', default: true }])).toEqual([]);
    expect(featureProducts([])).toEqual([]);
  });

  it('starts in every product, then the library, one line under the library', () => {
    const t = startTargets(THREE);
    expect(t.map((x) => [x.value, x.label, x.library])).toEqual([
      ['admin', 'Admin demo', false],
      ['shop', 'Shop', false],
      ['library', 'The library', true],
    ]);
    expect(t[2]!.description).toBe('Change a token, a component or its guidance in the design system.');
    expect(LIBRARY_TARGET.label).toBe('The library');
    expect(startTargets([{ key: 'ds', name: 'Design system', default: true }]).map((x) => x.label)).toEqual(['The library']);
    expect(startTargets([])).toEqual([]);
  });

  it('keeps the library for a lead: a designer of the team gets the products, a team with no product keeps the library', () => {
    expect(startTargets(THREE, { library: false }).map((x) => x.value)).toEqual(['admin', 'shop']);
    expect(startTargets([{ key: 'ds', name: 'Design system', default: true }], { library: false }).map((x) => x.label)).toEqual(['The library']);
    expect(libraryLead({ write: true, contributor: false })).toBe(true);
    expect(libraryLead({ write: true, contributor: true, admin: true })).toBe(true);
    expect(libraryLead({ write: true, contributor: true })).toBe(false);
    expect(libraryLead({ write: false })).toBe(false);
    expect(libraryLead(null)).toBe(false);
    expect(libraryLead(null, true)).toBe(true);
  });

  it('preselects the target the page came from, else the only product, else the library when there is no product', () => {
    const t = startTargets(THREE);
    expect(initialTarget(t, 'shop')).toBe('shop');
    expect(initialTarget(t, 'Admin demo')).toBe('admin');
    expect(initialTarget(t, 'library')).toBe('library');
    expect(initialTarget(t, null)).toBeNull();
    expect(initialTarget(startTargets(DEFAULT_PRODUCTS), null)).toBe('admin');
    expect(initialTarget(startTargets([{ key: 'ds', name: 'Design system', default: true }]), null)).toBe('ds');
    expect(initialTarget(startTargets([{ key: 'ds', name: 'Design system', default: true }]), 'library')).toBe('ds');
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

  it('never copies the name into the purpose: the sentence is the purpose only when the name had to be cut', () => {
    expect(featurePurpose('create a scenario')).toBe('');
    expect(featurePurpose('  Billing screen with overdue invoices. ')).toBe('');
    const long = 'A billing screen that lists every overdue invoice with reminders and a bulk pay action';
    expect(featurePurpose(long)).toBe(long);
  });

  it('says how to fix each field', () => {
    const choices = startTargets(THREE);
    expect(featureProblems({ product: 'admin', sentence: 'Billing screen', jira: '' }, choices)).toEqual({});
    expect(featureProblems({ product: 'admin', sentence: 'Billing screen', jira: 'ds-42' }, choices)).toEqual({});
    const p = featureProblems({ product: null, sentence: '  ', jira: 'nope' }, choices);
    expect(p.product).toBe('Pick a product or the library.');
    expect(p.sentence).toMatch(/Say what you want to explore/);
    expect(p.jira).toMatch(/like DS-42/);
    expect(featureProblems({ product: 'library', sentence: 'Pill buttons', jira: '' }, choices)).toEqual({});
    expect(featureProblems({ product: 'nope', sentence: 'x', jira: '' }, choices).product).toBeDefined();
    expect(featureProblems({ product: 'admin', sentence: '### --', jira: '' }, choices).sentence).toMatch(/letters or digits/);
  });

  it('hands off to Claude with one line that sets it up and hands control back, and lands on the branch', () => {
    const line = claudePrompt({ sentence: 'Billing screen with overdue invoices', product: THREE[0]!, number: 160 });
    expect(line).toBe('Open Bridge exploration #160 "Billing screen with overdue invoices" in Admin demo (apps/admin) and use the Bridge library. I\'ll tell you what to explore.');
    expect(line).not.toMatch(/missing|Build|\u2014/);
    expect(claudePrompt({ sentence: 'Cart', product: THREE[1]!, number: 3 })).toContain('"Cart" in Shop (acme/shop) and use');
    expect(claudePrompt({ sentence: 'x', product: { key: 'k', name: 'K' }, number: 1 })).toContain('"x" in K and use');
    expect(claudePrompt({ sentence: 'Pill buttons', product: THREE[2]!, number: 7, library: true })).toBe('Open Bridge exploration #7 "Pill buttons" in the Bridge library. I\'ll tell you what to explore.');
    expect(featureHref(160)).toBe('/studio/changes/?exploration=160');
    expect(featureHref(2, 'admin-app')).toBe('/studio/changes/?exploration=2&product=admin-app');
  });

  it('names the design team\'s copy and the branch, never the developers\' repository', () => {
    const shop: ProductConfig = { key: 'admin-app', name: 'Art print shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' } };
    const line = claudePrompt({ sentence: 'Orders empty state', product: shop, number: 2, copy: { repo: 'acme/shop-design', branch: 'explore/orders-empty-state' } });
    expect(line).toBe('Open Bridge exploration admin-app#2 "Orders empty state" in the design team\'s copy of Art print shop (acme/shop-design, branch explore/orders-empty-state) and use the Bridge library. I\'ll tell you what to explore.');
    expect(line).not.toContain('(acme/shop)');
  });

  it('the Claude app line (through the connector) names only the exploration: no repository, no branch', () => {
    const shop: ProductConfig = { key: 'admin-app', name: 'Art print shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' } };
    const line = connectorPrompt({ sentence: 'add a toast alert', product: shop, number: 4, copy: { repo: 'acme/shop-design', branch: 'explore/add-a-toast-alert' } });
    expect(line).toBe('Open Bridge exploration admin-app#4 "add a toast alert" and use the Bridge library. I\'ll tell you what to explore.');
    expect(line).not.toMatch(/acme|branch|explore\//);
    // Without a design copy it is the same line as before.
    expect(connectorPrompt({ sentence: 'Cart', product: THREE[1]!, number: 3 })).toBe(claudePrompt({ sentence: 'Cart', product: THREE[1]!, number: 3 }));
  });

  it('labels a feature so the Branches page groups it under its product (core rule)', () => {
    const labels = productMarks(THREE, THREE[1]!).labels;
    expect(productOfBranch(THREE, { files: null, labels: ['exploration', ...labels] }).key).toBe('shop');
  });
});

describe('where a feature starts', () => {
  it('in the product repository when the team connected one, else the design system repository', () => {
    expect(featureRepo(THREE[1]!, 'acme/ds')).toBe('acme/shop');
    // The Admin demo lives in the design system repository: the exploration stays there.
    expect(featureRepo(THREE[0]!, 'acme/ds')).toBeNull();
    expect(featureRepo({ key: 'ds', name: 'Docs', repo: 'acme/ds' }, 'acme/ds')).toBeNull();
  });

  it("never tells an admin to ask an admin: the block is theirs to set up (regression: Priya, an email admin, read 'Ask an admin to let you in')", () => {
    // An email admin whose design copy Bridge cannot open, and any admin when Bridge is not connected: their own fix.
    expect(blockIsAdmins({ admin: true, email: true, reason: 'read-only' })).toBe(true);
    expect(blockIsAdmins({ admin: true, email: false, reason: 'not-connected' })).toBe(true);
    expect(blockIsAdmins({ admin: true, email: true, reason: 'not-connected' })).toBe(true);
    // A GitHub admin without push on the developers' repository still asks for access there; designers always ask.
    expect(blockIsAdmins({ admin: true, email: false, reason: 'read-only' })).toBe(false);
    expect(blockIsAdmins({ admin: false, email: true, reason: 'read-only' })).toBe(false);
    expect(blockIsAdmins({ admin: false, email: false, reason: 'not-connected' })).toBe(false);
    expect(blockIsAdmins({ admin: true, email: true, reason: 'no-copy' })).toBe(false);
    const copy = adminBlockedFix('Art print shop', 'read-only');
    expect(copy).toEqual({ line: 'Bridge cannot open the design copy of Art print shop yet. Set Bridge up on it, then start again.', label: 'Set up Bridge on Art print shop' });
    expect(adminBlockedFix('Shop', 'not-connected')).toEqual({ line: 'Bridge is not connected to Shop yet. Connect it, then start again.', label: 'Connect Shop' });
    for (const r of ['read-only', 'not-connected'] as const) expect(Object.values(adminBlockedFix('Shop', r)).join(' ')).not.toMatch(/Ask an admin|token|repository|404|403|\u2014/);
  });

  it('says plainly when Bridge cannot reach the product, with the admin action and no technical words', () => {
    const line = productRepoBlockedLine('Shop', 'not-connected');
    // The library is the leads' (#704): only a lead is offered it.
    expect(line).toBe('Bridge is not connected to Shop yet. Ask an admin to connect it.');
    expect(productRepoBlockedLine('Shop', 'not-connected', true)).toBe('Bridge is not connected to Shop yet. Ask an admin to connect it, or start it in the library for now.');
    expect(productRepoBlockedLine('Shop', 'read-only')).toBe('You can look at Shop but not explore it yet. Ask an admin to let you in.');
    expect(productRepoBlockedLine('Shop', 'read-only', true)).toBe('You can look at Shop but not explore it yet. Ask an admin to let you in, or start it in the library for now.');
    for (const l of [line, productRepoBlockedLine('Shop', 'read-only')]) expect(l).not.toMatch(/token|repository|GitHub|404|403|\u2014/);
    const ask = askAdmin('Shop', 'acme/shop', 'not-connected', 'https://github.com/apps/bridge/installations/new');
    expect(ask.label).toBe('Ask an admin to connect Shop');
    expect(ask.message).toContain('Install Bridge on github.com/acme/shop (https://github.com/apps/bridge/installations/new, pick shop)');
    expect(askAdmin('Shop', 'acme/shop', 'read-only', 'x').label).toBe('Ask an admin for access');
    // Someone who joined with their email gets in through a design copy, never GitHub access.
    const email = askAdmin('Shop', 'acme/shop', 'read-only', 'x', true);
    expect(email.label).toBe('Ask an admin to let you in');
    expect(email.message).toBe('Hi, can you set up a design copy of Shop in Bridge? I want to explore Shop there.');
    expect(email.message).not.toMatch(/github|\u2014/i);
    expect(ask.message).not.toMatch(/\u2014/);
  });
});
