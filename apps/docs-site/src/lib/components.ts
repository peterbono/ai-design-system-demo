// Component data for the docs, scanned once by the repo model (lib/model.ts, @bridge-ds/core component-scan) from
// the files next to each component under bridge.config.json components.dir:
//   <Name>.tsx         props, defaults, JSDoc, sub-components (parsed: stays true to the code)
//   <Name>.module.css  which tokens each part and state uses (parsed)
//   <Name>.stories.tsx Storybook story ids for the live preview (parsed)
// plus <Name>.docs.json for the usage guidance a parser cannot know (written by designers).
// This module adds what the pages build on top: the playground spec, guidance state and token links.
import { resolveInheritedTokens, type ComponentCssRule, type ComponentDocs, type ComponentProp, type ExampleNode, type GuidanceItem, type ScannedComponent } from '@bridge-ds/core';
import { repoModel } from './model';
import { BRANDS, loadTokens, MODES } from './tokens';

const scan = repoModel.components!;

/** Components folder, repo-relative (bridge.config.json components.dir). */
export const COMPONENTS_DIR = scan.dir;

export type { ComponentDocs, ExampleNode, GuidanceItem };
export type Prop = ComponentProp;
export type CssRule = ComponentCssRule;
export type ComponentInfo = ScannedComponent;

/** Families in the order the barrel file (packages/react/src/index.ts) lists them ("// Actions" then its exports). */
export const families = (): { name: string; members: string[] }[] => scan.families;

/** Every component, sorted by family then name. */
export const loadComponents = (): ComponentInfo[] => scan.list;

/**
 * Fills `inherited` and `allTokenPaths` from the stylesheets each component imports from another component,
 * transitively (A imports B's stylesheet, B imports C's: A inherits from B and C). Exported for tests.
 */
export const resolveInherited = resolveInheritedTokens;

/** "1 own · 39 from Button", or just the count when nothing is inherited. */
export function tokenCountLabel(c: Pick<ComponentInfo, 'tokenPaths' | 'inherited'>): string {
  const via = c.inherited.filter((i) => i.paths.length);
  if (!via.length) return String(c.tokenPaths.length);
  return [`${c.tokenPaths.length} own`, ...via.map((i) => `${i.paths.length} from ${i.from}`)].join(' · ');
}

/** Studio Tokens filtered on the tokens a component paints with (own and inherited), or undefined when none. */
export const editTokensHref = (c: Pick<ComponentInfo, 'slug' | 'allTokenPaths'>): string | undefined =>
  c.allTokenPaths.length ? `/studio/tokens/?component=${encodeURIComponent(c.slug)}` : undefined;

/**
 * Component slug -> name, token paths (own and inherited) and the components it inherits from, embedded for the
 * Studio Tokens ?component= filter ("Used by IconButton (incl. Button)").
 */
export const componentTokenIndex = (): Record<string, { name: string; paths: string[]; via: string[] }> =>
  Object.fromEntries(loadComponents().map((c) => [c.slug, { name: c.name, paths: c.allTokenPaths, via: c.inherited.map((i) => i.from) }]));

/**
 * Which components a CSS variable reaches: read directly, or through any alias chain in any brand, theme or
 * density (a primitive reaches every component that reads a token resolving to it).
 */
export function componentsUsing(cssVar: string) {
  const { primitives, all } = loadTokens();
  const path = [...primitives, ...all].find((t) => t.cssVar === cssVar)?.path;
  const via = new Set([cssVar]);
  if (path) {
    for (const t of all) {
      const chains = [...BRANDS.flatMap((b) => MODES.flatMap((m) => t.brands[b][m].chain)), ...Object.values(t.densities ?? {}).flatMap((d) => d.chain)];
      if (chains.includes(path)) via.add(t.cssVar);
    }
  }
  return loadComponents()
    .filter((c) => c.tokensUsed.some((t) => via.has(t.name)))
    .map((c) => c.name);
}

// ---------------------------------------------------------------------------------------------------------------
// Props playground spec: serializable control definitions derived from the parsed props, so the React island can
// render any component without per-component code. Unsupported prop types are listed but get no control.

export type Control =
  | { name: string; kind: 'enum'; options: string[]; description?: string }
  | { name: string; kind: 'boolean'; description?: string }
  | { name: string; kind: 'string'; description?: string };

export interface PlaygroundSpec {
  component: string;
  controls: Control[];
  initial: Record<string, string | boolean>;
  /** Text children, when the component takes text content. null when it takes none. */
  children: string | null;
  /** Native attributes worth exposing even though they are inherited (disabled on buttons and inputs). */
  native: Control[];
  /** Default values from the component signature; the code snippet omits props left at their default. */
  defaults: Record<string, string | boolean>;
  /** Props from the docs example that are not editable (options, items, numbers). Passed through as is. */
  fixed: Record<string, unknown>;
}

const literalUnion = (type: string) => {
  const parts = type.split('|').map((p) => p.trim());
  if (parts.length < 2 || !parts.every((p) => /^'[^']*'$/.test(p))) return null;
  return parts.map((p) => p.slice(1, -1));
};

const unquote = (v: string) => (/^'.*'$/.test(v) ? v.slice(1, -1) : v === 'true' ? true : v === 'false' ? false : v);

/** First node in a docs example tree that renders the given component. */
export function findNode(node: ExampleNode | undefined, name: string): Exclude<ExampleNode, string> | null {
  if (!node || typeof node === 'string') return null;
  if (node.c === name) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, name);
    if (hit) return hit;
  }
  return null;
}

export function playgroundSpec(c: ComponentInfo): PlaygroundSpec | null {
  const controls: Control[] = [];
  for (const p of c.props) {
    const options = literalUnion(p.type);
    if (options) controls.push({ name: p.name, kind: 'enum', options, description: p.description });
    else if (p.type === 'boolean') controls.push({ name: p.name, kind: 'boolean', description: p.description });
    else if (p.type === 'string') controls.push({ name: p.name, kind: 'string', description: p.description });
  }
  const native: Control[] =
    c.inherits === 'button' || c.inherits === 'input' ? [{ name: 'disabled', kind: 'boolean', description: 'Native attribute.' }] : [];
  if (!controls.length) return null;
  // Without a docs example there is no realistic set of props to start from (Icon needs a glyph, overlays need content).
  if (!c.docs) return null;
  const node = findNode(c.docs?.preview, c.name) ?? c.docs?.dos.map((d) => findNode(d.example, c.name)).find(Boolean) ?? null;
  // The playground starts from a real example; components only shown composed (Tooltip, overlays) get none.
  if (!node) return null;
  const initial: Record<string, string | boolean> = {};
  for (const ctl of controls) {
    const prop = c.props.find((p) => p.name === ctl.name);
    const fromExample = node?.p?.[ctl.name];
    if (typeof fromExample === 'string' || typeof fromExample === 'boolean') initial[ctl.name] = fromExample;
    else if (prop?.defaultValue) {
      const v = unquote(prop.defaultValue);
      if (typeof v === 'boolean' || typeof v === 'string') initial[ctl.name] = v;
    } else if (ctl.kind === 'enum') initial[ctl.name] = ctl.options[0]!;
    else if (ctl.kind === 'boolean') initial[ctl.name] = false;
    else if (prop?.required) initial[ctl.name] = ctl.name;
  }
  // Keep props from the example that are not controls (placeholder, options, items) so the preview looks real.
  const fixed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node?.p ?? {})) {
    if (k in initial) continue;
    if ((typeof v === 'string' || typeof v === 'boolean') && !controls.some((c) => c.name === k) && k !== 'icon') initial[k] = v;
    else fixed[k] = v;
  }
  const text = node?.children?.filter((x): x is string => typeof x === 'string').join(' ');
  const children = c.inherits === 'input' ? null : text || (node ? null : c.name);
  const defaults: Record<string, string | boolean> = { disabled: false };
  for (const p of c.props) {
    if (!p.defaultValue) continue;
    const v = unquote(p.defaultValue);
    if (typeof v === 'boolean' || typeof v === 'string') defaults[p.name] = v;
  }
  return { component: c.name, controls, initial, children: children ?? null, native, defaults, fixed };
}

// ---------------------------------------------------------------------------------------------------------------
// Usage guidance state, shared by Studio Components, the docs editor and Studio Quality.

/** ok: written and reviewed. review: drafted (by Claude) and waiting for a reviewer. missing: no docs.json yet. */
export type GuidanceState = 'ok' | 'review' | 'missing';

export const guidanceState = (c: Pick<ComponentInfo, 'docs'>): GuidanceState => (!c.docs ? 'missing' : c.docs.needsReview ? 'review' : 'ok');

/** Edit mode of a component's Library page (Edit docs): the guidance is edited in place. */
export const docsEditHref = (slug: string) => `/components/${slug}/?edit=1`;
