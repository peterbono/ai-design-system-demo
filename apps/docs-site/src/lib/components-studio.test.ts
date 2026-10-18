import { describe, expect, it } from 'vitest';
import { componentsLead, componentsPrimary, drawerActions, drawerFacts, openRequestCounts, productUsage, requestFact, thumbnailNode, tokenOrigin, usedInCell, type LeadInput } from './components-studio';
import { docsEditHref, guidanceState, loadComponents } from './components';
import { exceptions } from '../components/ds/studio/ComponentsList';

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
      { label: 'Draft by Claude, needs review', tone: 'is-info', short: 'Needs review' },
      { label: 'Beta', tone: '' },
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

  it('names the products, or counts them past two', () => {
    expect(usedInCell(undefined)).toBe('');
    expect(usedInCell([])).toBe('');
    expect(usedInCell([{ product: 'Admin demo' }])).toBe('Admin demo');
    expect(usedInCell([{ product: 'Admin demo' }, { product: 'Bridge itself' }])).toBe('Admin demo and Bridge itself');
    expect(usedInCell([{ product: 'A' }, { product: 'B' }, { product: 'C' }])).toBe('3 products');
  });

  it('says where the tokens come from', () => {
    expect(tokenOrigin(1, [{ from: 'Button', paths: Array(39).fill('x') }])).toBe('1 token of its own and 39 from Button.');
    expect(tokenOrigin(0, [{ from: 'Button', paths: ['a', 'b'] }, { from: 'Input', paths: ['c'] }])).toBe('No token of its own and 2 from Button and 1 from Input.');
    expect(tokenOrigin(40, [{ from: 'Button', paths: [] }])).toBe('40 tokens, all its own.');
    expect(tokenOrigin(0, [])).toBe('No token.');
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

  it('one primary: guidance while it is missing or in review, else tokens, never the request', () => {
    expect(drawerActions({ guidance: 'missing', hasTokens: true })).toEqual({ primary: 'docs', secondary: ['tokens', 'request'] });
    expect(drawerActions({ guidance: 'review', hasTokens: false })).toEqual({ primary: 'docs', secondary: ['request'] });
    expect(drawerActions({ guidance: 'ok', hasTokens: true })).toEqual({ primary: 'tokens', secondary: ['docs', 'request'] });
    expect(drawerActions({ guidance: 'ok', hasTokens: false })).toEqual({ primary: 'docs', secondary: ['request'] });
  });
});
