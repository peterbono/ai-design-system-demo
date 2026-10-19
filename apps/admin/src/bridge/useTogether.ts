// Changes tried together, in the toolbar: reads the changes (github.ts loadTogetherChange), loads the combination
// module on demand (latest.ts: this build's token files and @bridge-ds/core), keeps which changes are switched on,
// and paints the combination as one stylesheet that switches sides like the live tokens do for one change. Changes
// that edit code are listed but stay off: they cannot be applied live.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEdits } from '@bridge-ds/core';
import { loadTogetherChange, type TogetherFacts } from './github';
import { toggleIncluded, type BridgeBuild, type NoDifference } from './session';
import type { TogetherBase, TogetherPair, TogetherResult } from './together';

type Mod = typeof import('./latest');

export interface Together {
  /** The changes in Studio's order, once read (null while reading). */
  list: TogetherFacts[] | null;
  error: boolean;
  /** Switched on, in Studio's order. */
  included: number[];
  toggle: (n: number, on: boolean) => void;
  result: TogetherResult | null;
  /** Tokens each change edits (by path), whether or not its value is the one applied. */
  editedBy: Map<number, string[]>;
  pairs: TogetherPair[];
  /** Nothing differs where the page is, but it does in another theme (or brand): say so, never a silent "After". */
  noDiff: NoDifference | null;
  /** The stylesheet with the combination, once in the page; its media switches sides. */
  sheet: HTMLStyleElement | null;
}

/** The combination's stylesheet: before the pinned toolbar tokens, so the toolbar never wears the changes' colours. */
function useSheet(css: string | null, applied: boolean): HTMLStyleElement | null {
  const [el, setEl] = useState<HTMLStyleElement | null>(null);
  const ref = useRef<HTMLStyleElement | null>(null);
  useEffect(() => {
    if (css === null) return;
    if (!ref.current) {
      const s = document.createElement('style');
      // Same mark as the live tokens: "Show what changed" reads the page's own rules without it.
      s.setAttribute('data-bridge-live', '');
      s.setAttribute('data-bridge-together', '');
      const pinned = document.head.querySelector('style[data-bridge-pinned]');
      document.head.insertBefore(s, pinned);
      ref.current = s;
      setEl(s);
    }
    ref.current.textContent = css;
    ref.current.media = applied ? 'all' : 'not all';
  }, [css, applied]);
  useEffect(() => () => ref.current?.remove(), []);
  return el;
}

export function useTogether(build: BridgeBuild, changes: number[] | null, use: string | null, here: { theme: string; brand: string; density: string }, applied: boolean): Together | null {
  const [mod, setMod] = useState<{ m: Mod; base: TogetherBase } | null>(null);
  const [list, setList] = useState<TogetherFacts[] | null>(null);
  const [error, setError] = useState(false);
  const [included, setIncluded] = useState<number[]>([]);
  const key = changes?.join(',') ?? '';

  useEffect(() => {
    if (!key) return;
    let live = true;
    const numbers = key.split(',').map(Number);
    Promise.all([import('./latest'), Promise.all(numbers.map((n) => loadTogetherChange(build, n)))]).then(
      ([m, facts]) => {
        if (!live) return;
        setMod({ m, base: m.latestBase(build.tokensRoot ?? 'packages/tokens/src') });
        setList(facts);
        setIncluded(facts.filter((f) => f.mode === 'tokens' && f.source).map((f) => f.number));
      },
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
  }, [build, key]);

  const edits = useMemo<ChangeEdits[]>(() => (mod && list ? list.filter((f) => f.source).map((f) => mod.m.changeEdits(f.source!)) : []), [mod, list]);
  const result = useMemo(() => (mod && list ? mod.m.together(mod.base, edits, mod.m.decodePicks(use), included) : null), [mod, list, edits, use, included]);
  const { theme, brand, density } = here;
  const pairs = useMemo(() => (mod && result ? mod.m.togetherPairs(mod.base, result, { theme, brand, density }) : []), [mod, result, theme, brand, density]);
  const sheet = useSheet(key ? (result?.css ?? null) : null, applied);
  const noDiff = useMemo<NoDifference | null>(() => {
    if (!mod || !result || !result.tokens.length || pairs.length) return null;
    const other = mod.base.modes.themes.find((t) => t !== theme && mod.m.togetherPairs(mod.base, result, { theme: t, brand, density }).length);
    if (other) return { kind: 'theme', here: theme, touched: other };
    const brandElse = mod.base.modes.brands.find((b) => b !== brand && mod.m.togetherPairs(mod.base, result, { theme, brand: b, density }).length);
    return brandElse ? { kind: 'brand', here: brand, touched: brandElse } : null;
  }, [mod, result, pairs.length, theme, brand, density]);

  if (!key) return null;
  return {
    list,
    error,
    included,
    toggle: (n, on) => setIncluded((cur) => toggleIncluded(list?.map((f) => f.number) ?? [], cur, n, on)),
    result,
    editedBy: new Map(edits.map((e) => [e.number, [...new Set(e.edits.map((x) => x.path))]])),
    pairs,
    noDiff,
    sheet,
  };
}
