// "In use" on the real repo: the explorer flags and the Overview counts come from one definition.
import { describe, expect, it } from 'vitest';
import { explorerTokens } from './explorer';
import { dashboard, libraryTokenUsage } from './stats';
import { stylesUsing, usedByLine } from './explorer/flow';
import type { UsageMap } from './explorer/model';

describe('token usage on this repo', () => {
  const { used } = libraryTokenUsage();
  const tokens = explorerTokens();
  const byPath = new Map(tokens.map((t) => [t.path, t]));

  it('counts tokens read only by the base stylesheet, and what they alias', () => {
    expect(used.has('color.bg.default')).toBe(true);
    expect(byPath.get('color.bg.default')?.used).toBe(true);
  });

  it('agrees with the Overview counts', () => {
    const s = dashboard();
    const unusedSemantic = tokens.filter((t) => t.layer === 'semantic' && !t.used).map((t) => t.path).sort();
    const unusedPrimitives = tokens.filter((t) => t.layer === 'primitive' && !t.used).map((t) => t.path).sort();
    expect(s.unusedSemantic.map((t) => t.path).sort()).toEqual(unusedSemantic);
    expect(s.orphanPrimitives.map((t) => t.path).sort()).toEqual(unusedPrimitives);
  });

  it('names the global stylesheets that read a token, apart from components', () => {
    const bg = byPath.get('color.bg.default')!;
    expect(bg.globalStyles).toEqual(['base.css']);
    expect(bg.usedBy).toEqual([]);
    const usage: UsageMap = Object.fromEntries(tokens.map((t) => [t.path, { used: t.used, usedBy: t.usedBy, styles: t.globalStyles }]));
    const styles = stylesUsing('color.bg.default', [], usage);
    expect(styles).toEqual(['base.css']);
    expect(usedByLine(bg.usedBy.length, styles)).toBe('1 global style (base.css)');
  });

  it('reaches global stylesheets through aliases', () => {
    const usage: UsageMap = Object.fromEntries(tokens.map((t) => [t.path, { used: t.used, usedBy: t.usedBy, styles: t.globalStyles }]));
    expect(stylesUsing('palette.neutral.0', ['color.bg.default'], usage)).toEqual(['base.css']);
  });
});

describe('used by line', () => {
  it('counts components and global styles separately', () => {
    expect(usedByLine(3, ['base.css'])).toBe('3 components, 1 global style (base.css)');
    expect(usedByLine(1, [])).toBe('1 component');
    expect(usedByLine(0, ['a.css', 'b.css'])).toBe('2 global styles (a.css, b.css)');
    expect(usedByLine(0, [])).toBe('No component or global style');
  });
});
