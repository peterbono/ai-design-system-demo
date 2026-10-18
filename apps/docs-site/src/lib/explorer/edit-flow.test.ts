import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokenSet, contrastScope, evaluatePairs, layoutOptions, loadConfig, parseContrastChecks } from '@bridge-ds/core';
import { aliasCandidates, applyDraft, draftToChanges, trayRows, type Draft } from '../editor-model';
import { contrastCountLine, contrastSummary, summarizePairs, type PairCheck } from './contrast-summary';
import { familyTabs, locateSwatch, rampFamilies, rampTicks, swatchLabel } from './swatch-ramp';

const ROOT = join(__dirname, '../../../../..');
const config = loadConfig(readFileSync(join(ROOT, 'bridge.config.json'), 'utf8'));
const TOKENS = join(ROOT, config.tokens.root);
const files: Record<string, string> = {};
for (const dir of readdirSync(TOKENS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of readdirSync(join(TOKENS, dir.name))) if (f.endsWith('.tokens.json')) files[`${dir.name}/${f}`] = readFileSync(join(TOKENS, dir.name, f), 'utf8');
}
const opts = layoutOptions(config);
const head = buildTokenSet(files, opts);
const pairs = parseContrastChecks(readFileSync(join(TOKENS, 'contrast.checks.json'), 'utf8'));

describe('swatch ramp model', () => {
  const bgDefault = head.byPath.get('color.bg.default')!;
  const families = rampFamilies(aliasCandidates(head, bgDefault).map((path) => ({ path })));

  it('groups palette roles into families, neutral, primary and accent first', () => {
    expect(families.slice(0, 3).map((f) => f.label)).toEqual(['Neutral', 'Primary', 'Accent']);
    expect(families.every((f) => f.key.startsWith('palette.'))).toBe(true);
  });

  it('orders steps numerically, 0 to 950', () => {
    const neutral = families[0]!;
    expect(neutral.swatches.map((s) => s.step)).toEqual(['0', '50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']);
    expect(neutral.swatches[1]!.label).toBe('neutral.50');
  });

  it('finds the current step of an alias, and nothing for a raw value', () => {
    expect(locateSwatch(families, 'palette.neutral.0')).toEqual({ family: 0, index: 0 });
    expect(locateSwatch(families, 'palette.primary.700')).toEqual({ family: 1, index: 7 });
    expect(locateSwatch(families, undefined)).toBeNull();
    expect(locateSwatch(families, 'palette.nope.1')).toBeNull();
  });

  it('keeps the current family visible as a tab', () => {
    expect(familyTabs(families, 0)).toEqual({ tabs: [0, 1, 2], more: families.map((_, i) => i).slice(3) });
    const danger = families.findIndex((f) => f.label === 'Danger');
    const t = familyTabs(families, danger);
    expect(t.tabs).toEqual([0, 1, danger]);
    expect(t.more).toContain(2);
    expect(t.more).not.toContain(danger);
  });

  it('labels the first, 500 and last steps', () => {
    const ticks = rampTicks(families[0]!.swatches);
    expect(ticks.filter(Boolean)).toEqual(['0', '500', '950']);
    expect(rampTicks([])).toEqual([]);
  });

  it('shortens labels and handles non-numeric steps', () => {
    expect(swatchLabel('palette.link.700')).toBe('link.700');
    expect(swatchLabel('space.4')).toBe('space.4');
    const f = rampFamilies([{ path: 'size.lg' }, { path: 'size.2' }, { path: 'size.10' }]);
    expect(f[0]!.swatches.map((s) => s.step)).toEqual(['2', '10', 'lg']);
  });
});

describe('contrast summary line', () => {
  const c = (fg: string, bg: string, ratio: number | undefined, min = 4.5): PairCheck => ({ fg, bg, ratio, min });

  it('counts each pair once across contexts and keeps its lowest ratio', () => {
    const rows = summarizePairs([c('color.text.default', 'color.bg.default', 16), c('color.text.default', 'color.bg.default', 9), c('color.text.muted', 'color.bg.default', 5)]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.ratio).toBe(9);
  });

  it('says contrast stays AA when every pair passes', () => {
    const s = contrastSummary([c('color.text.default', 'color.bg.default', 16), c('color.text.muted', 'color.bg.default', 5)], 'color.bg.default');
    expect(s.tone).toBe('pass');
    expect(s.text).toBe('Contrast stays AA on all 2 pairs.');
    expect(contrastCountLine(s)).toBe('2 pairs, all pass');
  });

  it('names the worst failing text pair first and counts the others', () => {
    const s = contrastSummary(
      [c('color.text.muted', 'color.bg.default', 3.7149), c('color.text.disabled', 'color.bg.default', 2.1, 3), c('color.border.strong', 'color.bg.default', 2.9, 3), c('color.text.default', 'color.bg.default', 12)],
      'color.bg.default',
    );
    expect(s.tone).toBe('fail');
    expect(s.failing).toBe(3);
    expect(s.text).toBe('text.muted on it drops to 3.71:1 (needs 4.5). 2 more pairs fail.');
    expect(contrastCountLine(s)).toBe('3 of 4 pairs fail');
  });

  it('phrases a foreground edit from the background side', () => {
    const s = contrastSummary([c('color.text.muted', 'color.bg.subtle', 3.71)], 'color.text.muted');
    expect(s.text).toBe('On bg.subtle it drops to 3.71:1 (needs 4.5).');
  });

  it('says so when no pair uses the token', () => {
    expect(contrastSummary([], 'color.bg.zone').text).toBe('No checked contrast pair uses this token.');
  });

  it('flags the real bridge canvas moved to neutral.300 (light)', () => {
    const draft: Draft = { edits: [{ kind: 'value', id: 'a', path: 'color.bg.default', mode: 'light', before: head.byPath.get('color.bg.default')!.values.light, after: '{palette.neutral.300}' }] };
    const proposed = applyDraft(head, files, draft, opts).proposed;
    const results = evaluatePairs(proposed.byPath, pairs, contrastScope(proposed)).filter(
      (r) => r.theme === 'light' && r.brand === 'bridge' && (r.pair.foreground === 'color.bg.default' || r.pair.background === 'color.bg.default'),
    );
    const s = contrastSummary(
      results.map((r) => ({ fg: r.pair.foreground, bg: r.pair.background, ratio: r.ratio, min: r.pair.min })),
      'color.bg.default',
    );
    expect(s.tone).toBe('fail');
    expect(s.pairs).toBeGreaterThan(5);
    // Which pair is worst and by how much depends on the live text colors: check the sentence names it.
    expect(s.text).toMatch(/^[a-z0-9.-]+ on it drops to \d+\.\d\d:1 \(needs 4\.5\)\.( \d+ more pairs? fails?\.)?$/);
  });
});

describe('description edits in the draft', () => {
  it('fold into the change and the tray', () => {
    const t = head.byPath.get('color.bg.default')!;
    const draft: Draft = { edits: [{ kind: 'description', id: 'd', path: t.path, before: t.description, after: 'Page canvas.' }] };
    const changes = draftToChanges(head, draft);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.target?.description).toBe('Page canvas.');
    const applied = applyDraft(head, files, draft, opts);
    expect(Object.values(applied.files).join('\n')).toContain('Page canvas.');
    expect(trayRows(head, applied.proposed, draft)[0]!.context).toBe('description');
  });
});
