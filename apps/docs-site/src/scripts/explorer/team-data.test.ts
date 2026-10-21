// @vitest-environment jsdom
// Team shells (multi-team PR 3b): the explorer's data blocks built from a repo model start the explorer exactly as the
// build-time blocks do (ExplorerData.astro) for the same repository.
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@bridge-ds/core';
import { repoModel } from '../../lib/model';
import { tokenFiles } from '../../lib/explorer';
import { explorerConfig, explorerInputFromModel, loadExplorerData, writeExplorerData } from './data';
import { fillSegments } from './team-bootstrap';

const team = { owner: 'acme', repo: 'ds', defaultBranch: 'trunk', componentHref: (dir: string) => `https://github.com/acme/ds/tree/x/${dir}` };

describe('explorer data from a repo model', () => {
  afterEach(() => (document.body.innerHTML = ''));

  it('gives the same token set as the build-time blocks, with the team as the repository', () => {
    const input = explorerInputFromModel(repoModel, team);
    expect(input.files).toEqual(tokenFiles());
    expect(input.checks.pairs).toHaveLength(repoModel.contrast.specs.length);
    expect(Object.keys(input.components)).toHaveLength(repoModel.components!.list.length);
    // Every token has a usage entry; a component's own token is used and links to its folder on GitHub.
    const button = repoModel.components!.list.find((c) => c.name === 'Button')!;
    const read = button.tokenPaths[0]!;
    expect(input.usage[read]?.used).toBe(true);
    expect(input.usage[read]?.usedBy.some((u) => u.name === 'Button' && u.href.startsWith('https://github.com/acme/ds/tree/'))).toBe(true);

    writeExplorerData(input);
    const d = loadExplorerData();
    expect(d.repo).toEqual({ owner: 'acme', name: 'ds', defaultBranch: 'trunk' });
    expect(d.tokensRoot).toBe(repoModel.tokens.root);
    expect(d.tokens.length).toBeGreaterThan(100);
    expect(d.pairs).toHaveLength(repoModel.contrast.specs.length);
    // Writing again replaces the blocks instead of adding a second set.
    writeExplorerData(input);
    expect(document.querySelectorAll('#xp-files')).toHaveLength(1);
  });

  it('keeps hostile repo text inert: blocks are text nodes, never parsed as HTML', () => {
    const input = explorerInputFromModel(repoModel, team);
    writeExplorerData({ ...input, files: { ...input.files, 'x.json': '</script><img src=x onerror=alert(1)>' } });
    expect(document.querySelector('img')).toBeNull();
    expect(JSON.parse(document.getElementById('xp-files')!.textContent!)['x.json']).toContain('</script>');
  });

  it('falls back to the token root when the team config does not load', () => {
    const broken = { ...repoModel, configText: JSON.stringify({ tokens: { root: 5 } }) };
    const cfg = explorerConfig(broken, team);
    expect(cfg).toEqual({ tokens: { root: repoModel.tokens.root }, repo: { owner: 'acme', name: 'ds', defaultBranch: 'trunk' } });
    expect(() => loadConfig(cfg)).not.toThrow();
    expect(explorerConfig({ ...repoModel, configText: null }, team)).toMatchObject({ tokens: { root: repoModel.tokens.root } });
  });
});

describe('fillSegments', () => {
  it('clones the placeholder segment once per value, the first one selected, labels as text', () => {
    document.body.innerHTML = '<div data-segmented-control><div data-segment-track><button data-segment data-value="" aria-checked="true"><span></span></button></div></div>';
    fillSegments(document.querySelector('[data-segmented-control]'), ['bridge', 'ocean'], (v) => (v === 'ocean' ? '<b>Ocean</b>' : 'Bridge'));
    const segs = [...document.querySelectorAll<HTMLElement>('[data-segment]')];
    expect(segs.map((s) => [s.dataset.value, s.getAttribute('aria-checked'), s.textContent])).toEqual([
      ['bridge', 'true', 'Bridge'],
      ['ocean', 'false', '<b>Ocean</b>'],
    ]);
    expect(document.querySelector('b')).toBeNull();
  });
});
