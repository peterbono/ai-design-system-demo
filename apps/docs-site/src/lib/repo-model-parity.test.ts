// Golden parity: a repo model computed fresh from this checkout (loadRepoModel over fsSource) equals what every docs
// site lib hands the pages (tokens.ts, components.ts, contrast.ts, config.ts, explorer.ts, figma-coverage.ts,
// repo.ts). Since PR 2a of the multi-team plan these libs read lib/model.ts instead of their own parsers, so this
// guards that no lib reshapes, filters or mutates the model on its way to a page.
import { loadRepoModel, type RepoModel } from '@bridge-ds/core';
import { fsSource } from '@bridge-ds/core/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { families, loadComponents } from './components';
import { contrastPairs } from './contrast';
import { siteRepo } from './config';
import { tokenFiles } from './explorer';
import { loadComponentSpecs, loadFigmaCoverage } from './figma-coverage';
import { tokenHref } from './model';
import { DEFAULT_BRANCH, GITHUB_URL, PREVIEW_APPS, PREVIEW_PACKAGES, PRODUCTION_APPS, ROOT } from './repo';
import { BRAND_LABEL, BRANDS, DEFAULT_BRAND, DEFAULT_DENSITY, DENSITIES, loadTokens, MODES, TOKEN_SOURCE_FILES } from './tokens';

let model: RepoModel;

beforeAll(async () => {
  model = await loadRepoModel(fsSource(ROOT), { href: tokenHref });
});

describe('repo model parity with the docs site (local source)', () => {
  it('reads everything without a problem', () => {
    expect(model.problems).toEqual([]);
    expect(model.configText).not.toBeNull();
  });

  it('parses bridge.config.json once into the same settings', () => {
    expect(model.site).toEqual(siteRepo());
    expect(`https://github.com/${model.site.owner}/${model.site.repo}`).toBe(GITHUB_URL);
    expect(model.site.defaultBranch).toBe(DEFAULT_BRANCH);
    expect(model.config.previews?.apps ?? {}).toEqual(PREVIEW_APPS);
    expect(model.config.previews?.packages ?? []).toEqual(PREVIEW_PACKAGES);
    expect(model.config.previews?.production ?? {}).toEqual(PRODUCTION_APPS);
  });

  it('has the same brands, themes and densities', () => {
    const rows = model.tokens.rows;
    expect(rows.brands).toEqual(BRANDS);
    expect(rows.defaultBrand).toBe(DEFAULT_BRAND);
    expect(rows.brandLabels).toEqual(BRAND_LABEL);
    expect(rows.themes).toEqual(MODES);
    expect(rows.densities).toEqual(DENSITIES);
    expect(rows.defaultDensity).toBe(DEFAULT_DENSITY);
  });

  it('builds the same token rows, tier by tier', () => {
    const site = loadTokens();
    const rows = model.tokens.rows;
    expect(rows.primitives).toEqual(site.primitives);
    expect(rows.brand).toEqual(site.brand);
    expect(rows.semantic).toEqual(site.semantic);
    expect(rows.density).toEqual(site.density);
    expect(rows.component).toEqual(site.component);
    expect(rows.all).toEqual(site.all);
    expect(rows.sources).toEqual(TOKEN_SOURCE_FILES());
    expect(rows.all.length).toBeGreaterThan(100);
  });

  it('reads the same token files as the token explorer', () => {
    expect(model.tokens.files).toEqual(tokenFiles());
  });

  it('computes the same contrast results', () => {
    expect(model.contrast.pairs).toEqual(contrastPairs());
    expect(model.contrast.pairs.length).toBeGreaterThan(5);
  });

  it('scans the same components (props, CSS tokens, stories, docs, families)', () => {
    const site = loadComponents();
    expect(site.length).toBeGreaterThan(20);
    expect(model.components?.list.map((c) => c.name)).toEqual(site.map((c) => c.name));
    expect(model.components?.list).toEqual(site);
    expect(model.components?.families).toEqual(families());
  });

  it('reads the same component specs and Figma coverage', () => {
    expect(model.specs.file).toEqual(loadComponentSpecs());
    expect(new Map(model.specs.coverage.map((c) => [c.name, c]))).toEqual(loadFigmaCoverage());
  });
});
