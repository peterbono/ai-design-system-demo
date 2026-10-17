import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokenSet, layoutOptions, loadConfig, parseContrastChecks } from '@bridge-ds/core';
import { aliasCandidates, applyDraft, guardrails, previewOverrides, trayRows, type Draft } from './editor-model';

// The real token files of this repo: the editor works on them in the browser.
const ROOT = join(__dirname, '../../../..');
const config = loadConfig(readFileSync(join(ROOT, 'bridge.config.json'), 'utf8'));
const TOKENS = join(ROOT, config.tokens.root);
const originals: Record<string, string> = {};
for (const dir of readdirSync(TOKENS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(join(TOKENS, dir.name))) if (f.endsWith('.tokens.json')) originals[`${dir.name}/${f}`] = readFileSync(join(TOKENS, dir.name, f), 'utf8');
}
const options = layoutOptions(config);
const head = buildTokenSet(originals, options);
const pairs = parseContrastChecks(readFileSync(join(TOKENS, config.tokens.contrastChecks), 'utf8'));

const lineDiff = (a: string, b: string) => {
  const x = a.split('\n');
  const y = b.split('\n');
  return { lengthDelta: y.length - x.length, changed: x.filter((l, i) => l !== y[i]) };
};

describe('token editor model', () => {
  it('writes one semantic alias edit back to one file, changing one line only', () => {
    const before = head.byPath.get('color.bg.default')!.values.light;
    const draft: Draft = { edits: [{ kind: 'value', id: 'x', path: 'color.bg.default', mode: 'light', before, after: '{palette.neutral.50}' }] };
    const { files, changes } = applyDraft(head, originals, draft, options);
    expect(changes).toHaveLength(1);
    expect(Object.keys(files)).toEqual(['semantic/light.tokens.json']);
    const d = lineDiff(originals['semantic/light.tokens.json']!, files['semantic/light.tokens.json']!);
    expect(d.lengthDelta).toBe(0);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]).toContain('{palette.neutral.0}');
  });

  it('keeps key order and indentation when a brand palette role changes', () => {
    const t = head.byPath.get('palette.primary.600')!;
    const draft: Draft = { edits: [{ kind: 'value', id: 'x', path: t.path, mode: 'ocean', before: t.values.ocean, after: '{color.steel.700}' }] };
    const { files } = applyDraft(head, originals, draft, options);
    const file = Object.keys(files)[0]!;
    expect(file).toBe('brands/ocean.tokens.json');
    const d = lineDiff(originals[file]!, files[file]!);
    expect(d.lengthDelta).toBe(0);
    expect(d.changed).toHaveLength(1);
  });

  it('undoing an edit (same value back) produces no change', () => {
    const before = head.byPath.get('color.bg.default')!.values.light;
    const draft: Draft = {
      edits: [
        { kind: 'value', id: 'a', path: 'color.bg.default', mode: 'light', before, after: '{palette.neutral.0}' },
        { kind: 'value', id: 'b', path: 'color.bg.default', mode: 'light', before: '{palette.neutral.0}', after: before },
      ],
    };
    expect(applyDraft(head, originals, draft, options).files).toEqual({});
  });

  it('blocks a draft that breaks a contrast pair, and names it', () => {
    const before = head.byPath.get('color.text.muted')!.values.light;
    const draft: Draft = { edits: [{ kind: 'value', id: 'x', path: 'color.text.muted', mode: 'light', before, after: '{palette.neutral.200}' }] };
    const { proposed } = applyDraft(head, originals, draft, options);
    const g = guardrails(head, proposed, pairs);
    expect(g.ok).toBe(false);
    expect(g.newContrastFailures.some((r) => r.pair.foreground === 'color.text.muted')).toBe(true);
    expect(g.blocking.some((i) => i.code === 'contrast')).toBe(true);
  });

  it('blocks broken references and alias cycles', () => {
    const broken: Draft = { edits: [{ kind: 'value', id: 'x', path: 'color.bg.default', mode: 'light', before: null, after: '{palette.nope.50}' }] };
    expect(guardrails(head, applyDraft(head, originals, broken, options).proposed, pairs).blocking.some((i) => i.code === 'broken-reference')).toBe(true);
    const cycle: Draft = {
      edits: [
        { kind: 'value', id: 'a', path: 'button.primary.bg', mode: '$', before: null, after: '{button.primary.bg-hover}' },
        { kind: 'value', id: 'b', path: 'button.primary.bg-hover', mode: '$', before: null, after: '{button.primary.bg}' },
      ],
    };
    const t = head.byPath.get('button.primary.bg')!;
    cycle.edits = cycle.edits.map((e) => (e.kind === 'value' ? { ...e, mode: Object.keys(t.values)[0]! } : e));
    expect(guardrails(head, applyDraft(head, originals, cycle, options).proposed, pairs).blocking.some((i) => i.code === 'alias-cycle')).toBe(true);
  });

  it('adds, renames and deletes semantic tokens in both theme files', () => {
    const draft: Draft = {
      edits: [
        { kind: 'add', id: 'n', path: 'color.bg.canvas', type: 'color', tier: 'semantic', values: { light: '{palette.neutral.50}', dark: '{palette.neutral.950}' } },
      ],
    };
    const { files } = applyDraft(head, originals, draft, options);
    expect(Object.keys(files).sort()).toEqual(['semantic/dark.tokens.json', 'semantic/light.tokens.json']);
    expect(files['semantic/light.tokens.json']).toContain('"canvas"');
    const del = applyDraft(head, originals, { edits: [{ kind: 'delete', id: 'd', path: 'color.bg.muted' }] }, options);
    expect(del.files['semantic/dark.tokens.json']).not.toContain('"muted": {\n        "$type": "color",\n        "$value": "{palette.neutral.8');
    expect(del.proposed.byPath.has('color.bg.muted')).toBe(false);
    const ren = applyDraft(head, originals, { edits: [{ kind: 'rename', id: 'r', path: 'color.bg.muted', to: 'color.bg.track' }] }, options);
    expect(ren.proposed.byPath.has('color.bg.track')).toBe(true);
    expect(ren.proposed.byPath.has('color.bg.muted')).toBe(false);
  });

  it('previews a draft as resolved CSS variables, including tokens that alias the edited one', () => {
    const before = head.byPath.get('palette.neutral.0')!.values.bridge;
    const draft: Draft = { edits: [{ kind: 'value', id: 'x', path: 'palette.neutral.0', mode: 'bridge', before, after: '{color.orange.50}' }] };
    const { proposed } = applyDraft(head, originals, draft, options);
    const vars = previewOverrides(head, proposed, { brand: 'bridge', theme: 'light', density: 'comfortable' });
    expect(vars['--palette-neutral-0']).toMatch(/^#/);
    // color.bg.default aliases palette.neutral.0 in light, so it moves too.
    expect(vars['--color-bg-default']).toBe(vars['--palette-neutral-0']);
    expect(trayRows(head, proposed, draft)[0]).toMatchObject({ label: 'palette.neutral.0', context: 'bridge' });
  });

  it('offers palette roles, not primitives, as alias targets for semantic colors', () => {
    const list = aliasCandidates(head, head.byPath.get('color.bg.default')!);
    expect(list.length).toBeGreaterThan(10);
    expect(list.every((p) => p.startsWith('palette.'))).toBe(true);
  });
});
