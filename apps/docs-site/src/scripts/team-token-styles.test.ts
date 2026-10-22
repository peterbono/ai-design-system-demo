// A team's Library paints its previews with the team's values: checked names and values per brand and theme, and
// selectors that reach the previews inside the page only.
import { describe, expect, it } from 'vitest';
import type { RepoModel } from '@bridge-ds/core';
import { scopeSelectors, teamTokenScopes } from './team-token-styles';

const row = (path: string, css: string) => ({ path, modes: { light: { css }, dark: { css } }, brands: { acme: { light: { css }, dark: { css: `${css}-dark` } } } });
const model = {
  tokens: {
    rows: {
      brands: ['acme', 'bad brand'],
      themes: ['light', 'dark'],
      primitives: [{ path: 'space.4', css: '16px' }, { path: 'evil', css: 'url(https://x.test/a.png)' }],
      all: [row('color.bg.default', '#fff'), row('color.bad', 'red; background: url(x)'), row('weird.Ünicode', '#000')],
    },
  },
} as unknown as Pick<RepoModel, 'tokens'>;

describe('teamTokenScopes', () => {
  it('gives each brand and theme its checked values, and leaves out what could escape', () => {
    const scopes = teamTokenScopes(model);
    expect(scopes.map((s) => `${s.brand}/${s.theme}`)).toEqual(['acme/light', 'acme/dark']);
    expect(scopes[0]!.vars).toEqual({ '--space-4': '16px', '--color-bg-default': '#fff' });
    expect(scopes[1]!.vars['--color-bg-default']).toBe('#fff-dark');
  });

  it('reaches the previews inside the page, never the chrome', () => {
    const sel = scopeSelectors('acme', 'dark');
    expect(sel).toContain(':root[data-library-shell] main [data-theme="dark"][data-brand="acme"]');
    expect(sel).toContain('main :is(.fd-pv, .fd-stage)');
  });
});
