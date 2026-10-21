// Component data for docs, from the files that already sit next to each component (moved from the docs site,
// apps/docs-site/src/lib/components.ts):
//   <Name>.tsx          props, defaults, JSDoc, sub-components (regex parsers: React + TypeScript only)
//   <Name><styleSuffix> which tokens each part and state uses
//   <Name>.stories.tsx  Storybook story ids for the live preview
//   <Name><docsSuffix>  usage guidance a parser cannot know (written by designers)
// The components folder, the suffixes and the barrel file come from bridge.config.json (components.*).
// Pure: takes file bodies, reads nothing itself.

import type { ProseKey } from './docs-draft';
import type { TokenRowTier } from './token-rows';

export type ExampleNode = string | { c: string; p?: Record<string, unknown>; children?: ExampleNode[] };

export interface GuidanceItem {
  title: string;
  text: string;
  example?: ExampleNode;
}

/** <Name>.docs.json. */
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
  /** Prose sections Claude drafted that wait for review, when a draft covered only some (missing: the whole file). */
  draftedSections?: ProseKey[];
  /** True while drafted prose waits for a reviewer. */
  needsReview?: boolean;
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
}

/** What the scan knows about a CSS variable: the token it is, and an optional docs link (the caller's routing). */
export interface ComponentVar {
  name: string;
  href?: string;
  known: boolean;
  path?: string;
  kind?: TokenRowTier;
}

export interface ComponentCssRule {
  selector: string;
  /** First class in the selector, used for the anatomy label. */
  className: string;
  label: string;
  vars: ComponentVar[];
}

export interface ScannedComponent {
  name: string;
  slug: string;
  /** Repo-relative folder. */
  dir: string;
  /** Repo-relative files (they may not all exist). */
  files: { tsx: string; css: string; stories: string; docs: string };
  description?: string;
  props: ComponentProp[];
  inherits?: string;
  omitted: string[];
  subcomponents: string[];
  rules: ComponentCssRule[];
  tokensUsed: { name: string; href?: string; known: boolean; kind?: string }[];
  /** Paths of the tokens its own stylesheet reads, in every tier. */
  tokenPaths: string[];
  /**
   * Tokens it reads through another component's stylesheet it imports (IconButton imports Button.module.css), by
   * that component, without the ones its own stylesheet already reads. Followed transitively.
   */
  inherited: { from: string; slug: string; paths: string[] }[];
  /** Own and inherited token paths: what the component actually paints with. */
  allTokenPaths: string[];
  stories: { name: string; id: string }[];
  docs: ComponentDocs | null;
  /** Family from docs.json `category`, else from the grouped exports of the barrel file. */
  category: string;
}

/** "IconButton" -> "icon-button". */
export const componentSlug = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Families in the order the barrel file lists them ("// Actions" then its exports). `componentsRel` is the components
 * folder relative to the barrel's folder ("components"); exports from elsewhere are not members.
 */
export function parseComponentFamilies(indexSrc: string, componentsRel = 'components'): { name: string; members: string[] }[] {
  const out: { name: string; members: string[] }[] = [];
  const exportRe = new RegExp(`export \\* from '\\./${escapeRe(componentsRel)}/(\\w+)'`);
  for (const line of indexSrc.split('\n')) {
    const head = line.match(/^\/\/\s*([A-Z][\w ]+)$/);
    if (head) out.push({ name: head[1]!.trim(), members: [] });
    const exp = line.match(exportRe);
    if (exp && out.length) out[out.length - 1]!.members.push(exp[1]!);
  }
  return out.filter((f) => f.members.length);
}

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
  return { inherits: el ? (NATIVE[el] ?? el) : undefined, omitted };
}

/** Props (with defaults and JSDoc), the native element it extends, its description and sub-components, from <Name>.tsx. */
export function parseComponentTsx(
  name: string,
  src: string,
): { props: ComponentProp[]; inherits: string | undefined; omitted: string[]; description: string | undefined; subcomponents: string[] } {
  const aliases = new Map<string, string>();
  for (const m of src.matchAll(/export type (\w+)\s*=\s*([^;]+);/g)) aliases.set(m[1]!, m[2]!.trim());

  let props: ComponentProp[] = [];
  let inherits: string | undefined;
  let omitted: string[] = [];

  const iface = src.match(new RegExp(`export interface ${name}Props(?:\\s+extends\\s+([^{]+))?\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (iface) {
    ({ inherits, omitted } = parseExtends(iface[1] ?? ''));
    for (const m of iface[2]!.matchAll(/(?:\/\*\*([\s\S]*?)\*\/\s*)?(\w+)(\?)?:\s*([^;]+);/g)) {
      const rawType = m[4]!.trim();
      props.push({
        name: m[2]!,
        type: aliases.get(rawType) ?? rawType,
        required: !m[3],
        description:
          m[1]
            ?.replace(/^\s*\*\s?/gm, '')
            .replace(/\s+/g, ' ')
            .trim() || undefined,
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

  // The JSDoc block that ends right before the match: the last comment of what precedes it, only when it opens with
  // "/**". Matching the whole prefix used to start at the first JSDoc of the file, so the JSDoc of a props interface
  // and the code after it leaked into the component description.
  const docBefore = (re: RegExp) => {
    const idx = src.search(re);
    if (idx < 0) return undefined;
    const before = src.slice(0, idx).trimEnd();
    if (!before.endsWith('*/')) return undefined;
    const start = before.lastIndexOf('/*', before.length - 2);
    if (start < 0 || before[start + 2] !== '*') return undefined;
    return before
      .slice(start + 3, -2)
      .replace(/^\s*\*\s?/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
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

/**
 * Minimal CSS reader: selector -> var(--*) list, labelled with the docs.json anatomy. Skips @keyframes, flattens
 * @media. `describe` says what a variable is (token path, tier, docs link); undefined: not a token.
 */
export function parseComponentCss(src: string, labels: Record<string, string>, describe: (cssVar: string) => Omit<ComponentVar, 'name' | 'known'> | undefined): ComponentCssRule[] {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: ComponentCssRule[] = [];
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
          vars: names.map((n) => {
            const d = describe(n);
            return { name: n, href: d?.href, known: !!d, path: d?.path, kind: d?.kind };
          }),
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

/** Story names and Storybook ids of a <Name>.stories.tsx (CSF with a `title`). */
export function parseComponentStories(src: string): { name: string; id: string }[] {
  const title = src.match(/title:\s*'([^']+)'/)?.[1];
  if (!title) return [];
  const base = title
    .split('/')
    .map((s) => componentSlug(s.trim()).replace(/\s+/g, '-'))
    .join('-');
  return [...src.matchAll(/export const (\w+):\s*Story/g)].map((m) => ({ name: m[1]!, id: `${base}--${componentSlug(m[1]!)}` }));
}

/**
 * Fills `inherited` and `allTokenPaths` from the stylesheets each component imports from another component,
 * transitively (A imports B's stylesheet, B imports C's: A inherits from B and C). Removes `reuses`.
 */
export function resolveInheritedTokens(list: (Pick<ScannedComponent, 'name' | 'slug' | 'tokenPaths' | 'inherited' | 'allTokenPaths'> & { reuses?: string[] })[]): void {
  const byName = new Map(list.map((c) => [c.name, c]));
  for (const c of list) {
    const seen = new Set<string>([c.name]);
    const queue = [...(c.reuses ?? [])];
    const inherited: ScannedComponent['inherited'] = [];
    const taken = new Set(c.tokenPaths);
    while (queue.length) {
      const from = byName.get(queue.shift()!);
      if (!from || seen.has(from.name)) continue;
      seen.add(from.name);
      const paths = from.tokenPaths.filter((p) => !taken.has(p));
      paths.forEach((p) => taken.add(p));
      inherited.push({ from: from.name, slug: from.slug, paths });
      queue.push(...(from.reuses ?? []));
    }
    c.inherited = inherited;
    c.allTokenPaths = [...taken].sort();
  }
  for (const c of list) delete c.reuses;
}

export interface ComponentScanInput {
  /** Components folder, repo-relative (bridge.config.json components.dir). */
  dir: string;
  /** Every repo-relative file under `dir` (RepoSource.list(dir)). */
  files: string[];
  /** Body of a repo-relative file, undefined when missing. */
  readText: (path: string) => string | undefined;
  /** Barrel file body (components.index), for families. Undefined: no families. */
  indexText?: string | undefined;
  /** Components folder relative to the barrel's folder. Default "components". */
  indexRel?: string;
  docsSuffix?: string;
  styleSuffix?: string;
  /** What a CSS variable is (token path, tier, docs link). Undefined: not a token. */
  describeVar: (cssVar: string) => Omit<ComponentVar, 'name' | 'known'> | undefined;
  /** Problems found (a docs.json that does not parse) are reported here instead of failing the scan. */
  problems?: string[];
}

/**
 * Every component of the folder: a sub-folder <Name> holding <Name>.tsx. Sorted by family (barrel order), then name.
 */
export function scanComponents(input: ComponentScanInput): ScannedComponent[] {
  const { dir, readText, describeVar } = input;
  const docsSuffix = input.docsSuffix ?? '.docs.json';
  const styleSuffix = input.styleSuffix ?? '.module.css';
  const fileSet = new Set(input.files);
  const has = (p: string) => fileSet.has(p);
  const fam = input.indexText === undefined ? [] : parseComponentFamilies(input.indexText, input.indexRel ?? 'components');
  const familyOf = (name: string) => fam.find((f) => f.members.includes(name))?.name;
  const names = [
    ...new Set(
      input.files
        .map((f) => (f.startsWith(`${dir}/`) ? f.slice(dir.length + 1).split('/') : []))
        .filter((parts) => parts.length === 2 && parts[1] === `${parts[0]}.tsx`)
        .map((parts) => parts[0]!),
    ),
  ].sort();
  const reuseRe = new RegExp(`from\\s+'\\.\\.\\/(\\w+)\\/(\\w+)${escapeRe(styleSuffix)}'`, 'g');

  const result = names.map((name) => {
    const folder = `${dir}/${name}`;
    const files = { tsx: `${folder}/${name}.tsx`, css: `${folder}/${name}${styleSuffix}`, stories: `${folder}/${name}.stories.tsx`, docs: `${folder}/${name}${docsSuffix}` };
    let docs: ComponentDocs | null = null;
    if (has(files.docs)) {
      try {
        docs = JSON.parse(readText(files.docs) ?? '') as ComponentDocs;
      } catch (err) {
        input.problems?.push(`${files.docs}: ${(err as Error).message}`);
      }
    }
    const tsxSrc = readText(files.tsx) ?? '';
    const tsx = parseComponentTsx(name, tsxSrc);
    // Another component's stylesheet imported as is: import buttonStyles from '../Button/Button.module.css'.
    const reuses = [...tsxSrc.matchAll(reuseRe)].filter((m) => m[1] === m[2] && m[1] !== name).map((m) => m[1]!);
    const cssText = has(files.css) ? readText(files.css) : undefined;
    const rules = cssText === undefined ? [] : parseComponentCss(cssText, docs?.anatomy ?? {}, describeVar);
    const used = [...new Set(rules.flatMap((r) => r.vars.map((v) => v.name)))].sort();
    const storiesText = has(files.stories) ? readText(files.stories) : undefined;
    return {
      name,
      slug: componentSlug(name),
      dir: folder,
      files,
      ...tsx,
      rules,
      tokensUsed: used.map((n) => {
        const d = describeVar(n);
        return { name: n, href: d?.href, known: !!d, kind: d?.kind };
      }),
      tokenPaths: [...new Set(used.flatMap((n) => describeVar(n)?.path ?? []))].sort(),
      inherited: [] as ScannedComponent['inherited'],
      allTokenPaths: [] as string[],
      reuses,
      stories: storiesText === undefined ? [] : parseComponentStories(storiesText),
      docs,
      category: docs?.category ?? familyOf(name) ?? 'Core',
    };
  });
  const order = (c: { category: string }) => {
    const i = fam.findIndex((f) => f.name === c.category);
    return i < 0 ? fam.length : i;
  };
  result.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  resolveInheritedTokens(result);
  return result as ScannedComponent[];
}
