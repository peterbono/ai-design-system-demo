// Pure helpers of the Claude Design System generator (scripts/claude-design-system/build.mjs).
// Everything here takes data in and returns text out, so the test suite can check it without a build.

export const NAMESPACE = 'Bridge';
export const TITLE = 'Bridge Library';

/** Hosted faces the tokens name: Fraunces (display), Instrument Sans (bridge UI), IBM Plex Sans (ocean UI), IBM Plex Mono. */
export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,100..900,0..100;1,9..144,100..900,0..100' +
  '&family=Instrument+Sans:wght@400..700&family=IBM+Plex+Sans:ital,wght@0,100..700;1,100..700&family=IBM+Plex+Mono:wght@400;500&display=swap';

/** A component export, as the docs site registry decides it (apps/docs-site/src/components/registry.tsx). */
export const isComponentExport = (name, value) =>
  /^[A-Z]/.test(name) && (typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value));

const kebab = (s) => s.replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase());
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------------------------------------------
// Source parsing

/**
 * Families from packages/react/src/index.ts: a `// Family` comment followed by `export * from './components/X'`.
 * Returns [{ family, folder }] in the order of the entry file.
 */
export function parseFamilies(indexSource) {
  const out = [];
  let family = null;
  for (const line of indexSource.split('\n')) {
    const comment = /^\/\/\s*([A-Z][A-Za-z ]+)$/.exec(line.trim());
    if (comment) family = comment[1].trim();
    const exp = /^export \* from '\.\/(?:components\/)?([A-Za-z]+)';/.exec(line.trim());
    if (exp && family) out.push({ family, folder: exp[1] === 'theme' ? 'theme' : exp[1] });
  }
  return out;
}

/** Value exports (not `export type`) of a component folder's index.ts. */
export function parseValueExports(folderIndexSource) {
  const names = [];
  for (const m of folderIndexSource.matchAll(/^export\s+\{([^}]*)\}\s+from/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+.*/, '').split(/\s+as\s+/).pop().trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/** Story export names of a `*.stories.tsx` file, in file order. */
export function parseStories(storiesSource) {
  const title = /title:\s*'([^']+)'/.exec(storiesSource)?.[1] ?? null;
  const stories = [...storiesSource.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
  return { title, stories };
}

// ---------------------------------------------------------------------------------------------------------------
// Tokens

/** Parses a compiled tokens.css into ordered blocks: [{ selector, decls: [{ name, value, note }] }]. Top-level only. */
export function parseCssBlocks(css) {
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const text = css.replace(/@media[^{]*\{([^{}]*\{[^{}]*\})*\s*\}/g, ''); // drop @media blocks (reduced motion)
  for (const m of text.matchAll(re)) {
    const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const decls = [];
    for (const d of m[2].matchAll(/--([A-Za-z0-9-]+):\s*([^;]+);[ \t]*(?:\/\*\*?\s*([\s\S]*?)\s*\*\/)?/g)) {
      decls.push({ name: d[1], value: d[2].trim(), note: d[3]?.trim() || '' });
    }
    blocks.push({ selector, decls });
  }
  return blocks;
}

/**
 * Variables visible in the default scope (bridge brand, light theme, comfortable density): every block whose selector
 * list contains :root or one of those attributes. Later blocks win, as in the cascade. var() chains are resolved.
 */
export function resolveDefaultScope(blocks, { brand = 'bridge', theme = 'light', density = 'comfortable' } = {}) {
  const wanted = [':root', `[data-brand="${brand}"]`, `[data-theme="${theme}"]`, `[data-density="${density}"]`];
  const raw = new Map();
  const notes = new Map();
  for (const b of blocks) {
    const parts = b.selector.split(',').map((s) => s.trim());
    if (!parts.some((p) => wanted.includes(p))) continue;
    for (const d of b.decls) {
      raw.set(d.name, d.value);
      if (d.note) notes.set(d.name, d.note);
    }
  }
  const resolve = (value, depth = 0) =>
    depth > 16 ? value : value.replace(/var\(--([A-Za-z0-9-]+)\)/g, (all, n) => (raw.has(n) ? resolve(raw.get(n), depth + 1) : all));
  const values = new Map([...raw].map(([k, v]) => [k, resolve(v)]));
  return { values, notes, raw };
}

const firstSentence = (s, max = 300) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  const cut = t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}.` : t;
  return cut;
};

/** Font stacks for tokens.json `type.families`: the format refuses parentheses, semicolons and braces. */
const cleanStack = (s) => s.replace(/[;{}<>\\()]/g, '').slice(0, 200);

/**
 * tokens.json in the Design System type's shape (lists, not DTCG maps): color (light + dark, bridge brand),
 * spacing, radius, shadow, type. Values come from the built Bridge tokens, never typed by hand.
 */
export function buildTokensJson({ resolved, light, dark, meta }) {
  // resolved.json also carries shadows (elevation.*): only single color values go to the color family.
  const isColor = (v) => typeof v === 'string' && /^(#[0-9a-fA-F]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch)\([^()]*\))$/.test(v.trim());
  const colorNames = Object.keys(resolved.values.bridge.light).filter(
    (k) => isColor(resolved.values.bridge.light[k]) && isColor(resolved.values.bridge.dark[k] ?? resolved.values.bridge.light[k]),
  );
  const cssName = (k) => k.replace(/\./g, '-');
  const color = {
    themes: [
      { id: 'light', name: 'Light' },
      { id: 'dark', name: 'Dark' },
    ],
    tokens: colorNames.map((k) => {
      const name = cssName(k);
      const usage = firstSentence(light.notes.get(name) || dark.notes.get(name) || `Semantic color ${k}.`);
      return { name, value: { light: resolved.values.bridge.light[k], dark: resolved.values.bridge.dark[k] }, usage };
    }),
  };
  const family = (prefix, filter = () => true) =>
    [...light.values]
      .filter(([n]) => n.startsWith(prefix) && filter(n))
      .map(([name, value]) => ({ name, value, usage: firstSentence(light.notes.get(name) || '') || undefined }))
      .map((t) => (t.usage ? t : { name: t.name, value: t.value }));
  const px = (v) => /^-?\d+(\.\d+)?(px|rem|em|%)?$/.test(v);
  const spacing = family('space-', (n) => px(light.values.get(n)));
  const radius = family('radius-', (n) => px(light.values.get(n)));
  const shadow = [...light.values]
    .filter(([n]) => /^elevation-/.test(n))
    .map(([name, value]) => ({ name, value: { light: value, dark: dark.values.get(name) ?? value }, usage: firstSentence(light.notes.get(name) || '') || 'Elevation.' }));

  const famKey = (stack) => (/Fraunces/.test(stack) ? 'display' : /Mono/.test(stack) ? 'mono' : 'sans');
  const families = {
    display: cleanStack(light.values.get('font-family-display') ?? ''),
    sans: cleanStack(light.values.get('font-family-sans') ?? ''),
    mono: cleanStack(light.values.get('font-family-mono') ?? ''),
  };
  const roles = [...new Set([...light.values.keys()].filter((n) => /^typography-[a-z0-9]+-size$/.test(n)).map((n) => n.split('-')[1]))];
  const styles = roles.map((role) => {
    const get = (p) => light.values.get(`typography-${role}-${p}`);
    const style = { name: role, fontSize: get('size'), lineHeight: get('line-height'), fontWeight: Number(get('weight')) || 400 };
    const tracking = get('tracking');
    if (tracking && /^-?[\d.]+(px|em|rem)$/.test(tracking)) style.letterSpacing = tracking;
    style.family = famKey(get('family') ?? '');
    const note = light.notes.get(`typography-${role}-size`);
    if (note) style.usage = firstSentence(note);
    return style;
  });
  return {
    name: TITLE,
    version: 1,
    meta,
    color,
    type: {
      fonts: [],
      families,
      groups: [{ name: 'Roles', family: 'sans', styles }],
    },
    spacing: { tokens: spacing },
    radius: { tokens: radius },
    shadow: { tokens: shadow },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Example trees (Name.docs.json `preview`, component-specs.json `example`) to markup

/** Docs-only layout helpers of the docs site registry. */
export const LAYOUT = {
  Row: 'display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center;',
  Box: 'max-width: 26rem; width: 100%;',
};

/**
 * One example tree node to Claude Design markup: `<x-import component-from-global-scope="Bridge.X" …>`.
 * Strings are attributes; booleans, numbers, arrays and objects become `{{ }}` holes whose values are returned in
 * `vals` for the artboard's renderVals().
 */
export function treeToXImport(node, exports, vals = {}, indent = '') {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return indent + escText(node);
  const { c, p = {}, children = [] } = node;
  const kids = (Array.isArray(children) ? children : [children]).map((k) => treeToXImport(k, exports, vals, `${indent}  `)).filter(Boolean);
  if (!exports.has(c)) {
    const style = LAYOUT[c] ?? '';
    return `${indent}<div${style ? ` style="${style}"` : ''}>\n${kids.join('\n')}\n${indent}</div>`;
  }
  const attrs = [];
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'string') attrs.push(`${kebab(k)}="${escAttr(v)}"`);
    else {
      let key = k;
      for (let i = 2; key in vals && JSON.stringify(vals[key]) !== JSON.stringify(v); i++) key = `${k}${i}`;
      vals[key] = v;
      attrs.push(`${kebab(k)}="{{${key}}}"`);
    }
  }
  const open = `<x-import component-from-global-scope="${NAMESPACE}.${c}"${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
  if (!kids.length) return `${indent}${open}</x-import>`;
  if (kids.length === 1 && !kids[0].trim().startsWith('<')) return `${indent}${open}${kids[0].trim()}</x-import>`;
  return `${indent}${open}\n${kids.join('\n')}\n${indent}</x-import>`;
}

/** The same tree as a React.createElement call string, for a card's React example. */
export function treeToJsx(node, exports, indent = '') {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return indent + escText(node);
  const { c, p = {}, children = [] } = node;
  const tag = exports.has(c) ? `${NAMESPACE}.${c}` : 'div';
  const style = exports.has(c) ? '' : LAYOUT[c] ? ` style={{ ${cssToObject(LAYOUT[c])} }}` : '';
  const attrs = Object.entries(p).map(([k, v]) => (typeof v === 'string' ? `${k}="${escAttr(v)}"` : `${k}={${JSON.stringify(v)}}`));
  const kids = (Array.isArray(children) ? children : [children]).map((k) => treeToJsx(k, exports, `${indent}  `)).filter(Boolean);
  const open = `<${tag}${style}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
  if (!kids.length) return `${indent}${open} />`;
  if (kids.length === 1 && !kids[0].trim().startsWith('<')) return `${indent}${open}>${kids[0].trim()}</${tag}>`;
  return `${indent}${open}>\n${kids.join('\n')}\n${indent}</${tag}>`;
}

function cssToObject(css) {
  return css
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [k, ...v] = d.split(':');
      return `${k.trim().replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())}: '${v.join(':').trim()}'`;
    })
    .join(', ');
}

/** True when the tree mounts `name` somewhere. */
export function treeUses(node, name) {
  if (!node || typeof node !== 'object') return false;
  if (node.c === name) return true;
  return (Array.isArray(node.children) ? node.children : [node.children]).some((k) => treeUses(k, name));
}

// ---------------------------------------------------------------------------------------------------------------
// Cards, guidelines, previews, README

const list = (items) => (items ?? []).map((t) => `- ${typeof t === 'string' ? t : `**${t.title}.** ${t.text ?? ''}`.trim()}`).join('\n');

/** components/<Folder>/README.md: the guidance of Name.docs.json, first sentence = summary. */
export function renderGuidelines({ folder, docs }) {
  const parts = [`# ${folder}`, '', docs.summary ?? ''];
  const section = (title, body) => body && parts.push('', `## ${title}`, '', body);
  section('When to use', list(docs.whenToUse));
  section('When not to use', list(docs.whenNotToUse));
  section('Do', list(docs.dos));
  section("Don't", list(docs.donts));
  section('Accessibility', list(docs.accessibility));
  section('Content', list(docs.contentGuidelines));
  return `${parts.join('\n').trim()}\n`;
}

const propTable = (props) => {
  if (!props.length) return 'No props of its own.';
  const rows = props.map((p) => {
    const type = p.type.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const def = p.default != null ? `\`${p.default}\`` : '';
    const doc = (p.doc || '').replace(/\n+/g, ' ').replace(/\|/g, '\\|');
    return `| \`${kebab(p.name)}\`${p.name !== kebab(p.name) ? ` (${p.name})` : ''} | \`${type}\`${p.optional ? '' : ' (required)'} | ${def} | ${doc} |`;
  });
  return ['| Attribute (prop) | Type | Default | Notes |', '| --- | --- | --- | --- |', ...rows].join('\n');
};

/**
 * project/api/components/<Comp>.md: what a canvas reads before mounting. Purpose, x-import and React examples, props
 * with values, parts and sibling exports, stories, the guideline file.
 */
export function renderCard({ name, folder, family, docs, props, passthrough, siblings, stories, example, exports, isMain, iconProps }) {
  const vals = {};
  const tree = example ?? { c: name, children: [] };
  const xi = treeToXImport(tree, exports, vals);
  const jsx = treeToJsx(tree, exports);
  const summary = isMain ? docs?.summary : null;
  const lines = [
    `# ${name}`,
    '',
    summary || (isMain ? `${name} from @bridge-ds/react.` : `Part of ${folder}: ${firstSentence(docs?.summary ?? '', 200)}`),
    '',
    `- Global: \`${NAMESPACE}.${name}\` · family: ${family} · source: \`packages/react/src/components/${folder}/\``,
    `- Guidelines: \`components/${folder}/README.md\`${siblings.length ? ` · same family: ${siblings.map((s) => `\`${NAMESPACE}.${s}\``).join(', ')}` : ''}`,
    '',
    '## On a Design canvas',
    '',
    'Inside `Bridge.ThemeProvider` (see the README, Consuming this system):',
    '',
    '```html',
    xi,
    '```',
  ];
  if (Object.keys(vals).length) {
    lines.push('', 'Values for the `{{ }}` holes, from the artboard script:', '', '```js', `renderVals() { return ${JSON.stringify(vals)}; }`, '```');
  }
  lines.push('', '## In React', '', '```jsx', jsx, '```', '', '## Props', '', propTable(props));
  if (iconProps.length) {
    lines.push(
      '',
      `Icon props (${iconProps.map((p) => `\`${kebab(p)}\``).join(', ')}) take a Lucide icon name as a string on a canvas (\`icon="Check"\`), or the component \`Bridge.Icons.Check\`.`,
    );
  }
  if (passthrough.length) lines.push('', `Also passes through: ${passthrough.join('; ')}.`);
  if (stories?.stories?.length) lines.push('', '## Storybook stories', '', `\`${stories.title}\`: ${stories.stories.join(', ')}.`);
  if (isMain && docs?.anatomy) {
    lines.push('', '## Parts', '', ...Object.entries(docs.anatomy).map(([k, v]) => `- \`${k}\`: ${v}`));
  }
  if (isMain && docs?.whenToUse?.length) lines.push('', '## When to use', '', list(docs.whenToUse.slice(0, 6)));
  if (isMain && docs?.whenNotToUse?.length) lines.push('', '## When not to use', '', list(docs.whenNotToUse.slice(0, 4)));
  return `${lines.join('\n')}\n`;
}

/** components/<Folder>/preview.html: mounts the docs preview tree with the real bundle inside ThemeProvider. */
export function renderPreview({ group, tree, height = 120 }) {
  return `<!-- @dsCard group="${escAttr(group)}" height=${height} -->
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Preview</title>
<style>body { margin: 0; } #root > div { padding: var(--space-4); }</style>
</head>
<body>
<div id="root"></div>
<script>
  var B = window.${NAMESPACE}, h = React.createElement;
  var LAYOUT = ${JSON.stringify({ Row: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' }, Box: { maxWidth: '26rem', width: '100%' } })};
  function r(n, i) {
    if (n == null || typeof n !== 'object') return n;
    var kids = [].concat(n.children || []).map(r);
    var C = B[n.c];
    var props = Object.assign({ key: i }, n.p || {});
    if (!C) return h.apply(null, ['div', { key: i, style: LAYOUT[n.c] || {} }].concat(kids));
    return h.apply(null, [C, props].concat(kids));
  }
  var tree = ${JSON.stringify(tree).replace(/</g, '\\u003c')};
  var theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  ReactDOM.createRoot(document.getElementById('root')).render(h(B.ThemeProvider, { theme: theme }, r(tree, 0)));
</script>
</body>
</html>
`;
}

/** project/components/index.d.ts: types as documentation, one `<Comp>Props` per card. */
export function renderDts(cards) {
  const out = ["import type * as React from 'react';", ''];
  for (const c of cards) {
    out.push(`/** ${firstSentence(c.summary ?? '', 240).replace(/\*\//g, '* /')} */`);
    out.push(`export interface ${c.name}Props {`);
    for (const p of c.props) {
      if (p.doc) out.push(`  /** ${p.doc.replace(/\s+/g, ' ').replace(/\*\//g, '* /')} */`);
      out.push(`  ${/^[A-Za-z_$][\w$]*$/.test(p.name) ? p.name : JSON.stringify(p.name)}${p.optional ? '?' : ''}: ${p.type.replace(/\s+/g, ' ')};`);
    }
    out.push('  [passthrough: string]: unknown;', '}', `export declare const ${c.name}: React.ComponentType<${c.name}Props>;`, '');
  }
  out.push('export declare const Icons: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>>;');
  out.push(`declare global { interface Window { ${NAMESPACE}: { ${cards.map((c) => `${c.name}: typeof ${c.name}`).join('; ')}; Icons: typeof Icons } } }`, '');
  return out.join('\n');
}

/** project/README.md: brand book first, then the generated Consuming and Index sections. */
export function renderReadme({ version, commit, families, cards, iconCount }) {
  const byFamily = new Map();
  for (const c of cards) {
    if (!byFamily.has(c.family)) byFamily.set(c.family, []);
    byFamily.get(c.family).push(c);
  }
  const index = [...byFamily]
    .map(([fam, cs]) => [`### ${fam}`, '', ...cs.map((c) => `- [${c.name}](api/components/${c.name}.md): ${firstSentence(c.summary ?? '', 160)}`)].join('\n'))
    .join('\n\n');
  return `# Bridge Library

The Bridge design system as React components: \`@bridge-ds/react\` ${version}, built from \`${commit}\`. Base UI behavior, styled only with Bridge tokens. Use the real components below on a canvas, never markup that imitates them: Bridge audits flag look-alikes.

## Brand in one screen

- **Type.** Fraunces for display and page titles (\`--font-family-display\`), Instrument Sans for body and UI (\`--font-family-sans\`), IBM Plex Mono for token names, values and code (\`--font-family-mono\`). At most four sizes on a first screen.
- **Color.** White paper (\`--color-bg-default\`), ink text (\`--color-text-default\`, muted \`--color-text-muted\`). Deep Harbor (\`--color-action-primary-bg\`, \`--color-surface-strong\`) is the only strong color: one primary action per view. One Harbor zone per screen (\`--color-bg-zone\`) for a hero or a section opener, never behind dense UI.
- **Shape.** Radius by rank: \`--radius-inset\` inside controls, \`--radius-control\` for buttons and inputs, \`--radius-container\` for cards, \`--radius-overlay\` for dialogs, \`--radius-pill\` for badges and switches.
- **Space.** A 4px scale (\`--space-1\` 4px to \`--space-24\` 96px). Controls are 32/40/48px tall in comfortable density.
- **Voice.** Sentence case, verbs on buttons ("Publish tokens"), errors that say how to fix. No em dashes, no "OK" or "Click here".
- **Icons.** Lucide, 1.75 stroke, through \`Bridge.Icon\` or a component's icon prop. Never emoji.

The full design language is the next section of this system.

---

## Consuming this system

- **Namespace:** \`window.${NAMESPACE}\` from \`components/bundle.js\` (one classic IIFE script). React 18 and ReactDOM 18 are NOT inside: it reads \`window.React\` and \`window.ReactDOM\`, which a Design canvas artboard already has.
- **Load order on a Design canvas** (after the \`support.js\` line): \`<link rel="stylesheet" href="ds/bridge/tokens.css">\`, \`<link rel="stylesheet" href="ds/bridge/components/bundle.css">\`, then \`<script src="ds/bridge/components/bundle.js"></script>\`. \`bundle.css\` repeats the full token set and imports the fonts, so it also works alone.
- **Provider:** wrap the artboard content in \`<x-import component-from-global-scope="${NAMESPACE}.ThemeProvider">…</x-import>\`. It sets \`data-theme\`, \`data-brand\` and \`data-density\`; \`theme="dark"\`, \`brand="ocean"\`, \`density="compact"\` switch them. Plain markup inside uses the tokens: \`background: var(--color-bg-default); color: var(--color-text-default); font-family: var(--font-family-sans)\`.
- **Mounting:** \`<x-import component-from-global-scope="${NAMESPACE}.Button" variant="primary" icon-start="Check">Publish tokens</x-import>\`. Read a component's card under \`api/components/\` before mounting it.
- **Icons:** every icon prop (\`icon\`, \`icon-start\`, \`icon-end\`) takes a Lucide name string ("Check", "GitPullRequest", "Trash2"). A lone icon: \`<x-import component-from-global-scope="${NAMESPACE}.Icon" icon="Lock"></x-import>\`. All ${iconCount} Lucide icons are in \`${NAMESPACE}.Icons\`.
- **Overlays** (Dialog, Drawer, AlertDialog): mount the real one with \`open="{{yes}}"\`; it portals to the artboard page.
- **Fonts:** Google Fonts, loaded by \`bundle.css\`: ${families}.
- **Source of truth:** this system is generated from the Bridge repository and republished on release. Edit the code, not this page.

## Index

${index}
`;
}

/** components/Cover/preview.html: palette blocks and bridge arcs, the name in Fraunces. */
export function renderCover() {
  return `<!-- @dsCard height=288 -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bridge Library</title>
<style>
  html, body { margin: 0; height: 100%; }
  body { background: var(--color-bg-default); color: var(--color-text-default); font-family: var(--font-family-sans); overflow: hidden; }
  .cover { position: relative; height: 288px; overflow: hidden; }
  .art { position: absolute; top: 0; left: 480px; width: 480px; height: 288px; overflow: hidden; }
  .art svg { display: block; width: 480px; height: 288px; }
  .harbor { fill: var(--color-surface-strong); }
  .zone { fill: var(--color-bg-zone); }
  .ink { fill: var(--color-surface-inverse); }
  .paper { fill: var(--color-bg-subtle); }
  .arc { fill: none; stroke: var(--color-text-on-solid); stroke-width: 2; }
  .arc.on-zone { stroke: var(--color-surface-strong); }
  .words { position: absolute; left: var(--space-8); bottom: var(--space-8); max-width: 440px; }
  .name { margin: 0; font-family: var(--font-family-display); font-size: 88px; line-height: .95; font-weight: 500; letter-spacing: -0.02em; }
  .tag { margin: var(--space-2) 0 0 2px; font-size: 14px; line-height: 20px; color: var(--color-text-muted); }
</style>
</head>
<body>
<div class="cover">
<div class="art" aria-hidden="true">
<svg viewBox="0 0 480 288" width="480" height="288">
<!--
  blocks      surface-strong (Deep Harbor) 224x288 bleeding top and bottom, the one strong color · bg-zone 192x160 · surface-inverse 96x96 · bg-subtle 192x96
  arrangement one tall Deep Harbor slab with satellites, space-4 gutters, corners radius-container (20)
  pattern     bridge arcs: the name's own motif, three spans drawn as half-rounds over the slab and the zone
  scales      sides in space-4 multiples, gutters space-4, corners radius-container, stroke border-width-2
-->
<rect class="harbor" x="16" y="-20" width="224" height="328" rx="20"/>
<rect class="zone" x="256" y="16" width="208" height="160" rx="20"/>
<rect class="ink" x="256" y="192" width="96" height="96" rx="20"/>
<rect class="paper" x="368" y="192" width="112" height="80" rx="20"/>
<path class="arc" d="M32 232 A48 48 0 0 1 128 232"/>
<path class="arc" d="M128 232 A48 48 0 0 1 224 232"/>
<line class="arc" x1="32" y1="232" x2="224" y2="232"/>
<path class="arc on-zone" d="M272 144 A88 88 0 0 1 448 144"/>
<line class="arc on-zone" x1="272" y1="144" x2="448" y2="144"/>
</svg>
</div>
<div class="words">
<h1 class="name">Bridge Library</h1>
<p class="tag">Explore with AI, keep what works in the design system.</p>
</div>
</div>
</body>
</html>
`;
}
