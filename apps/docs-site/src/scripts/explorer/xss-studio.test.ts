// @vitest-environment jsdom
// Studio sinks fed by hostile token files and contrast checks: the cell editor popover and the draft review sheet.
// Token names, descriptions, values, check minimums and component links stay text, never markup or javascript:.
import { describe, expect, it, vi } from 'vitest';
import { buildTokenSet, layoutOptions, loadConfig } from '@bridge-ds/core';
import { buildTokens, modesOf, type Column, type UsageMap } from '../../lib/explorer/model';
import type { ExplorerData } from './types';

const IMG = '<img src=x onerror=alert(1)>';
const SVG = '"><svg onload=alert(1)>';
const STYLE = 'red;background:url(javascript:alert(1))';
const JS = 'javascript:alert(1)';

const files = {
  'primitives/evil.tokens.json': JSON.stringify({
    color: {
      [IMG]: { $type: 'color', $description: SVG, $value: { colorSpace: 'srgb', components: [1, 0, 0], hex: STYLE } },
      [SVG]: { $type: 'color', $description: IMG, $value: { colorSpace: 'srgb', components: [0, 0, 1], hex: STYLE } },
    },
  }),
};
const set = buildTokenSet(files, layoutOptions(loadConfig('{}')));
const paths = [...set.byPath.keys()];
const P = paths.find((p) => p.includes('<img'))!;
const Q = paths.find((p) => p.includes('<svg'))!;
const usage: UsageMap = Object.fromEntries(paths.map((p) => [p, { used: true, usedBy: [{ name: IMG, href: JS }], styles: [SVG] }]));
const tokens = buildTokens(set, usage);
const modes = modesOf(set);
const ctx = { brand: modes.brands[0] ?? 'bridge', theme: modes.themes[0] ?? 'light', density: modes.densities[0] ?? 'comfortable' };
const col: Column = { key: 'value', label: IMG, ctx };
const d: ExplorerData = { set, head: set, tokens, byPath: new Map(tokens.map((t) => [t.path, t])), usage, pairs: [], results: [], before: [], modes };
const mode = Object.keys(set.byPath.get(P)!.values)[0]!;
const contrast = [{ brand: ctx.brand, theme: ctx.theme, pair: { foreground: P, background: Q, min: SVG as unknown as number }, ratio: 1 }];

vi.mock('../token-editor', () => ({
  aliasOptions: () => [Q, P],
  applyValues: () => {},
  draftDescription: () => IMG,
  draftValue: () => `{${Q}}`,
  editDescription: () => {},
  pendingOverrides: () => ({}),
  previewContrast: () => contrast,
  editorSnapshot: () => ({
    head: set,
    proposed: set,
    draft: {
      edits: [
        { kind: 'value', path: P, mode, before: `{${Q}}`, after: { colorSpace: 'srgb', components: [1, 0, 0], hex: STYLE } },
        { kind: 'description', path: P, after: IMG },
        { kind: 'rename', path: P, to: SVG },
      ],
    },
    contrastBefore: [],
    contrastAfter: contrast,
  }),
  destinationNote: () => null,
  discardDraft: () => {},
  draftOverrides: () => ({}),
  sendLabel: () => 'Send',
  undoEdit: () => {},
  editedModes: () => new Set<string>(),
}));
vi.mock('../github-session', async (orig) => ({ ...(await orig<typeof import('../github-session')>()), initGitHubConnect: () => {} }));
vi.mock('../shell', () => ({ announce: () => {}, currentScope: () => ctx }));

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;

const { openInlineEditor, closeInlineEditor } = await import('./inline-edit');
const { initReview } = await import('./review');

function expectInert(host: Element) {
  for (const el of host.querySelectorAll('*')) {
    for (const a of el.attributes) {
      expect(a.name.startsWith('on'), `${el.tagName} ${a.name}`).toBe(false);
      if (a.name === 'href' || a.name === 'src') expect(a.value).not.toMatch(/^\s*javascript:/i);
      if (a.name === 'style') expect(a.value).not.toMatch(/url\(|expression|javascript:|;\s*background/i);
    }
  }
  expect(host.querySelector('img, svg[onload], script, iframe')).toBeNull();
}

describe('Studio sinks with hostile token files', () => {
  it('the cell editor popover: title, swatches, pick row, pairs, description', async () => {
    const container = document.createElement('div');
    const cell = document.createElement('div');
    container.append(cell);
    document.body.append(container);
    openInlineEditor({ container, cell, d, path: P, col, columns: [col] });
    const pop = document.querySelector<HTMLElement>('.xe-pop')!;
    expect(pop).not.toBeNull();
    await new Promise((r) => setTimeout(r, 80));
    pop.querySelector<HTMLElement>('[data-xe-pairs]')?.click();
    pop.querySelector<HTMLElement>('[data-xe-more]')?.click();
    expectInert(pop);
    // The file's hex (cut to 7 characters) never reaches a style: no second declaration rides along.
    pop.querySelectorAll('[style]').forEach((el) => expect(el.getAttribute('style')).not.toContain('red;'));
    expect(pop.querySelector('.xe-pairs')?.textContent).toContain(SVG);
    expect(pop.textContent).toContain(P);
    expect(pop.querySelector('textarea')?.value).toBe(IMG);
    closeInlineEditor(false);
    container.remove();
  });

  it('the review sheet: change cards, contrast list and Used by links', () => {
    document.body.innerHTML = `<div data-xe-bar><button data-xe-review>Review</button></div>
      <div data-xe-sheet hidden><h2 data-xe-sheet-title></h2><div data-xe-sheet-body></div></div><div data-xe-scrim hidden></div>`;
    initReview(d)!.open();
    const body = document.querySelector<HTMLElement>('[data-xe-sheet-body]')!;
    expect(body.textContent).toContain(P);
    expect(body.textContent).toContain(SVG);
    expect(body.querySelector('a')).not.toBeNull();
    expectInert(body);
  });
});
