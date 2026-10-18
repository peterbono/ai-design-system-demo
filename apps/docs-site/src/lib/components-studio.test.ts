import { describe, expect, it } from 'vitest';
import { componentsLead, componentsPrimary, openRequestCounts, productUsage, type LeadInput } from './components-studio';
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
