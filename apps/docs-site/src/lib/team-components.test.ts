import { describe, expect, it } from 'vitest';
import type { RepoModel, ScannedComponent } from '@bridge-ds/core';
import { filterTeamRows, httpsStorybook, pickStorybook, rowExceptions, storyPreview, teamComponentRows, teamComponentsLead, teamFamilies } from './team-components';

const comp = (name: string, category: string, extra: Partial<ScannedComponent> = {}): ScannedComponent =>
  ({
    name,
    slug: name.toLowerCase(),
    dir: `src/${name}`,
    files: { tsx: `src/${name}/${name}.tsx`, css: '', stories: '', docs: '' },
    props: [],
    omitted: [],
    subcomponents: [],
    rules: [],
    tokensUsed: [],
    tokenPaths: [],
    inherited: [],
    allTokenPaths: ['a', 'b'],
    stories: [],
    docs: null,
    category,
    ...extra,
  }) as ScannedComponent;

const docs = (summary: string, needsReview = false) => ({ summary, whenToUse: [], whenNotToUse: [], dos: [], donts: [], accessibility: [], needsReview }) as ScannedComponent['docs'];

const model = {
  components: {
    dir: 'src',
    index: undefined,
    families: [{ name: 'Inputs', members: ['Input'] }, { name: 'Actions', members: ['Button'] }],
    list: [comp('Button', 'Actions', { docs: docs('Starts an action.'), stories: [{ name: 'Primary', id: 'actions-button--primary' }] }), comp('Input', 'Inputs', { docs: docs('Takes text.', true) }), comp('Zebra', 'Misc')],
  },
} as unknown as Pick<RepoModel, 'components'>;

describe('team components', () => {
  it('rows follow the barrel family order, then the rest', () => {
    const rows = teamComponentRows(model);
    expect(rows.map((r) => r.name)).toEqual(['Input', 'Button', 'Zebra']);
    expect(rows[1]).toMatchObject({ summary: 'Starts an action.', guidance: 'ok', tokens: 2, file: 'src/Button/Button.tsx' });
    expect(rows[0]!.guidance).toBe('review');
    expect(rows[2]!.guidance).toBe('missing');
    expect(teamFamilies(rows)).toEqual([{ name: 'Inputs', n: 1 }, { name: 'Actions', n: 1 }, { name: 'Misc', n: 1 }]);
  });

  it('no scan: no rows', () => {
    expect(teamComponentRows({ components: null })).toEqual([]);
  });

  it('lead sentence', () => {
    const rows = teamComponentRows(model);
    expect(teamComponentsLead(rows)).toBe('3 components in 3 families. 1 needs guidance, 1 draft to review.');
    expect(teamComponentsLead([{ family: 'A', guidance: 'ok' }])).toBe('1 component in 1 family. Every one has usage guidance.');
  });

  it('filters by search and family', () => {
    const rows = teamComponentRows(model);
    expect(filterTeamRows(rows, 'text', '').map((r) => r.name)).toEqual(['Input']);
    expect(filterTeamRows(rows, '', 'Actions').map((r) => r.name)).toEqual(['Button']);
  });

  it('badges only for what waits or is not stable', () => {
    expect(rowExceptions({ guidance: 'ok', status: 'stable' })).toEqual([]);
    expect(rowExceptions({ guidance: 'missing', status: 'beta' }).map((b) => b.label)).toEqual(['No guidance', 'Beta']);
  });

  it('Storybook previews are https only', () => {
    expect(httpsStorybook('https://sb.example.com/')).toBe('https://sb.example.com');
    expect(httpsStorybook('http://sb.example.com')).toBeUndefined();
    expect(httpsStorybook('javascript:alert(1)')).toBeUndefined();
    expect(pickStorybook(undefined, 'https://quick.example.com')).toBe('https://quick.example.com');
    expect(pickStorybook('https://a.example.com', 'https://b.example.com')).toBe('https://a.example.com');
    const rows = teamComponentRows(model);
    expect(storyPreview('https://sb.example.com', rows[1]!)).toEqual({
      src: 'https://sb.example.com/iframe.html?id=actions-button--primary&viewMode=story',
      manager: 'https://sb.example.com/?path=/story/actions-button--primary',
      story: 'Primary',
    });
    expect(storyPreview('https://sb.example.com', rows[0]!)).toBeNull();
    expect(storyPreview(undefined, rows[1]!)).toBeNull();
  });
});
