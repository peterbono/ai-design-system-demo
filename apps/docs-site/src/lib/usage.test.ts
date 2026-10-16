// "In use" on the real repo: the explorer flags and the Overview counts come from one definition.
import { describe, expect, it } from 'vitest';
import { explorerTokens } from './explorer';
import { dashboard, libraryTokenUsage } from './stats';

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
});
