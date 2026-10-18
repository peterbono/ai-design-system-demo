import { describe, expect, it } from 'vitest';
import { componentsLead, componentsPrimary, type LeadInput } from './components-studio';
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
