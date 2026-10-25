// Tokens from a measure, written as a two-tier repo: the real harvest of Carbon's Storybook (used properties only),
// read back through Bridge's own config and token set, the way the Figma pull reads a repo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokenSet, layoutOptions, loadConfig, type MeasuredTokens, tokenRepoFromMeasure, withRepoTokenPaths } from '../src';

const carbon = JSON.parse(readFileSync(join(__dirname, 'fixtures/measure/carbon-tokens.json'), 'utf8')) as MeasuredTokens;

describe('tokenRepoFromMeasure on Carbon', () => {
  const repo = tokenRepoFromMeasure(carbon);
  const config = loadConfig(repo.config);
  const set = buildTokenSet(repo.files, layoutOptions(config));

  it('writes one Primitives file and one semantic file per theme, read as a theme axis', () => {
    expect(repo.report.modes).toEqual(['white', 'g10', 'g90', 'g100']);
    expect(Object.keys(repo.files).sort()).toEqual(['primitives/measured.tokens.json', 'semantic/g10.tokens.json', 'semantic/g100.tokens.json', 'semantic/g90.tokens.json', 'semantic/white.tokens.json']);
    expect(config.modes.themes).toEqual(['white', 'g10', 'g90', 'g100']);
    expect(repo.report.primitives).toBeGreaterThan(50);
    expect(repo.report.semantic).toBeGreaterThan(50);
  });

  it('every semantic token is an alias of a primitive, in every theme: two tiers, never semantic to semantic', () => {
    for (const mode of repo.report.modes) {
      const flat: string[] = [];
      const walk = (o: Record<string, unknown>) => {
        for (const v of Object.values(o)) {
          if (v && typeof v === 'object' && '$value' in v) flat.push(String((v as { $value: unknown }).$value));
          else if (v && typeof v === 'object') walk(v as Record<string, unknown>);
        }
      };
      walk(JSON.parse(repo.files[`semantic/${mode}.tokens.json`]!));
      expect(flat.length).toBe(repo.report.semantic);
      for (const v of flat) expect(v).toMatch(/^\{[\w.-]+\}$/);
    }
    const semanticTokens = [...set.byPath.values()].filter((x) => x.tier === 'semantic');
    expect(semanticTokens.length).toBe(repo.report.semantic);
    for (const t of semanticTokens)
      for (const [mode, v] of Object.entries(t.values)) {
        const target = String(v).replace(/^\{|\}$/g, '');
        expect(set.byPath.get(target)?.tier, `${t.path} in ${mode} -> ${target}`).toBe('primitive');
      }
  });

  it('a semantic color resolves to the value the measure read in each theme (--cds-layer)', () => {
    const layer = carbon.properties.find((p) => p.name === '--cds-layer')!;
    const path = repo.paths.get('--cds-layer')!;
    expect(path).toBe('layer.default');
    const file = (mode: string) => JSON.parse(repo.files[`semantic/${mode}.tokens.json`]!) as Record<string, Record<string, { $value: string }>>;
    const prims = JSON.parse(repo.files['primitives/measured.tokens.json']!);
    const hexOf = (alias: string) => alias.slice(1, -1).split('.').reduce((o: Record<string, unknown>, k) => o[k] as Record<string, unknown>, prims).$value as { hex: string };
    for (const mode of repo.report.modes) {
      const want = layer.values?.[`data-carbon-theme:${mode}`] ?? layer.value;
      const [r, g, b] = String(want).match(/\d+/g)!.map(Number);
      const hex = `#${[r, g, b].map((x) => x!.toString(16).padStart(2, '0')).join('')}`;
      expect(hexOf(file(mode).layer!.default!.$value).hex).toBe(hex);
    }
  });

  it('measured values named after their CSS variable point at the written tokens', () => {
    const file = {
      version: 1 as const,
      storybook: 'https://react.carbondesignsystem.com',
      measuredAt: '2026-10-24T00:00:00Z',
      stories: [{ id: 'a', title: 'Components/Tile', name: 'Default', url: '', ms: 0, spec: { story: 'a', parts: [], values: { root: { fill: 'cds.layer', paddingLeft: 16 } }, raw: {}, tokens: {}, boxes: {}, coverage: { fields: 0, declared: 0, matched: 0, literal: 0 } } }],
    };
    const out = withRepoTokenPaths(file, repo.paths);
    expect(out.stories[0]!.spec!.values.root).toEqual({ fill: 'layer.default', paddingLeft: 16 });
  });

  it('a field declared as a variable alone points at its written token, a calc() of one stays a literal', () => {
    const name = [...repo.paths.keys()].find((n) => n.startsWith('--cds-layer'))!;
    const file = {
      version: 1 as const,
      storybook: 'https://react.carbondesignsystem.com',
      measuredAt: '2026-10-24T00:00:00Z',
      stories: [
        {
          id: 'a',
          title: 'Components/Tile',
          name: 'Default',
          url: '',
          ms: 0,
          spec: {
            story: 'a',
            parts: [],
            values: { root: { paddingLeft: 15 } },
            raw: { root: { fill: 'rgb(244, 244, 244)', paddingLeft: 15 } },
            tokens: { root: { fill: { via: 'declared' as const, chain: ['--cds-unknown', name], exact: true }, paddingLeft: { via: 'declared' as const, chain: [name], exact: false } } },
            boxes: {},
            coverage: { fields: 0, declared: 0, matched: 0, literal: 0 },
          },
        },
      ],
    };
    const out = withRepoTokenPaths(file, repo.paths);
    expect(out.stories[0]!.spec!.values.root).toEqual({ fill: repo.paths.get(name), paddingLeft: 15 });
  });
});


describe('tokenRepoFromMeasure: empty values', () => {
  it('skips a variable that resolves to nothing (a font that names itself), and what aliases it', () => {
    const p = (name: string, extra: object) => ({ name, path: name.slice(2), tier: 'primitive' as const, kind: 'literal' as const, type: 'string' as const, raw: '', value: '', used: true, ...extra });
    const tokens: MeasuredTokens = {
      story: 's',
      modes: [],
      properties: [
        p('--font-sans', { tier: 'semantic', kind: 'alias', raw: 'var(--font-sans)', aliasOf: '--font-sans' }),
        p('--default-font-family', { tier: 'semantic', kind: 'alias', raw: 'var(--font-sans)', aliasOf: '--font-sans' }),
        p('--mono-font-family', { raw: 'ui-monospace, monospace', value: 'ui-monospace, monospace' }),
      ],
      counts: { properties: 3, primitives: 1, semantic: 2, used: 3, scoped: 0 },
    };
    const repo = tokenRepoFromMeasure(tokens);
    expect(repo.report.skipped).toEqual(['--font-sans', '--default-font-family']);
    expect(JSON.stringify(repo.files)).not.toMatch(/palette\.string|"\$value": \[\]/);
    expect([...repo.paths.keys()]).toEqual(['--mono-font-family']);
  });
});
