// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { repoModel } from '../lib/model';
import { dashboard } from '../lib/stats';
import { contrastFailures, teamHomeStatic } from './team-home';

describe('teamHomeStatic', () => {
  const sha = 'f'.repeat(40);
  const stat = teamHomeStatic({ owner: 'acme', repo: 'ds', sha, model: repoModel });

  it('counts contrast failures as the build gate does', () => {
    expect(stat.contrastFail).toBe(dashboard().contrast.fail);
    const failing = { contrast: { pairs: [{ min: 4.5, brands: { a: { light: { ratio: 3 }, dark: { ratio: 5 } } }, modes: {} }] } } as never;
    expect(contrastFailures(failing)).toBe(1);
  });

  it('lists every component for Create branch and links guidance to the team on GitHub, never the demo Library', () => {
    expect(stat.components).toHaveLength(repoModel.components!.list.length);
    for (const g of stat.guidance) expect(g.href.startsWith(`https://github.com/acme/ds/blob/${sha}/`)).toBe(true);
    for (const href of Object.values(stat.startHrefs)) expect(href).toMatch(/^(\/studio\/|https:\/\/github\.com\/acme\/ds\/)/);
  });

  it('works for a repository without components', () => {
    const empty = teamHomeStatic({ owner: 'acme', repo: 'ds', sha, model: { ...repoModel, components: null } });
    expect(empty.components).toEqual([]);
    expect(empty.guidance).toEqual([]);
    expect(empty.startHrefs.guidance).toBe('/studio/components/');
  });
});
