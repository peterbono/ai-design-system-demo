// Token inspection for previews: which tokens a component instance reads, from its parsed CSS module.
// Used by the theme playground tooltip, so what you hover lists exactly what the CSS asks for.
import { loadComponents, type ComponentInfo } from './components';
import { loadTokens, primitivesOf } from './tokens';

export interface InspectToken {
  name: string; // CSS variable
  path: string;
  kind: 'semantic' | 'primitive';
  color: boolean;
  light: string;
  dark: string;
}

export interface Inspect {
  name: string;
  detail?: string;
  tokens: InspectToken[];
}

let byVar: Map<string, InspectToken> | null = null;

function tokenInfo(cssVar: string): InspectToken | null {
  if (!byVar) {
    const { primitives, semantic } = loadTokens();
    byVar = new Map();
    for (const p of primitives) {
      byVar.set(p.cssVar, { name: p.cssVar, path: p.path, kind: 'primitive', color: p.type === 'color', light: p.css, dark: p.css });
    }
    for (const s of semantic) {
      byVar.set(s.cssVar, {
        name: s.cssVar,
        path: s.path,
        kind: 'semantic',
        color: s.type === 'color',
        light: s.modes.light.alias ? `${s.modes.light.alias}, ${s.modes.light.css}` : s.modes.light.css,
        dark: s.modes.dark.alias ? `${s.modes.dark.alias}, ${s.modes.dark.css}` : s.modes.dark.css,
      });
    }
  }
  return byVar.get(cssVar) ?? null;
}

const isResting = (selector: string) => !/:(hover|focus|disabled|active)|\[data-|::placeholder/.test(selector);

/**
 * Tokens read by a component in a given configuration: the base class, every class named like a string prop
 * value (variant="primary" -> .primary) and any extra parts. Resting state only; hover and focus are listed on
 * the component page.
 */
export function inspectComponent(name: string, props: Record<string, unknown> = {}, parts: string[] = []): Inspect {
  const c: ComponentInfo | undefined = loadComponents().find((x) => x.name === name || x.subcomponents.includes(name));
  if (!c) return { name, tokens: [] };
  const base = c.rules[0]?.className;
  const values = new Set(Object.values(props).filter((v): v is string => typeof v === 'string'));
  const classes = new Set([...(parts.length ? parts : base ? [base] : []), ...values]);
  const vars = [
    ...new Set(
      c.rules
        .filter((r) => classes.has(r.className) && isResting(r.selector))
        .flatMap((r) => r.vars.map((v) => v.name)),
    ),
  ];
  const tokens = vars.map(tokenInfo).filter((t): t is InspectToken => t !== null);
  tokens.sort((a, b) => Number(b.kind === 'semantic') - Number(a.kind === 'semantic') || Number(b.color) - Number(a.color));
  const detail = [...values].join(', ');
  return { name, detail: detail || undefined, tokens };
}

/** For page-level surfaces written in the playground itself (not components). */
export function inspectVars(name: string, vars: string[]): Inspect {
  return { name, tokens: vars.map(tokenInfo).filter((t): t is InspectToken => t !== null) };
}

/** Baseline values for the tactile controls, read from the token scales so resets are exact. */
export function scaleBaseline() {
  const px = (css: string) => Number.parseFloat(css);
  return {
    space: primitivesOf('space').map((p) => ({ cssVar: p.cssVar, px: px(p.css) })),
    radius: primitivesOf('radius').map((p) => ({ cssVar: p.cssVar, px: px(p.css), key: p.segments[1] })),
    fontSize: primitivesOf('font.size').map((p) => ({ cssVar: p.cssVar, px: px(p.css), key: p.segments[2] })),
  };
}
