import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changeEdits, combineChanges, combineConflicts, decodePicks, layoutOptions, loadConfig, parseContrastChecks } from '@bridge-ds/core';
import {
  CODE_LINE,
  combineSummary,
  keepListed,
  namesOf,
  onlyTokens,
  selectionLine,
  shortTitle,
  togetherGuardrail,
  togetherRows,
  toggleChange,
  tokenFilesOf,
  tryLabel,
  tryTogetherUrl,
  useLabel,
  VIEW_LABEL,
} from './combine-changes';
import { reviewTokenChange } from './token-review';

const ROOT = join(__dirname, '../../../..');
const config = loadConfig(readFileSync(join(ROOT, 'bridge.config.json'), 'utf8'));
const TOKENS = join(ROOT, config.tokens.root);
const latest: Record<string, string> = {};
for (const dir of readdirSync(TOKENS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(join(TOKENS, dir.name))) if (f.endsWith('.tokens.json')) latest[`${dir.name}/${f}`] = readFileSync(join(TOKENS, dir.name, f), 'utf8');
}
const pairs = parseContrastChecks(readFileSync(join(TOKENS, 'contrast.checks.json'), 'utf8'));
const options = layoutOptions(config);
const LIGHT = 'semantic/light.tokens.json';

/** A change's version of the light theme: the latest file with some raw `$value`s replaced. */
function lightWith(values: Record<string, string>): string {
  const json = JSON.parse(latest[LIGHT]!) as Record<string, unknown>;
  for (const [path, value] of Object.entries(values)) {
    const node = path.split('.').reduce<Record<string, unknown>>((n, k) => n[k] as Record<string, unknown>, json);
    node.$value = value;
  }
  return `${JSON.stringify(json, null, 2)}\n`;
}

const edits = (number: number, values: Record<string, string>) => changeEdits({ number, base: { [LIGHT]: latest[LIGHT] }, head: { [LIGHT]: lightWith(values) }, files: [LIGHT] });

// Fixtures: three token changes, two of which set color.bg.default differently.
const A = edits(101, { 'color.bg.default': '{palette.neutral.50}' });
const B = edits(118, { 'color.bg.default': '{palette.neutral.100}', 'color.border.default': '{palette.neutral.300}' });
const C = edits(120, { 'color.text.link': '{palette.primary.800}' });

describe('which changes can be combined', () => {
  it('takes token changes and leaves code out', () => {
    expect(onlyTokens(['packages/tokens/src/semantic/light.tokens.json', '.changeset/x.md'], 'packages/tokens/src')).toBe(true);
    expect(onlyTokens(['packages/tokens/src/contrast.checks.json'], 'packages/tokens/src')).toBe(true);
    expect(onlyTokens(['packages/tokens/src/semantic/light.tokens.json', 'packages/react/src/components/Button/Button.module.css'], 'packages/tokens/src')).toBe(false);
    expect(onlyTokens([], 'packages/tokens/src')).toBe(false);
    expect(CODE_LINE).toBe("This one changes code, so it can't be combined here.");
    expect(tokenFilesOf(['packages/tokens/src/semantic/light.tokens.json', '.changeset/x.md'], '/packages/tokens/src/')).toEqual([LIGHT]);
  });
});

describe('selection', () => {
  it('keeps 2 to 4 changes in pick order and refuses a fifth', () => {
    let s = [101, 118, 120];
    s = toggleChange(s, 7, true).selected;
    expect(s).toEqual([101, 118, 120, 7]);
    expect(toggleChange(s, 9, true)).toEqual({ selected: s, refused: 'full' });
    expect(toggleChange(s, 118, false).selected).toEqual([101, 120, 7]);
    expect(toggleChange([101], 101, true).selected).toEqual([101]);
    expect(keepListed([101, 118, 999], [118, 101])).toEqual([101, 118]);
  });

  it('says what to do next, in designer words', () => {
    expect(selectionLine(0, false)).toBe('Check 2 to 4 token changes to try them together.');
    expect(selectionLine(1, false)).toBe('Check one more token change to try them together.');
    expect(selectionLine(3, false)).toBe('Combining 3 changes.');
    expect(selectionLine(4, true)).toBe('Up to 4 changes at a time. Uncheck one to add another.');
    expect(tryLabel(3)).toBe('Try 3 changes together');
    expect(VIEW_LABEL).toBe('View the library with them');
  });
});

describe('the combination', () => {
  it('finds the conflict, then combines with the pick and counts on the result', () => {
    const conflicts = combineConflicts([A, B, C]);
    expect(conflicts.map((c) => c.path)).toEqual(['color.bg.default']);
    const unpicked = combineChanges(latest, [A, B, C]);
    expect(combineSummary({ changes: 3, edits: unpicked.edits, conflicts: unpicked.conflicts.length, missing: unpicked.missing.length })).toBe(
      'Combines 3 token edits from 3 changes. 1 token has different values in these changes: pick which one to use.',
    );
    const picked = combineChanges(latest, [A, B, C], { [conflicts[0]!.key]: 118 });
    expect(combineSummary({ changes: 3, edits: picked.edits, conflicts: picked.conflicts.length, missing: picked.missing.length })).toBe(
      'Combines 3 token edits from 3 changes. You picked the value of 1 token they set differently.',
    );
    expect(picked.files[LIGHT]).toContain('{palette.neutral.100}');
    expect(picked.files[LIGHT]).toContain('{palette.primary.800}');
  });

  it('runs the contrast checks on the combination itself', () => {
    const conflicts = combineConflicts([A, B, C]);
    const picked = combineChanges(latest, [A, B, C], { [conflicts[0]!.key]: 101 });
    const g = togetherGuardrail(reviewTokenChange(latest, picked.files, pairs, options));
    expect(g.ok).toBe(true);
    expect(g.sentence).toMatch(/^All \d+ contrast checks pass with these changes together\.$/);
    // A link that no longer reads on the canvas fails, counted on the combination.
    const bad = edits(130, { 'color.text.link': '{palette.neutral.100}' });
    const failing = togetherGuardrail(reviewTokenChange(latest, combineChanges(latest, [A, bad]).files, pairs, options));
    expect(failing.ok).toBe(false);
    expect(failing.sentence).toMatch(/contrast checks? fails? with these changes together/);
    expect(failing.failing[0]!.pair).toMatch(/color\.text\.link on /);
  });

  it('builds one row per conflict with one choice per change, values resolved', () => {
    const titles = new Map([
      [101, 'tokens: darker default background'],
      [118, 'tokens: grey canvas and stronger borders for the whole admin'],
    ]);
    const rows = togetherRows(combineConflicts([A, B]), { latest, options, titles });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('color.bg.default');
    expect(rows[0]!.context).toBe('Light');
    expect(rows[0]!.options.map((o) => [o.change, o.label, o.value?.alias])).toEqual([
      [101, "Use Darker default background's", 'palette.neutral.50'],
      [118, "Use Grey canvas and stronger…'s", 'palette.neutral.100'],
    ]);
    expect(rows[0]!.options[0]!.value?.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('shortens titles at a word and names a combination', () => {
    expect(shortTitle('tokens: darker default background')).toBe('Darker default background');
    expect(useLabel('Pill buttons')).toBe("Use Pill buttons's");
    expect(namesOf([{ number: 1, title: 'tokens: a' }, { number: 2, title: 'b' }, { number: 3, title: 'c' }])).toBe('A, B and 1 other');
  });
});

describe('where it opens', () => {
  it('opens the production admin with the list and the picks', () => {
    const url = tryTogetherUrl('https://bridge-demo.example.com', [101, 118, 120], { [`${LIGHT}#path:color.bg.default`]: 118 });
    expect(url).toBe('https://bridge-demo.example.com/?bridge=101,118,120&bridge-use=118%3Asemantic%2Flight.tokens.json%23path%3Acolor.bg.default');
    expect(decodePicks(new URL(url).searchParams.get('bridge-use'))).toEqual({ [`${LIGHT}#path:color.bg.default`]: 118 });
    expect(tryTogetherUrl('https://bridge-demo.example.com/orders', [101, 118], {})).toBe('https://bridge-demo.example.com/?bridge=101,118');
  });

  it('never uses developer words or em dashes on screen', () => {
    const shown = [CODE_LINE, selectionLine(0, false), selectionLine(4, true), combineSummary({ changes: 2, edits: 3, conflicts: 1, missing: 1 }), tryLabel(2), VIEW_LABEL].join(' ');
    expect(shown).not.toMatch(/\b(branch|pull request|PR|commit|merge|SHA|CI|workflow)\b|—/i);
  });
});
