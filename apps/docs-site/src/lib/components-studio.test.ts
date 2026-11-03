import { describe, expect, it } from 'vitest';
import { componentsLead, componentsPrimary, drawerActions, drawerFacts, openRequestCounts, productAudits, productUsage, requestFact, thumbnailNode, usedInCell, type LeadInput } from './components-studio';
import { docsEditHref, guidanceState, loadComponents } from './components';
import { exceptions } from '../components/ds/studio/ComponentsList';
import type { ProductConfig } from '@bridge-ds/core';

const row = (slug: string, guidance: LeadInput['guidance'] = 'ok', status: LeadInput['status'] = 'stable'): LeadInput => ({ slug, guidance, status });

describe('Studio Components lead and primary', () => {
  it('says the count, the lifecycle and how many need guidance', () => {
    expect(componentsLead([row('a'), row('b', 'missing'), row('c', 'review')])).toEqual({ status: '3 components, all stable.', guidance: '2 need usage guidance.', needing: 2 });
    expect(componentsLead([row('a'), row('b', 'ok', 'beta'), row('c', 'ok', 'deprecated')]).status).toBe('3 components, 1 stable, 1 beta, 1 deprecated.');
    expect(componentsLead([row('a'), row('b', 'missing')]).guidance).toBe('1 needs usage guidance.');
    expect(componentsLead([row('a')]).guidance).toBeNull();
  });

  it('Add guidance while one is missing, then Review guidance, then nothing', () => {
    const href = (s: string) => `/edit/${s}/`;
    expect(componentsPrimary([row('a', 'review'), row('b', 'missing')], href)).toEqual({ label: 'Add guidance', href: '/edit/b/' });
    expect(componentsPrimary([row('a', 'review')], href)).toEqual({ label: 'Review guidance', href: '/edit/a/' });
    expect(componentsPrimary([row('a')], href)).toBeNull();
  });

  it('badges only exceptions, status colors only for status', () => {
    expect(exceptions({ guidance: 'ok', status: 'stable' })).toEqual([]);
    expect(exceptions({ guidance: 'review', status: 'beta' })).toEqual([
      { label: 'Draft by Claude, needs review', tone: 'info', short: 'Needs review', agent: true },
      { label: 'Beta', tone: 'neutral' },
    ]);
    expect(exceptions({ guidance: 'missing', status: 'deprecated' }).map((b) => b.label)).toEqual(['Missing guidance', 'Deprecated']);
  });

  it('on this repo: every component has a docs editor link and a guidance state', () => {
    const all = loadComponents();
    for (const c of all) {
      expect(docsEditHref(c.slug)).toBe(`/components/${c.slug}/?edit=1`);
      expect(['ok', 'review', 'missing']).toContain(guidanceState(c));
    }
    expect(componentsLead(all.map((c) => ({ slug: c.slug, status: c.docs?.status ?? 'stable', guidance: guidanceState(c) }))).status).toBe(`${all.length} components, all stable.`);
  });
});

describe('Studio Components requests and product usage', () => {
  it('counts open requests per component, case-insensitively', () => {
    const counts = openRequestCounts([
      { component: 'Button', status: 'requested' },
      { component: 'button', status: 'in-progress' },
      { component: 'Button', status: 'done' },
      { component: 'Card', status: 'declined' },
      { component: 'Rating', status: 'requested' },
    ]);
    expect(counts.get('button')).toBe(2);
    expect(counts.has('card')).toBe(false);
    expect(counts.get('rating')).toBe(1);
  });

  it('adds parts to their component, per product', () => {
    const usage = productUsage(
      [
        { product: 'Admin demo', components: { Button: 12, Table: 3, TableHeader: 3, TableRow: 7, AlertDialog: 1, AlertDialogContent: 1, Alert: 2, Tab: 4 } },
        { product: 'Bridge itself', components: { Button: 18, CardBody: 1 } },
      ],
      ['Alert', 'AlertDialog', 'Button', 'Card', 'Table', 'Tabs'],
    );
    expect(usage.get('Button')).toEqual([
      { product: 'Admin demo', instances: 12 },
      { product: 'Bridge itself', instances: 18 },
    ]);
    expect(usage.get('Table')).toEqual([{ product: 'Admin demo', instances: 13 }]);
    expect(usage.get('AlertDialog')).toEqual([{ product: 'Admin demo', instances: 2 }]);
    expect(usage.get('Alert')).toEqual([{ product: 'Admin demo', instances: 2 }]);
    expect(usage.get('Card')).toEqual([{ product: 'Bridge itself', instances: 1 }]);
    expect(usage.has('Tabs')).toBe(false);
  });
});

describe('Studio Components list cells and drawer, in words', () => {
  const iconButton = {
    c: 'Row',
    children: [
      { c: 'IconButton', p: { icon: 'Pencil', label: 'Edit token' } },
      { c: 'IconButton', p: { icon: 'Copy', label: 'Copy token name', variant: 'secondary' } },
      { c: 'IconButton', p: { icon: 'Trash2', label: 'Delete token', variant: 'danger' } },
    ],
  };

  it('thumbnails keep one calm sample, never the destructive one', () => {
    expect(thumbnailNode(iconButton)).toEqual({ c: 'Row', children: [iconButton.children[1]] });
    const badges = { c: 'Row', children: [{ c: 'Badge', p: { tone: 'danger' }, children: ['Failed'] }, { c: 'Badge', p: { tone: 'success' }, children: ['Published'] }] };
    expect(thumbnailNode(badges)?.children).toEqual([badges.children[1]]);
    // A lone destructive trigger is shown in the secondary look.
    const alertDialog = { c: 'Row', children: [{ c: 'Button', p: { variant: 'danger' }, children: ['Delete 3 tokens'] }] };
    expect(thumbnailNode(alertDialog)?.children).toEqual([{ c: 'Button', p: { variant: 'secondary' }, children: ['Delete 3 tokens'] }]);
    // Not a set of samples: kept whole.
    const tabs = { c: 'Tabs', children: [{ c: 'TabsList' }] };
    expect(thumbnailNode(tabs)).toBe(tabs);
    expect(thumbnailNode(undefined)).toBeUndefined();
  });

  it('on this repo: no thumbnail leads with a danger variant', () => {
    for (const c of loadComponents()) {
      const t = thumbnailNode(c.docs?.preview);
      expect(JSON.stringify(t ?? null), c.name).not.toMatch(/"variant":"danger"/);
    }
  });

  it('gives one tag per product, then +N past two', () => {
    expect(usedInCell(undefined)).toEqual([]);
    expect(usedInCell([])).toEqual([]);
    expect(usedInCell([{ product: 'Admin demo' }])).toEqual(['Admin demo']);
    expect(usedInCell([{ product: 'Admin demo' }, { product: 'Bridge itself' }])).toEqual(['Admin demo', 'Bridge itself']);
    expect(usedInCell([{ product: 'A' }, { product: 'B' }, { product: 'C' }])).toEqual(['A', '+2']);
  });


  it('says the drawer facts in one line of words', () => {
    expect(drawerFacts({ guidance: 'ok', tokens: 40, usedIn: [{ product: 'Admin demo', instances: 4 }] }).join(' ')).toBe('Used in Admin demo (4 places). 40 tokens. Usage guidance written.');
    // Missing or drafted guidance has its pill: the line does not say it twice.
    expect(drawerFacts({ guidance: 'missing', tokens: 1, usedIn: [] }).join(' ')).toBe('Not found in an audited product. 1 token.');
    expect(drawerFacts({ guidance: 'review', tokens: 0 }).join(' ')).toBe('No token.');
    expect(requestFact(null)).toBe('Reading open requests.');
    expect(requestFact(undefined)).toBe('');
    expect(requestFact(0)).toBe('No open request.');
    expect(requestFact(2)).toBe('2 open requests.');
  });

  it('one primary: guidance while it is missing or in review, else Change this component', () => {
    expect(drawerActions({ guidance: 'missing' })).toEqual({ primary: 'docs', secondary: ['change'] });
    expect(drawerActions({ guidance: 'review' })).toEqual({ primary: 'docs', secondary: ['change'] });
    expect(drawerActions({ guidance: 'ok' })).toEqual({ primary: 'change', secondary: ['docs'] });
  });
});

describe('Studio Components "Used in": the team products only', () => {
  // Acme Flow: one product with its own repository, and the Library (the design system itself).
  const ACME: ProductConfig[] = [
    { key: 'admin-app', name: 'Art print shop', repo: 'the-bridge-company/art-print-shop' },
    { key: 'library', name: 'Library', path: 'packages', default: true },
  ];
  const run = (id: string, generatedAt: string, extra: { label?: string; product?: string; target?: { path: string } } = {}) => ({ id, generatedAt, components: { Button: new Date(generatedAt).getUTCDate() }, ...extra });

  it('keeps the latest run of each product, named as Bridge names it', () => {
    const got = productAudits(ACME, [run('shop-1', '2026-10-01T00:00:01Z', { product: 'admin-app', label: 'Shop, main' }), run('shop-2', '2026-10-02T00:00:02Z', { product: 'admin-app', label: 'Shop, main' })]);
    expect(got).toEqual([{ product: 'Art print shop', components: { Button: 2 } }]);
  });

  it('never counts a run before the move, even when it is the latest', () => {
    const got = productAudits(ACME, [
      run('shop-after', '2026-10-01T00:00:00Z', { product: 'admin-app' }),
      run('shop-before', '2026-10-09T00:00:00Z', { product: 'admin-app' }),
      run('shop-mui', '2026-10-08T00:00:00Z', { product: 'admin-app', label: 'Shop, original MUI source' }),
    ]);
    expect(got.map((a) => a.components.Button)).toEqual([1]);
  });

  it('drops the runs of apps that are not a listed product, and never lists the Library', () => {
    const runs = [
      run('admin-after', '2026-10-16T00:00:00Z', { label: 'Bridge admin, after migration', target: { path: 'apps/admin/src' } }),
      run('bridge-docs-site-main', '2026-10-20T00:00:02Z', { label: 'Bridge docs site, main', target: { path: 'apps/docs-site/src' } }),
      run('core', '2026-10-20T00:00:03Z', { target: { path: 'packages/core/src' } }),
      run('lib', '2026-10-20T00:00:04Z', { product: 'library' }),
      run('gone', '2026-10-20T00:00:05Z', { product: 'removed-product' }),
    ];
    // No run maps to a product: no "Used in" column at all (teamCatalogRows and the page leave it out on empty).
    expect(productAudits(ACME, runs)).toEqual([]);
  });

  it('maps a run without a product key by its folder (products[].path), in products order', () => {
    const products: ProductConfig[] = [{ key: 'admin', name: 'Admin demo', path: 'apps/admin' }, { key: 'docs', name: 'Docs', path: 'apps/docs-site' }, { key: 'library', name: 'Library', default: true }];
    const got = productAudits(products, [run('docs', '2026-10-20T00:00:02Z', { target: { path: 'apps/docs-site/src' } }), run('admin-after', '2026-10-16T00:00:00Z', { label: 'Bridge admin, after migration', target: { path: 'apps/admin/src' } })]);
    expect(got.map((a) => a.product)).toEqual(['Admin demo', 'Docs']);
  });
});
