// Component data for the docs, from three places that already exist next to each component:
//   <Name>.tsx         props, defaults, JSDoc, sub-components (parsed: stays true to the code)
//   <Name>.module.css  which tokens each part and state uses (parsed)
//   <Name>.stories.tsx Storybook story ids for the live preview (parsed)
// plus <Name>.docs.json for the usage guidance a parser cannot know (written by designers).
import { exists, listDir, readJson, readText } from './repo';
import { BRANDS, loadTokens, MODES, tokenIndex } from './tokens';

export const COMPONENTS_DIR = 'packages/react/src/components';

export type ExampleNode = string | { c: string; p?: Record<string, unknown>; children?: ExampleNode[] };

export interface GuidanceItem {
  title: string;
  text: string;
  example?: ExampleNode;
}

export interface ComponentDocs {
  summary: string;
  /** Navigation group. Optional; components without one are listed under "Core". */
  category?: string;
  /** Lifecycle shown on the component page and in the nav: stable (default), beta, deprecated. */
  status?: 'stable' | 'beta' | 'deprecated';
  preview?: ExampleNode;
  whenToUse: string[];
  whenNotToUse: string[];
  dos: GuidanceItem[];
  donts: GuidanceItem[];
  accessibility: string[];
  contentGuidelines?: string[];
  anatomy?: Record<string, string>;
  /** "claude" when an AI drafted the prose (docs-draft Action, bridge_draft_docs). */
  draftedBy?: string;
  /** True while drafted prose waits for a reviewer (Studio Quality lists it, Changes offers Accept). */
  needsReview?: boolean;
}

export interface Prop {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
}

export interface CssRule {
  selector: string;
  className: string; // first class in the selector, used for the anatomy label
  label: string;
  vars: { name: string; href?: string; known: boolean; path?: string; kind?: import('./tokens').TokenKind }[];
}

export interface ComponentInfo {
  name: string;
  slug: string;
  dir: string;
  files: { tsx: string; css: string; stories: string; docs: string };
  description?: string;
  props: Prop[];
  inherits?: string;
  omitted: string[];
  subcomponents: string[];
  rules: CssRule[];
  tokensUsed: { name: string; href?: string; known: boolean; kind?: string }[];
  /**
   * Paths of the tokens this component reads: the var(--*) of its CSS module that are tokens, in every tier
   * (component, semantic, base, density, brand, primitive). One set for the Tokens counts and the Studio filter.
   */
  tokenPaths: string[];
  /**
   * Tokens it reads through another component's stylesheet it imports (IconButton imports Button.module.css), by
   * that component, without the ones its own stylesheet already reads. Followed transitively.
   */
  inherited: { from: string; slug: string; paths: string[] }[];
  /** Own and inherited token paths: what the component actually paints with. The Studio filter shows this set. */
  allTokenPaths: string[];
  stories: { name: string; id: string }[];
  docs: ComponentDocs | null;
  /** Family from docs.json `category`, else from the grouped exports in packages/react/src/index.ts. */
  category: string;
}

/** Families in the order packages/react/src/index.ts lists them ("// Actions" then its exports). */
export function families(): { name: string; members: string[] }[] {
  const src = readText('packages/react/src/index.ts');
  const out: { name: string; members: string[] }[] = [];
  for (const line of src.split('\n')) {
    const head = line.match(/^\/\/\s*([A-Z][\w ]+)$/);
    if (head) out.push({ name: head[1]!.trim(), members: [] });
    const exp = line.match(/export \* from '\.\/components\/(\w+)'/);
    if (exp && out.length) out[out.length - 1]!.members.push(exp[1]!);
  }
  return out.filter((f) => f.members.length);
}

const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

const NATIVE: Record<string, string> = {
  HTMLButtonElement: 'button',
  HTMLInputElement: 'input',
  HTMLSpanElement: 'span',
  HTMLDivElement: 'div',
  HTMLAnchorElement: 'a',
};

function parseExtends(clause: string) {
  const el = clause.match(/<(HTML\w+Element)>/)?.[1];
  const omitted = [...(clause.match(/Omit<[^,]+,\s*([^>]+)>/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  return { inherits: el ? NATIVE[el] ?? el : undefined, omitted };
}

function parseTsx(name: string, src: string) {
  const aliases = new Map<string, string>();
  for (const m of src.matchAll(/export type (\w+)\s*=\s*([^;]+);/g)) aliases.set(m[1]!, m[2]!.trim());

  let props: Prop[] = [];
  let inherits: string | undefined;
  let omitted: string[] = [];

  const iface = src.match(new RegExp(`export interface ${name}Props(?:\\s+extends\\s+([^{]+))?\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (iface) {
    ({ inherits, omitted } = parseExtends(iface[1] ?? ''));
    const body = iface[2]!;
    for (const m of body.matchAll(/(?:\/\*\*([\s\S]*?)\*\/\s*)?(\w+)(\?)?:\s*([^;]+);/g)) {
      const rawType = m[4]!.trim();
      props.push({
        name: m[2]!,
        type: aliases.get(rawType) ?? rawType,
        required: !m[3],
        description: m[1]?.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim() || undefined,
      });
    }
  } else {
    const alias = aliases.get(`${name}Props`);
    if (alias) ({ inherits, omitted } = parseExtends(alias));
  }

  // Defaults come from the destructuring in the component signature: `{ variant = 'primary', ... }`.
  const sig = src.match(new RegExp(`function ${name}\\(\\s*\\{([^}]*)\\}`));
  if (sig) {
    for (const m of sig[1]!.matchAll(/(\w+)\s*=\s*('[^']*'|[\w.]+)/g)) {
      const p = props.find((x) => x.name === m[1]);
      if (p) p.defaultValue = m[2];
    }
  }

  const docBefore = (re: RegExp) => {
    const idx = src.search(re);
    if (idx < 0) return undefined;
    const before = src.slice(0, idx).trimEnd();
    const doc = before.match(/\/\*\*([\s\S]*?)\*\/$/);
    return doc?.[1]?.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim();
  };
  const description = docBefore(new RegExp(`export (?:function|const) ${name}\\b`));
  const subcomponents = [...src.matchAll(/export function (\w+)/g)].map((m) => m[1]!).filter((n) => n !== name);
  props = props.sort((a, b) => Number(b.required) - Number(a.required));
  return { props, inherits, omitted, description, subcomponents };
}

const stateOf = (selector: string) => {
  const states = [
    [/:focus-visible/, 'focus'],
    [/:hover/, 'hover'],
    [/:disabled(?!,)|^[^(]*:disabled/, 'disabled'],
    [/\[data-loading\]/, 'loading'],
    [/::placeholder/, 'placeholder'],
  ] as const;
  const hit = states.filter(([re]) => re.test(selector)).map(([, s]) => s);
  return hit.length ? `, ${hit.join(' + ')}` : '';
};

/** CSS variables Base UI sets at runtime (positioning, measured heights, swipe) and private --_* locals. Not tokens. */
const BASE_UI_RUNTIME = /^--(_|accordion-panel-|collapsible-panel-|active-tab-|anchor-|available-|drawer-swipe-|toast-(frontmost-height|height|index|offset-y|swipe-)|transform-origin)/;

/** Minimal CSS reader: selector -> var(--*) list. Skips @keyframes, flattens @media. */
function parseCss(src: string, labels: Record<string, string>): CssRule[] {
  const index = tokenIndex();
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const walk = (text: string, prefix = ''): void => {
    let i = 0;
    let buf = '';
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '{') {
        const head = buf.trim();
        buf = '';
        let depth = 1;
        const start = ++i;
        while (i < text.length && depth > 0) {
          if (text[i] === '{') depth++;
          else if (text[i] === '}') depth--;
          i++;
        }
        const inner = text.slice(start, i - 1);
        if (head.startsWith('@keyframes')) continue;
        if (head.startsWith('@')) {
          walk(inner, `${head} `);
          continue;
        }
        const names = [...new Set([...inner.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!))].filter((n) => !BASE_UI_RUNTIME.test(n));
        if (!names.length) continue;
        const className = head.match(/\.([\w-]+)/)?.[1] ?? head;
        rules.push({
          selector: prefix + head.replace(/\s+/g, ' '),
          className,
          label: (labels[className] ?? className) + stateOf(head),
          vars: names.map((n) => ({ name: n, href: index.get(n)?.href, known: index.has(n), path: index.get(n)?.path, kind: index.get(n)?.kind })),
        });
      } else {
        buf += ch;
        i++;
      }
    }
  };
  walk(clean);
  return rules;
}

function parseStories(src: string) {
  const title = src.match(/title:\s*'([^']+)'/)?.[1];
  if (!title) return [];
  const base = title
    .split('/')
    .map((s) => kebab(s.trim()).replace(/\s+/g, '-'))
    .join('-');
  return [...src.matchAll(/export const (\w+):\s*Story/g)].map((m) => ({ name: m[1]!, id: `${base}--${kebab(m[1]!)}` }));
}

let cache: ComponentInfo[] | null = null;

export function loadComponents(): ComponentInfo[] {
  if (cache) return cache;
  const index = tokenIndex();
  const fam = families();
  const familyOf = (name: string) => fam.find((f) => f.members.includes(name))?.name;
  const result: ComponentInfo[] = listDir(COMPONENTS_DIR)
    .filter((n) => exists(`${COMPONENTS_DIR}/${n}/${n}.tsx`))
    .sort()
    .map((name) => {
      const dir = `${COMPONENTS_DIR}/${name}`;
      const files = {
        tsx: `${dir}/${name}.tsx`,
        css: `${dir}/${name}.module.css`,
        stories: `${dir}/${name}.stories.tsx`,
        docs: `${dir}/${name}.docs.json`,
      };
      const docs = exists(files.docs) ? readJson<ComponentDocs>(files.docs) : null;
      const tsxSrc = readText(files.tsx);
      const tsx = parseTsx(name, tsxSrc);
      // Another component's stylesheet imported as is: import buttonStyles from '../Button/Button.module.css'.
      const reuses = [...tsxSrc.matchAll(/from\s+'\.\.\/(\w+)\/(\w+)\.module\.css'/g)].filter((m) => m[1] === m[2] && m[1] !== name).map((m) => m[1]!);
      const rules = exists(files.css) ? parseCss(readText(files.css), docs?.anatomy ?? {}) : [];
      const used = [...new Set(rules.flatMap((r) => r.vars.map((v) => v.name)))].sort();
      return {
        name,
        slug: kebab(name),
        dir,
        files,
        ...tsx,
        rules,
        tokensUsed: used.map((n) => ({ name: n, href: index.get(n)?.href, known: index.has(n), kind: index.get(n)?.kind })),
        tokenPaths: [...new Set(used.flatMap((n) => index.get(n)?.path ?? []))].sort(),
        inherited: [] as ComponentInfo['inherited'],
        allTokenPaths: [] as string[],
        reuses,
        stories: exists(files.stories) ? parseStories(readText(files.stories)) : [],
        docs,
        category: docs?.category ?? familyOf(name) ?? 'Core',
      };
    });
  const order = (c: ComponentInfo) => {
    const i = fam.findIndex((f) => f.name === c.category);
    return i < 0 ? fam.length : i;
  };
  result.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  resolveInherited(result as (ComponentInfo & { reuses: string[] })[]);
  cache = result;
  return result;
}

/**
 * Fills `inherited` and `allTokenPaths` from the stylesheets each component imports from another component,
 * transitively (A imports B's stylesheet, B imports C's: A inherits from B and C). Exported for tests.
 */
export function resolveInherited(list: (Pick<ComponentInfo, 'name' | 'slug' | 'tokenPaths' | 'inherited' | 'allTokenPaths'> & { reuses: string[] })[]) {
  const byName = new Map(list.map((c) => [c.name, c]));
  for (const c of list) {
    const own = new Set(c.tokenPaths);
    const seen = new Set<string>([c.name]);
    const queue = [...c.reuses];
    const inherited: ComponentInfo['inherited'] = [];
    const taken = new Set(own);
    while (queue.length) {
      const from = byName.get(queue.shift()!);
      if (!from || seen.has(from.name)) continue;
      seen.add(from.name);
      const paths = from.tokenPaths.filter((p) => !taken.has(p));
      paths.forEach((p) => taken.add(p));
      inherited.push({ from: from.name, slug: from.slug, paths });
      queue.push(...from.reuses);
    }
    c.inherited = inherited;
    c.allTokenPaths = [...taken].sort();
  }
  for (const c of list) delete (c as { reuses?: string[] }).reuses;
}

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

/** Studio docs editor for one component (Edit docs). */
export const docsEditHref = (slug: string) => `/studio/components/docs/${slug}/`;
