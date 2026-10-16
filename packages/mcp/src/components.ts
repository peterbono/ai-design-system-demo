// Components: list, read (props from TypeScript, docs.json, CSS token usage) and scaffold per AGENTS.md.
import type { BridgeConfig } from './config.js';
import type { RepoSource } from './source.js';
import type { TokenSet } from './core-adapter.js';

export interface PropInfo {
  name: string;
  type: string;
  optional: boolean;
  default?: string;
  description?: string;
  /** Literal values when the type is a local union alias (ButtonVariant -> primary | secondary ...). */
  values?: string[];
}

export interface ComponentSummary {
  name: string;
  family?: string;
  summary?: string;
}

export async function listComponentNames(source: RepoSource, config: BridgeConfig): Promise<{ name: string; files: string[] }[]> {
  const dir = config.components?.dir;
  if (!dir) return [];
  const files = await source.list(dir);
  const byName = new Map<string, string[]>();
  for (const f of files) {
    const rest = f.slice(dir.length + 1).split('/');
    if (rest.length !== 2) continue;
    (byName.get(rest[0]!) ?? byName.set(rest[0]!, []).get(rest[0]!)!).push(f);
  }
  return [...byName.entries()]
    .filter(([name, fs]) => fs.some((f) => f.endsWith(`/${name}.tsx`) || f.endsWith(`/${name}${config.components!.docsSuffix}`) || f.endsWith(`/${name}.ts`) || f.endsWith(`/${name}.vue`) || f.endsWith(`/${name}.svelte`)))
    .map(([name, fs]) => ({ name, files: fs.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const findFamily = (stories: string | null) => (stories ? /title:\s*['"]([^'"/]+)\//.exec(stories)?.[1] : undefined);

export async function listComponents(source: RepoSource, config: BridgeConfig, withSummaries: boolean): Promise<ComponentSummary[]> {
  const names = await listComponentNames(source, config);
  if (!withSummaries) return names.map((n) => ({ name: n.name }));
  const dir = config.components!.dir;
  return Promise.all(
    names.map(async ({ name, files }) => {
      const docsPath = `${dir}/${name}/${name}${config.components!.docsSuffix}`;
      const storiesPath = files.find((f) => /\.stories\.\w+$/.test(f));
      const [docs, stories] = await Promise.all([files.includes(docsPath) ? source.read(docsPath) : null, storiesPath ? source.read(storiesPath) : null]);
      let summary: string | undefined;
      try {
        summary = docs ? (JSON.parse(docs) as { summary?: string }).summary : undefined;
      } catch {
        summary = undefined;
      }
      const family = findFamily(stories);
      return { name, ...(family ? { family } : {}), ...(summary ? { summary } : {}) };
    }),
  );
}

// --- TypeScript props without the TypeScript compiler -------------------------------------------------------

function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) return -1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(body: string, seps: string[]): { text: string; doc?: string }[] {
  const out: { text: string; doc?: string }[] = [];
  let depth = 0;
  let cur = '';
  let doc: string | undefined;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '/' && body[i + 1] === '*') {
      const end = body.indexOf('*/', i);
      const text = body.slice(i, end + 2);
      if (depth === 0 && !cur.trim() && text.startsWith('/**')) doc = text;
      i = end + 1;
      continue;
    }
    if (c === '/' && body[i + 1] === '/') {
      const nl = body.indexOf('\n', i);
      i = nl < 0 ? body.length : nl - 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      for (; j < body.length && body[j] !== c; j++) if (body[j] === '\\') j++;
      cur += body.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('{([<'.includes(c)) depth++;
    if ('})]>'.includes(c) && !(c === '>' && body[i - 1] === '=')) depth--;
    if (depth === 0 && seps.includes(c)) {
      if (cur.trim()) out.push({ text: cur.trim(), ...(doc ? { doc } : {}) });
      cur = '';
      doc = undefined;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push({ text: cur.trim(), ...(doc ? { doc } : {}) });
  return out;
}

const cleanDoc = (d?: string) =>
  d
    ?.replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ');

export function parseProps(src: string, name: string): { extends?: string; props: PropInfo[] } | null {
  const m = new RegExp(`(?:export\\s+)?interface\\s+${name}Props(?:<[^>]*>)?\\s*(?:extends\\s+([^{]+))?\\{`).exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBrace(src, open);
  const body = src.slice(open + 1, close);
  const aliases = new Map<string, string[]>();
  for (const a of src.matchAll(/(?:export\s+)?type\s+(\w+)\s*=\s*([^;]+);/g)) {
    const lits = a[2]!.split('|').map((x) => x.trim());
    if (lits.every((l) => /^(['"]).*\1$/.test(l))) aliases.set(a[1]!, lits.map((l) => l.slice(1, -1)));
  }
  const defaults = new Map<string, string>();
  const fn = new RegExp(`function\\s+${name}\\s*(?:<[^>]*>)?\\(\\s*\\{`).exec(src);
  if (fn) {
    const o = fn.index + fn[0].length - 1;
    const destructured = src.slice(o + 1, matchBrace(src, o));
    for (const part of splitTopLevel(destructured, [','])) {
      const d = /^(\w+)\s*=\s*([\s\S]+)$/.exec(part.text);
      if (d) defaults.set(d[1]!, d[2]!.trim());
    }
  }
  const props: PropInfo[] = [];
  for (const member of splitTopLevel(body, [';'])) {
    const pm = /^(?:readonly\s+)?(['"]?[\w$-]+['"]?)(\?)?\s*:\s*([\s\S]+)$/.exec(member.text);
    const mm = /^(\w+)(\?)?\s*(\([\s\S]*\)\s*=>[\s\S]*|\([\s\S]*\)\s*:\s*[\s\S]+)$/.exec(member.text);
    const hit = pm ?? mm;
    if (!hit) continue;
    const pname = hit[1]!.replace(/['"]/g, '');
    const type = hit[3]!.trim().replace(/\s+/g, ' ');
    const desc = cleanDoc(member.doc);
    const values = aliases.get(type);
    props.push({ name: pname, type, optional: Boolean(hit[2]), ...(defaults.has(pname) ? { default: defaults.get(pname)! } : {}), ...(desc ? { description: desc } : {}), ...(values ? { values } : {}) });
  }
  return { ...(m[1] ? { extends: m[1].trim().replace(/\s+/g, ' ') } : {}), props };
}

export function cssVarsUsed(css: string): string[] {
  return [...new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!))].sort();
}

export async function getComponent(source: RepoSource, config: BridgeConfig, set: TokenSet | null, name: string) {
  const all = await listComponentNames(source, config);
  const entry = all.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!entry) {
    const close = all.filter((c) => c.name.toLowerCase().includes(name.toLowerCase().slice(0, 3))).map((c) => c.name);
    throw new Error(`No component "${name}".${close.length ? ` Did you mean ${close.join(', ')}?` : ''} Use bridge_list_components.`);
  }
  const n = entry.name;
  const pick = (re: RegExp) => entry.files.find((f) => re.test(f.split('/').pop()!));
  const tsx = pick(new RegExp(`^${n}\\.(tsx|ts|vue|svelte)$`));
  const docsFile = pick(new RegExp(`^${n}${config.components!.docsSuffix.replace(/\./g, '\\.')}$`));
  const cssFile = pick(new RegExp(`^${n}${config.components!.styleSuffix.replace(/\./g, '\\.')}$`)) ?? pick(/\.css$/);
  const stories = pick(/\.stories\.\w+$/);
  const [src, docsText, css, storiesText] = await Promise.all([tsx ? source.read(tsx) : null, docsFile ? source.read(docsFile) : null, cssFile ? source.read(cssFile) : null, stories ? source.read(stories) : null]);
  let docs: Record<string, unknown> | undefined;
  try {
    docs = docsText ? (JSON.parse(docsText) as Record<string, unknown>) : undefined;
  } catch {
    docs = { error: `${docsFile} is not valid JSON` };
  }
  const props = src ? parseProps(src, n) : null;
  const vars = css ? cssVarsUsed(css) : [];
  const known = set ? new Set(set.allPaths().map((p) => set.cssVarName(p))) : null;
  const local = css ? new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!)) : new Set<string>();
  const storyNames = storiesText ? [...storiesText.matchAll(/export const (\w+)\s*:/g)].map((m) => m[1]!) : [];
  return {
    name: n,
    family: findFamily(storiesText),
    files: entry.files,
    ...(docs ? { docs } : {}),
    props: props?.props ?? [],
    ...(props?.extends ? { extends: props.extends } : {}),
    tokens: {
      used: vars.filter((v) => !local.has(v)),
      // Not a token and not declared in this CSS: a runtime variable (Base UI sets some) or an invented token.
      ...(known ? { notTokens: vars.filter((v) => !known.has(v) && !local.has(v)) } : {}),
    },
    stories: storyNames,
  };
}

// --- scaffold ---------------------------------------------------------------------------------------------

export interface ScaffoldInput {
  name: string;
  family: string;
  summary: string;
  element: string;
  interactive: boolean;
  basePrimitive?: string;
}

const ELEMENT_TYPES: Record<string, string> = { div: 'HTMLDivElement', button: 'HTMLButtonElement', span: 'HTMLSpanElement', section: 'HTMLElement', nav: 'HTMLElement', ul: 'HTMLUListElement', input: 'HTMLInputElement', a: 'HTMLAnchorElement' };

export async function scaffoldComponent(source: RepoSource, config: BridgeConfig, set: TokenSet, input: ScaffoldInput): Promise<{ files: { path: string; content: string }[]; notes: string[] }> {
  if (!config.components) throw new Error('No components.dir in bridge.config.json.');
  const name = input.name;
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`Component names are PascalCase: "${name}".`);
  const existing = await listComponentNames(source, config);
  if (existing.some((c) => c.name === name)) throw new Error(`${name} already exists in ${config.components.dir}.`);
  const dir = `${config.components.dir}/${name}`;
  const elType = ELEMENT_TYPES[input.element] ?? 'HTMLElement';
  const attrs = input.element === 'button' ? 'ButtonHTMLAttributes' : 'HTMLAttributes';
  const has = (p: string) => set.allPaths().includes(p);
  const v = (p: string) => `var(${set.cssVarName(p)})`;
  const decl = (prop: string, ...candidates: string[]) => {
    const hit = candidates.find(has);
    return hit ? `  ${prop}: ${v(hit)};` : `  /* ${prop}: no token found among ${candidates.join(', ')}; ask before adding one (Tier 3) */`;
  };
  const cssPath = `${dir}/${name}${config.components.styleSuffix}`;
  const css = [
    '.root {',
    decl('color', 'color.text.default'),
    decl('background', 'color.surface.default'),
    decl('border-radius', 'radius.container', 'radius.control'),
    decl('padding', 'layout.inset', 'space.4'),
    decl('font-family', 'font.family.sans'),
    decl('transition-duration', 'motion.duration.instant'),
    '}',
    '',
    '@media (hover: hover) {',
    '  .root:hover {',
    `    ${decl('background', 'color.surface.hover').trim()}`,
    '  }',
    '}',
    '',
    '.root:focus-visible {',
    `  outline: ${has('focus.ring.width') ? v('focus.ring.width') : 'var(--focus-ring-width)'} solid ${has('focus.ring.color') ? v('focus.ring.color') : 'var(--focus-ring-color)'};`,
    `  outline-offset: ${has('focus.ring.offset') ? v('focus.ring.offset') : 'var(--focus-ring-offset)'};`,
    '}',
    '',
  ].join('\n');
  const tsx = `import { forwardRef, type ${attrs} } from 'react';
${input.basePrimitive ? `// Behavior: wrap ${input.basePrimitive} instead of re-implementing focus, keyboard or ARIA.\n` : '// Check Base UI first (node_modules/@base-ui/react/docs/react/components/*.md) and wrap its primitive.\n'}import { cx } from '../../utils/cx';
import styles from './${name}${config.components.styleSuffix}';

export interface ${name}Props extends ${attrs}<${elType}> {
  /** Visual size. Heights and paddings follow the density tokens. */
  size?: 'sm' | 'md';
}

/** ${input.summary.replace(/\*\//g, '')} */
export const ${name} = forwardRef<${elType}, ${name}Props>(function ${name}({ size = 'md', className, ...rest }, ref) {
  return <${input.element} ref={ref} data-size={size} className={cx(styles.root, className)} {...rest} />;
});
`;
  const stories = `import type { Meta, StoryObj } from '@storybook/react-vite';
import { SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { ${name} } from './${name}';

const meta = {
  title: '${input.family}/${name}',
  component: ${name},
  tags: ['autodocs'],
} satisfies Meta<typeof ${name}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid<'md' | 'sm'>
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }]}
        rows={[
          { label: 'Medium', value: 'md' },
          { label: 'Small', value: 'sm' },
        ]}
        render={(size) => <${name} size={size} />}
      />
    </SpecimenStack>
  ),
};
`;
  // docs.json: the reference component's keys, empty, so writers fill the same structure.
  let docsKeys: Record<string, unknown> = { summary: '', preview: {}, whenToUse: [], whenNotToUse: [], dos: [], donts: [], accessibility: [], contentGuidelines: [], anatomy: {} };
  const ref = config.components.reference;
  if (ref) {
    const refText = await source.read(`${config.components.dir}/${ref}/${ref}${config.components.docsSuffix}`);
    if (refText) {
      const refJson = JSON.parse(refText) as Record<string, unknown>;
      docsKeys = Object.fromEntries(Object.entries(refJson).map(([k, val]) => [k, Array.isArray(val) ? [] : val && typeof val === 'object' ? {} : '']));
    }
  }
  docsKeys.summary = input.summary;
  if ('anatomy' in docsKeys) docsKeys.anatomy = { root: 'The component container.' };
  const docs = `${JSON.stringify(docsKeys, null, 2)}\n`;
  const test = `import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { ${name} } from './${name}';

describe('${name}', () => {
  it('is reachable with the keyboard and has no axe violations', async () => {
    render(<${name} ${input.element === 'button' ? '>Label</' + name + '>' : 'tabIndex={0} aria-label="' + name + '" />'});
    await userEvent.tab();
    expect(screen.getByRole('${input.element === 'button' ? 'button' : 'generic'}'${input.element === 'button' ? ", { name: 'Label' }" : ''})).toHaveFocus();
    await expectNoAxeViolations();
  });
});
`;
  const index = `export { ${name} } from './${name}';\nexport type { ${name}Props } from './${name}';\n`;
  const files = [
    { path: `${dir}/${name}.tsx`, content: tsx },
    { path: cssPath, content: css },
    { path: `${dir}/${name}.stories.tsx`, content: stories },
    { path: `${dir}/${name}${config.components.docsSuffix}`, content: docs },
    ...(input.interactive ? [{ path: `${dir}/${name}.test.tsx`, content: test }] : []),
    { path: `${dir}/index.ts`, content: index },
  ];
  const notes = [
    'Tier 2 (new component): open as a draft PR until design review. Ask the design owner before building it.',
    `Export it: add \`export * from './components/${name}';\` under the ${input.family} family in ${config.components.index ?? 'the package index'}.`,
    'Fill the docs.json fields (whenToUse, dos/donts with examples, accessibility, contentGuidelines, anatomy keyed by CSS class).',
    'States: hover inside @media (hover: hover), :focus-visible ring, active, disabled, invalid, loading where relevant. Check light, dark, every brand, compact density.',
    'Portaled popups spread useScopeAttributes() so theme, brand and density follow.',
    'Add a changeset (minor).',
  ];
  return { files, notes };
}
