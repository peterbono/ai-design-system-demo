#!/usr/bin/env node
// Builds the Bridge Library as a Claude "Design System" artifact: the file tree a Claude session publishes under
// `project/`, so Claude Design canvases mount the real @bridge-ds/react components (window.Bridge.Button …)
// instead of look-alikes.
//
//   npm run claude-ds                         write dist/claude-design-system/project/…
//   npm run claude-ds -- --out <dir>          write <dir>/project/…
//
// Sources, never retyped: packages/react/src (bundle, props through the TypeScript checker, Name.docs.json,
// Name.stories.tsx), packages/react/component-specs.json (examples), packages/tokens/dist (tokens.css, resolved.json),
// docs/DESIGN-LANGUAGE.md. The output is deterministic for a commit: timestamps come from the HEAD commit.
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  GOOGLE_FONTS_URL,
  NAMESPACE,
  TITLE,
  buildTokensJson,
  isComponentExport,
  parseCssBlocks,
  parseFamilies,
  parseStories,
  parseValueExports,
  renderCard,
  renderCover,
  renderDts,
  renderGuidelines,
  renderPreview,
  renderReadme,
  resolveDefaultScope,
  treeUses,
} from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REACT_SRC = join(ROOT, 'packages/react/src');
const read = (p) => readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));

// ---------------------------------------------------------------------------------------------------------------
// 1. The bundle: one IIFE assigning window.Bridge, React and ReactDOM read from the page.

const REACT_SHIMS = {
  react: 'module.exports = window.React;',
  'react-dom': 'module.exports = window.ReactDOM;',
  'react-dom/client': 'module.exports = window.ReactDOM;',
  'react/jsx-runtime': `var R = window.React;
export var Fragment = R.Fragment;
export function jsx(type, props, key) { return R.createElement(type, key === undefined ? props : Object.assign({}, props, { key: key })); }
export var jsxs = jsx;`,
};

/** react, react-dom and the jsx runtime resolve to the page's globals: the bundle never carries a React copy. */
const reactGlobals = {
  name: 'react-globals',
  setup(build) {
    build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => {
      if (!(args.path in REACT_SHIMS)) {
        return { errors: [{ text: `${args.path} is imported by ${args.importer}; add a shim for it in REACT_SHIMS` }] };
      }
      return { path: args.path, namespace: 'react-global' };
    });
    build.onLoad({ filter: /.*/, namespace: 'react-global' }, (args) => ({
      contents: REACT_SHIMS[args.path],
      loader: args.path === 'react/jsx-runtime' ? 'js' : 'js',
    }));
  },
};

/** Workspace packages resolve to this checkout's sources (root node_modules may link another checkout). */
const workspaceSources = {
  name: 'workspace-sources',
  setup(build) {
    build.onResolve({ filter: /^@bridge-ds\/tokens$/ }, () => ({ path: join(ROOT, 'packages/tokens/dist/tokens.ts') }));
  },
};

/**
 * Canvas adapter, bundle only: icon props also take a Lucide name ("Check"), since a canvas writes attributes as
 * strings. The real Icon renders; only the lookup is added. The published package keeps its typed API.
 */
const ICON_FILE = /components[\\/]Icon[\\/]Icon\.tsx$/;
const ICON_EXPORT = 'export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(';
const iconByName = {
  name: 'icon-by-name',
  setup(build) {
    build.onLoad({ filter: ICON_FILE }, (args) => {
      const src = read(args.path);
      if (!src.includes(ICON_EXPORT)) {
        return { errors: [{ text: `Icon.tsx no longer declares "${ICON_EXPORT}"; update the canvas adapter in scripts/claude-design-system/build.mjs` }] };
      }
      const contents = `${src.replace(ICON_EXPORT, 'const IconBase = forwardRef<SVGSVGElement, IconProps>(function Icon(')}
import { icons as __lucideIcons } from 'lucide-react';
export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(props, ref) {
  const named = typeof (props.icon as unknown) === 'string';
  const glyph = named ? (__lucideIcons as Record<string, LucideIcon>)[props.icon as unknown as string] : props.icon;
  if (!glyph) {
    if (named) console.warn('[Bridge] Unknown Lucide icon "' + (props.icon as unknown as string) + '". Use a name from Bridge.Icons, like "Check".');
    return null;
  }
  return <IconBase {...props} icon={glyph} ref={ref} />;
});
`;
      return { contents, loader: 'tsx' };
    });
  },
};

export async function buildBundle() {
  const result = await esbuild.build({
    stdin: {
      contents: `import * as B from './packages/react/src/index.ts';
import { icons } from 'lucide-react';
const ns = Object.assign({}, B, { Icons: icons });
window.${NAMESPACE} = Object.assign(window.${NAMESPACE} || {}, ns);`,
      resolveDir: ROOT,
      sourcefile: 'claude-design-system-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2019',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    jsx: 'automatic',
    conditions: ['source'],
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.module.css': 'local-css', '.css': 'css' },
    outdir: join(ROOT, 'node_modules/.cache/claude-design-system'),
    write: false,
    plugins: [reactGlobals, workspaceSources, iconByName],
    logLevel: 'silent',
  });
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
  return { js, css };
}

/** Runs the bundle in jsdom on React 18 UMD and returns the namespace, the way a canvas artboard would. */
export async function loadBundle(js) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const req = createRequire(join(ROOT, 'package.json'));
  const umd = (p) => { const [pkg, ...rest] = p.split('/'); return read(join(dirname(req.resolve(`${pkg}/package.json`)), ...rest)); };
  dom.window.eval(umd('react/umd/react.production.min.js'));
  dom.window.eval(umd('react-dom/umd/react-dom.production.min.js'));
  dom.window.eval(js);
  return dom;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Props through the TypeScript checker: each component's own props (declared in packages/react/src).

/** Destructuring defaults of `function Name({ a = 'x', b = 2 }` in the component sources: name -> prop -> value. */
export function parseDefaults(source) {
  const out = new Map();
  for (const m of source.matchAll(/function (\w+)\(\s*\{([^}]*)\}/g)) {
    const props = new Map();
    for (const d of m[2].matchAll(/(\w+)\s*=\s*('[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|true|false)/g)) props.set(d[1], d[2].replace(/^["']|["']$/g, ''));
    if (props.size && !out.has(m[1])) out.set(m[1], props);
  }
  return out;
}

export async function extractProps(names, defaults = new Map()) {
  const ts = (await import('typescript')).default;
  const configPath = join(ROOT, 'packages/react/tsconfig.json');
  const cfg = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  const entry = join(REACT_SRC, 'index.ts');
  const program = ts.createProgram([entry], { ...cfg.options, noEmit: true });
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(entry));
  const exportsByName = new Map(checker.getExportsOfModule(moduleSymbol).map((s) => [s.name, s]));
  const fmt = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
  const out = new Map();
  for (const name of names) {
    let sym = exportsByName.get(name);
    if (!sym) continue;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    const type = checker.getTypeOfSymbolAtLocation(sym, decl);
    const sig = type.getCallSignatures()[0];
    const param = sig?.getParameters()[0];
    if (!param) {
      out.set(name, { props: [], passthrough: [] });
      continue;
    }
    const propsType = checker.getTypeOfSymbolAtLocation(param, decl);
    const own = [];
    const passthrough = new Set();
    for (const p of checker.getPropertiesOfType(propsType)) {
      const d = p.valueDeclaration ?? p.declarations?.[0];
      const file = d?.getSourceFile().fileName ?? '';
      if (p.name === 'key' || p.name === 'ref') continue;
      if (!file.startsWith(REACT_SRC)) {
        if (/@types[\\/]react/.test(file)) passthrough.add('native element attributes (className, style, aria-*, on* handlers)');
        else if (/@base-ui/.test(file)) passthrough.add('Base UI props of the underlying part');
        else if (/lucide-react/.test(file)) passthrough.add('Lucide SVG props');
        continue;
      }
      const doc = ts.displayPartsToString(p.getDocumentationComment(checker)).trim();
      const pt = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(p, d));
      // Unions of literals print their values ("primary" | "secondary"), not the alias name (ButtonVariant).
      const literal = (u) => u.isStringLiteral() || u.isNumberLiteral() || (u.flags & ts.TypeFlags.BooleanLiteral) !== 0;
      const t = pt.isUnion() && pt.types.every(literal)
        ? [...new Set(pt.types.map((u) => checker.typeToString(u)))].join(' | ').replace('false | true', 'boolean')
        : checker
            .typeToString(pt, undefined, fmt)
            .replace(/ReactElement<any, string \| JSXElementConstructor<any>>/g, 'ReactElement')
            .replace(/string \| number \| boolean \| ReactElement \| Iterable<ReactNode> \| ReactPortal/g, 'ReactNode');
      const optional = (p.flags & ts.SymbolFlags.Optional) !== 0;
      const def = defaults.get(name)?.get(p.name) ?? /Default:?\s*`([^`]+)`/i.exec(doc)?.[1] ?? null;
      own.push({ name: p.name, type: t, optional, doc, default: def });
    }
    out.set(name, { props: own, passthrough: [...passthrough] });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 3. The file tree

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * The commit and its date, from git; a build without the history falls back to the environment
 * (VERCEL_GIT_COMMIT_SHA, SOURCE_DATE_EPOCH) so the docs-site build never fails on it.
 */
function headStamp() {
  try {
    return { commit: git('rev-parse', '--short', 'HEAD'), at: new Date(git('show', '-s', '--format=%cI', 'HEAD')).toISOString() };
  } catch {
    const epoch = Number(process.env.SOURCE_DATE_EPOCH);
    const at = new Date(Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : Date.now()).toISOString();
    return { commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown').slice(0, 9), at };
  }
}

export async function generate({ outDir }) {
  const project = join(outDir, 'project');
  rmSync(project, { recursive: true, force: true });
  const files = new Map();
  const put = (path, text) => files.set(path, text);

  const { commit, at } = headStamp();
  const reactPkg = readJson(join(ROOT, 'packages/react/package.json'));
  const tokensCssPath = join(ROOT, 'packages/tokens/dist/tokens.css');
  if (!existsSync(tokensCssPath)) throw new Error('packages/tokens/dist/tokens.css is missing: run npm run tokens:build first.');
  const tokensCss = read(tokensCssPath);

  // Bundle and its exports
  const { js, css } = await buildBundle();
  const dom = await loadBundle(js);
  const ns = dom.window[NAMESPACE];
  const exported = Object.keys(ns).filter((k) => k !== 'Icons' && isComponentExport(k, ns[k]));
  const exportSet = new Set(exported);
  const iconCount = Object.keys(ns.Icons).length;
  dom.window.close();

  // Families and folders, from the entry file
  const families = parseFamilies(read(join(REACT_SRC, 'index.ts')));
  const folderOf = new Map();
  const familyOf = new Map();
  const membersOf = new Map();
  for (const { family, folder } of families) {
    const idx = folder === 'theme' ? join(REACT_SRC, 'theme/index.ts') : join(REACT_SRC, 'components', folder, 'index.ts');
    const names = parseValueExports(read(idx)).filter((n) => exportSet.has(n));
    membersOf.set(folder, names);
    for (const n of names) {
      folderOf.set(n, folder);
      familyOf.set(n, family);
    }
  }
  const missing = exported.filter((n) => !folderOf.has(n));
  if (missing.length) throw new Error(`Exports with no family in packages/react/src/index.ts: ${missing.join(', ')}`);

  const specs = new Map(readJson(join(ROOT, 'packages/react/component-specs.json')).components.map((c) => [c.name, c]));
  const defaults = new Map();
  for (const { folder } of families) {
    const dir = folder === 'theme' ? join(REACT_SRC, 'theme') : join(REACT_SRC, 'components', folder);
    for (const f of readdirSync(dir).filter((x) => /^[A-Z]\w*\.tsx$/.test(x) && !/\.(stories|test)\.tsx$/.test(x))) {
      for (const [n, m] of parseDefaults(read(join(dir, f)))) if (!defaults.has(n)) defaults.set(n, m);
    }
  }
  const propsByName = await extractProps(exported, defaults);

  // Cards, guidelines, previews
  const cards = [];
  const header = [];
  for (const { family, folder } of families) {
    const dir = join(REACT_SRC, 'components', folder);
    const docsPath = join(dir, `${folder}.docs.json`);
    const docs = existsSync(docsPath) ? readJson(docsPath) : null;
    const storiesPath = join(dir, `${folder}.stories.tsx`);
    const stories = existsSync(storiesPath) ? parseStories(read(storiesPath)) : null;
    const members = membersOf.get(folder);
    if (docs) {
      put(`components/${folder}/README.md`, renderGuidelines({ folder, docs }));
      if (docs.preview && exportSet.has(folder)) {
        put(`components/${folder}/preview.html`, renderPreview({ group: family, tree: docs.preview }));
      }
    }
    for (const name of members) {
      const isMain = name === folder || members.length === 1;
      const { props, passthrough } = propsByName.get(name) ?? { props: [], passthrough: [] };
      let example = null;
      if (docs?.preview && treeUses(docs.preview, name)) example = docs.preview;
      else if (docs) {
        const fromDocs = [...(docs.dos ?? []), ...(docs.donts ?? [])].map((d) => d.example).find((e) => treeUses(e, name));
        if (fromDocs) example = fromDocs;
      }
      if (!example && specs.get(name)?.example && treeUses(specs.get(name).example, name)) example = specs.get(name).example;
      if (!example && name === 'ThemeProvider') example = { c: 'ThemeProvider', p: { theme: 'light' }, children: [{ c: 'Button', p: { variant: 'primary' }, children: ['Publish tokens'] }] };
      const iconProps = props.filter((p) => /LucideIcon/.test(p.type)).map((p) => p.name);
      const summary = isMain ? docs?.summary ?? null : null;
      put(
        `api/components/${name}.md`,
        renderCard({ name, folder, family, docs, props, passthrough, siblings: members.filter((m) => m !== name), stories: isMain ? stories : null, example, exports: exportSet, isMain, iconProps }),
      );
      cards.push({ name, family, summary: summary ?? (isMain ? `${name} from @bridge-ds/react.` : `Part of ${folder}.`), props });
      header.push({ name });
    }
  }

  // Bundle files
  const bundleHeader = `/* @ds-bundle: ${JSON.stringify({ format: 4, namespace: NAMESPACE, components: header })} */`;
  const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '\\x3C!--');
  put('components/bundle.js', `${bundleHeader}\n${safeJs}`);
  const base = read(join(REACT_SRC, 'styles/base.css'));
  put(
    'components/bundle.css',
    [`@import url("${GOOGLE_FONTS_URL}");`, '/* Bridge tokens (packages/tokens/dist/tokens.css) */', tokensCss, '/* Global base (packages/react/src/styles/base.css) */', base, '/* Components (CSS Modules) */', css].join('\n'),
  );
  put('components/index.d.ts', renderDts(cards));
  put('components/Cover/preview.html', renderCover());

  // Tokens
  const blocks = parseCssBlocks(tokensCss);
  const light = resolveDefaultScope(blocks, { theme: 'light' });
  const dark = resolveDefaultScope(blocks, { theme: 'dark' });
  const resolved = readJson(join(ROOT, 'packages/tokens/dist/resolved.json'));
  const meta = {
    source: 'github',
    repo: 'the-bridge-company/ai-design-system-demo',
    ref: `main@${commit}`,
    package: 'packages/react',
    paths: { tokens: ['packages/tokens/dist/tokens.css', 'packages/tokens/dist/resolved.json'], docs: ['docs/DESIGN-LANGUAGE.md', 'packages/react/src/components/*/*.docs.json'] },
    synced: at,
  };
  put('tokens.json', `${JSON.stringify(buildTokensJson({ resolved, light, dark, meta }), null, 2)}\n`);
  put('tokens.css', `/* ${TITLE} — generated from tokens.json */\n${tokensCss}`);

  // Docs
  put('README.md', renderReadme({ version: reactPkg.version, commit, families: 'Fraunces, Instrument Sans, IBM Plex Sans, IBM Plex Mono', cards, iconCount }));
  put('design-language.md', read(join(ROOT, 'docs/DESIGN-LANGUAGE.md')));
  put('api/icons.md', `# Icons\n\nLucide icons, ${iconCount} of them, in \`${NAMESPACE}.Icons\`. Every icon prop takes the PascalCase name as a string: \`icon="GitPullRequest"\`. A lone icon: \`<x-import component-from-global-scope="${NAMESPACE}.Icon" icon="Lock" size="md"></x-import>\` (sizes xs 12, sm 16, md 20, lg 24; \`label\` names a meaningful icon). Names: https://lucide.dev/icons\n`);

  // The index, written last when published.
  const index = {
    v: 3,
    layout: 'files',
    createdOnFiles: { v: 1, at },
    title: TITLE,
    namespace: NAMESPACE,
    libraries: [
      { name: 'react', version: '18' },
      { name: 'react-dom', version: '18' },
    ],
    sections: {},
    groups: [],
    assetGroups: {},
    blobs: {},
    docs: { sections: [] },
    editing: 'code',
    lastChange: { by: 'Bridge', at, via: `GitHub · the-bridge-company/ai-design-system-demo@${commit}`, note: `@bridge-ds/react ${reactPkg.version}, ${cards.length} components` },
  };
  put('design-system.json', `${JSON.stringify(index, null, 2)}\n`);

  for (const [path, text] of files) {
    const target = join(project, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return { project, files, version: reactPkg.version, commit, cards, exported, iconCount, bundleBytes: Buffer.byteLength(files.get('components/bundle.js')), cssBytes: Buffer.byteLength(files.get('components/bundle.css')) };
}

// ---------------------------------------------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, 'dist/claude-design-system');
  const r = await generate({ outDir });
  const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
  console.log(`claude-ds: ${r.files.size} files in ${relative(process.cwd(), r.project) || r.project}`);
  console.log(`claude-ds: ${r.cards.length} components on window.${NAMESPACE}, ${r.iconCount} icons; bundle.js ${kb(r.bundleBytes)}, bundle.css ${kb(r.cssBytes)}`);
  const big = [...r.files].filter(([, t]) => Buffer.byteLength(t) > 15 * 1024 * 1024);
  if (big.length) {
    console.error(`claude-ds: over the 15 MiB file cap: ${big.map(([p]) => p).join(', ')}`);
    process.exit(1);
  }
}
