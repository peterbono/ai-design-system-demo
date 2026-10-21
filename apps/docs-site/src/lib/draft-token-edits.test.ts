import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyTokenEdits, buildTokenSet, LayeredTokenSet, layoutOptions, loadConfig, parseContrastChecks, planTokenProposal, tokenSuggestionPayload } from '@bridge-ds/core';
import { draftTokenEdits } from './draft-token-edits';
import type { Draft } from './editor-model';

// The real token files of this repo, as Studio reads them (editor-model.test.ts does the same).
const ROOT = join(__dirname, '../../../..');
const config = loadConfig(readFileSync(join(ROOT, 'bridge.config.json'), 'utf8'));
const TOKENS = join(ROOT, config.tokens.root);
const originals: Record<string, string> = {};
for (const dir of readdirSync(TOKENS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(join(TOKENS, dir.name))) if (f.endsWith('.tokens.json')) originals[`${dir.name}/${f}`] = readFileSync(join(TOKENS, dir.name, f), 'utf8');
}
const head = buildTokenSet(originals, layoutOptions(config));
const layered = new LayeredTokenSet(config, new Map(Object.entries(originals)));
const pairs = parseContrastChecks(readFileSync(join(TOKENS, config.tokens.contrastChecks), 'utf8'));

// Never hard-code a current value: derive the edit from it, so the test holds whatever the token says today.
const otherThan = (current: unknown, ...choices: string[]) => choices.find((c) => c !== current)!;
/** The value a path has in one file after the edits, as written. */
const valueIn = (files: Map<string, string>, file: string, path: string) => new LayeredTokenSet(config, files).defs.find((d) => d.file === file && d.path === path);

describe('draft token edits', () => {
  it('turns a value edit into a set on the file of its mode', () => {
    const t = head.byPath.get('color.bg.default')!;
    const after = otherThan(t.values.dark, '{palette.neutral.900}', '{palette.neutral.950}');
    const draft: Draft = { edits: [{ kind: 'value', id: 'a', path: t.path, mode: 'dark', before: t.values.dark, after }] };
    const edits = draftTokenEdits(head, draft);
    expect(edits).toEqual([{ op: 'set', path: t.path, value: after, file: t.files.dark }]);
    const r = applyTokenEdits(layered, edits);
    expect(r.touched).toEqual([t.files.dark]);
    expect(valueIn(r.files, t.files.dark!, t.path)?.value).toBe(after);
  });

  it('keeps the last edit of a token and mode, and drops edits back to the value on main', () => {
    const t = head.byPath.get('color.bg.default')!;
    const other = otherThan(t.values.light, '{palette.neutral.50}', '{palette.neutral.0}');
    const back: Draft = {
      edits: [
        { kind: 'value', id: 'a', path: t.path, mode: 'light', before: t.values.light, after: other },
        { kind: 'value', id: 'b', path: t.path, mode: 'light', before: other, after: t.values.light },
      ],
    };
    expect(draftTokenEdits(head, back)).toEqual([]);
  });

  it('writes a description to every file that defines the token', () => {
    const t = head.byPath.get('color.bg.default')!;
    const draft: Draft = { edits: [{ kind: 'description', id: 'd', path: t.path, before: t.description, after: 'Page background behind every surface.' }] };
    const edits = draftTokenEdits(head, draft);
    const files = [...new Set(Object.values(t.files))].sort();
    expect(edits.map((e) => e.file).sort()).toEqual(files);
    expect(edits.every((e) => e.op === 'set' && e.description === 'Page background behind every surface.' && e.value === undefined)).toBe(true);
    const r = applyTokenEdits(layered, edits);
    for (const f of files) expect(valueIn(r.files, f, t.path)?.description).toBe('Page background behind every surface.');
  });

  it('adds a new semantic color in the light and the dark file', () => {
    const draft: Draft = { edits: [{ kind: 'add', id: 'n', path: 'color.bg.studio-test', type: 'color', tier: 'semantic', values: { light: '{palette.neutral.50}', dark: '{palette.neutral.900}' } }] };
    const edits = draftTokenEdits(head, draft);
    expect(edits).toHaveLength(2);
    expect(edits.every((e) => e.op === 'add' && e.type === 'color')).toBe(true);
    const r = applyTokenEdits(layered, edits);
    const light = edits.find((e) => e.value === '{palette.neutral.50}')!.file!;
    const dark = edits.find((e) => e.value === '{palette.neutral.900}')!.file!;
    expect(light).not.toBe(dark);
    expect(valueIn(r.files, light, 'color.bg.studio-test')?.value).toBe('{palette.neutral.50}');
    expect(valueIn(r.files, dark, 'color.bg.studio-test')?.value).toBe('{palette.neutral.900}');
  });

  it('renames before it sets, and removes a deleted token', () => {
    const t = head.byPath.get('color.bg.default')!;
    expect(draftTokenEdits(head, { edits: [{ kind: 'rename', id: 'r', path: t.path, to: 'color.bg.page' }] })).toEqual([{ op: 'rename', path: t.path, newPath: 'color.bg.page' }]);
    expect(draftTokenEdits(head, { edits: [{ kind: 'delete', id: 'x', path: t.path }] })).toEqual([{ op: 'remove', path: t.path }]);
  });

  it('leaves docs edits out', () => {
    expect(draftTokenEdits(head, { edits: [{ kind: 'docs', id: 'd', path: 'packages/react/src/components/Button/Button.docs.json', component: 'Button', slug: 'button', before: null, after: '{}' }] })).toEqual([]);
  });

  it('plans through core into a suggestion payload with the exact edits', () => {
    const t = head.byPath.get('color.bg.default')!;
    const after = otherThan(t.values.light, '{palette.neutral.50}', '{palette.neutral.0}');
    const edits = draftTokenEdits(head, { edits: [{ kind: 'value', id: 'a', path: t.path, mode: 'light', before: t.values.light, after }] });
    const plan = planTokenProposal({ before: layered, pairs, edits, title: 'Lighter default background', config, tool: 'Bridge Studio' })!;
    expect(plan).not.toBeNull();
    const payload = tokenSuggestionPayload(plan, { base: { ref: 'main', sha: 'a'.repeat(40) }, source: 'studio', suggestedBy: '@designer' });
    expect(payload.kind).toBe('token-change');
    expect(payload.source).toBe('studio');
    expect(payload.suggestedBy).toBe('designer');
    expect(payload.tokens?.edits).toEqual(edits);
    // Token files are re-derived from the edits when applied: only the changeset is stored whole.
    expect(payload.files?.every((f) => !f.path.startsWith(config.tokens.root))).toBe(true);
  });
});
