// @bridge-ds/eslint-plugin: design system rules for product code.
//   bridge/no-hardcoded-style-values  raw colors, lengths, radii, shadows, durations, z-index, fonts in style, sx,
//                                     styled() and theme objects; suggests the token, fixes exact matches.
//   bridge/prefer-ds-components       native elements and foreign UI libraries where a DS component exists.
// Tokens and components come from the design system repo (bridge.config.json) through @bridge-ds/core.
import { classifyModule, dsEquivalent, isNonVisual, isSafeFix, libraryLabel, nativeEquivalent, scanJsStyle, type Confidence, type DesignSystemIndex, type JsStyleContext } from '@bridge-ds/core/audit';
import { findDesignSystemRoot, loadDesignSystem } from '@bridge-ds/core/node';

// Minimal ESTree and ESLint rule types: the plugin has no runtime dependency on ESLint.
export interface Node {
  type: string;
  parent?: Node;
  range?: [number, number];
  [key: string]: unknown;
}
interface Fixer {
  replaceText(node: Node, text: string): unknown;
}
export interface RuleContext {
  options: unknown[];
  settings?: { bridge?: { designSystem?: string } };
  cwd?: string;
  filename?: string;
  report(d: { node: Node; messageId: string; data?: Record<string, string>; fix?: (f: Fixer) => unknown }): void;
}
export interface RuleModule {
  meta: { type: 'suggestion' | 'problem'; docs: { description: string; url: string }; fixable?: 'code'; schema: unknown[]; messages: Record<string, string> };
  create(context: RuleContext): Record<string, (node: Node) => void>;
}

const DOCS = 'https://github.com/peterbono/ai-design-system-demo/tree/main/packages/eslint-plugin#';
const RANK: Record<Confidence, number> = { exact: 3, high: 2, medium: 1, low: 0 };

/** The design system for this lint run: option, then settings.bridge.designSystem, then BRIDGE_DS, then the nearest bridge.config.json. */
function designSystem(context: RuleContext, option?: string): DesignSystemIndex | undefined {
  const root = option ?? context.settings?.bridge?.designSystem ?? process.env.BRIDGE_DS ?? findDesignSystemRoot(context.cwd ?? process.cwd());
  if (!root) return undefined;
  try {
    return loadDesignSystem(root).index;
  } catch {
    return undefined;
  }
}

const name = (n: unknown): string | undefined => {
  const node = n as Node | undefined;
  if (!node) return undefined;
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name as string;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'JSXMemberExpression') return `${name(node.object)}.${name(node.property)}`;
  if (node.type === 'MemberExpression') return `${name(node.object)}.${name(node.property)}`;
  return undefined;
};
const calleeName = (n: Node): string | undefined => (n.type === 'CallExpression' ? `${calleeName(n.callee as Node) ?? ''}(` : name(n));

/** Style context of an object property: inside style/sx attributes, styled()/makeStyles/createTheme calls, or style-named variables. */
function styleContext(node: Node): JsStyleContext | null {
  for (let p = node.parent, child: Node = node; p; child = p, p = p.parent) {
    if (p.type === 'JSXAttribute') {
      const n = name(p.name) ?? '';
      if (n === 'style' || n === 'css' || /Style$/.test(n)) return 'style';
      if (n === 'sx' || /Sx$/.test(n)) return 'sx';
      return null;
    }
    if (p.type === 'Property' && child === p.value) {
      const k = name(p.key);
      if (k === 'sx' || (k && /Sx$/.test(k))) return 'sx';
      if (k === 'style') return 'style';
      if (k === 'styleOverrides') return 'styled';
    }
    if (p.type === 'CallExpression' && child !== p.callee) {
      const c = calleeName(p.callee as Node) ?? '';
      if (/^styled(\.|\(|$)/.test(c) || /^(makeStyles|withStyles|createStyles|css|keyframes)$/.test(c)) return 'styled';
      if (/^(createTheme|extendTheme|createMuiTheme)$/.test(c)) return 'theme';
    }
    if (p.type === 'VariableDeclarator') {
      const n = name(p.id) ?? '';
      if (/theme$/i.test(n)) return 'theme';
      if (/^(styles?|sx|classes)$|Styles?$|Sx$/.test(n)) return /sx$/i.test(n) ? 'sx' : 'styled';
      return null;
    }
    if (p.type === 'Program') return null;
  }
  return null;
}

interface HardcodedOptions {
  designSystem?: string;
  /** Report values with no token closer than this too ("none" reports every hardcoded value). Default "none". */
  minConfidence?: Confidence | 'none';
  categories?: string[];
}

export const noHardcodedStyleValues: RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow raw design values in style, sx, styled() and theme objects where a design token exists.', url: `${DOCS}no-hardcoded-style-values` },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { designSystem: { type: 'string' }, minConfidence: { enum: ['exact', 'high', 'medium', 'low', 'none'] }, categories: { type: 'array', items: { type: 'string' } } },
      },
    ],
    messages: {
      exact: 'Use var({{token}}) instead of {{value}}: it is the same {{category}} ({{tokenValue}}).',
      near: 'Raw {{category}} {{value}}: use a token, closest is var({{token}}) ({{tokenValue}}, {{level}} match).',
      none: 'Raw {{category}} {{value}}: use a design token (none is close; ask for one instead of hardcoding).',
    },
  },
  create(context) {
    const opts = (context.options[0] ?? {}) as HardcodedOptions;
    const ds = designSystem(context, opts.designSystem);
    const min = opts.minConfidence ?? 'none';
    const check = (node: Node, key: string, value: string | number, ctx: JsStyleContext) => {
      const scan = scanJsStyle(key, value, ctx);
      for (const hit of scan.hits) {
        if (opts.categories && !opts.categories.includes(hit.category)) continue;
        const s = ds?.suggest(hit.category, hit.text, key);
        if (min !== 'none' && (!s || RANK[s.level] < RANK[min])) continue;
        const css = typeof value === 'number' && /^(spacing|size|radius|border-width|font-size)$/.test(hit.category) ? `${value}px` : hit.text;
        const whole = scan.hits.length === 1 && String(value).trim() === hit.text;
        const fixable = s && whole && isSafeFix({ category: hit.category, text: css }, s);
        context.report({
          node,
          messageId: s ? (s.level === 'exact' ? 'exact' : 'near') : 'none',
          data: { value: hit.text, category: hit.category, token: s?.cssVar ?? '', tokenValue: s?.value ?? '', level: s?.level ?? '' },
          ...(fixable ? { fix: (f: Fixer) => f.replaceText(node, `'var(${s!.cssVar})'`) } : {}),
        });
      }
    };
    return {
      Property(node) {
        const ctx = styleContext(node);
        if (!ctx) return;
        const key = name(node.key);
        const v = node.value as Node;
        if (!key || !v) return;
        if (v.type === 'Literal' && (typeof v.value === 'string' || typeof v.value === 'number')) check(v, key, v.value, ctx);
        else if (v.type === 'UnaryExpression' && v.operator === '-' && (v.argument as Node).type === 'Literal' && typeof (v.argument as Node).value === 'number') check(v, key, -((v.argument as Node).value as number), ctx);
        else if (v.type === 'TemplateLiteral' && !(v.expressions as unknown[]).length) check(v, key, ((v.quasis as Node[])[0]!.value as { cooked: string }).cooked, ctx);
      },
    };
  },
};

interface PreferOptions {
  designSystem?: string;
  /** Packages DS components come from (default: from bridge.config.json). */
  packages?: string[];
  nativeElements?: string[];
  /** Extra import prefixes counted as foreign UI libraries. */
  foreignLibraries?: string[];
  /** Component names or import sources to allow. */
  allow?: string[];
}

export const preferDsComponents: RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer design system components over native elements and foreign UI libraries.', url: `${DOCS}prefer-ds-components` },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          designSystem: { type: 'string' },
          packages: { type: 'array', items: { type: 'string' } },
          nativeElements: { type: 'array', items: { type: 'string' } },
          foreignLibraries: { type: 'array', items: { type: 'string' } },
          allow: { type: 'array', items: { type: 'string' } },
        },
      },
    ],
    messages: {
      foreign: '{{name}} from {{library}}: use the design system {{suggestion}} instead.',
      foreignNoMatch: '{{name}} from {{library}} is not a design system component. Use DS components ({{packages}}) or ask for one.',
      native: 'Native <{{name}}>: use the design system {{suggestion}} (accessible states, tokens, focus ring).',
    },
  },
  create(context) {
    const opts = (context.options[0] ?? {}) as PreferOptions;
    const ds = designSystem(context, opts.designSystem);
    const comps = ds?.components ?? new Set<string>();
    const packages = opts.packages ?? ds?.packages ?? ['@bridge-ds/react'];
    const natives = opts.nativeElements ?? ds?.nativeElements ?? ['button', 'input', 'select', 'textarea', 'dialog', 'table'];
    const foreign = [...(ds?.foreignLibraries ?? []), ...(opts.foreignLibraries ?? [])];
    const allow = new Set(opts.allow ?? []);
    return {
      ImportDeclaration(node) {
        const mod = (node.source as Node).value as string;
        if (allow.has(mod)) return;
        const kind = classifyModule(mod, packages, foreign);
        if (kind !== 'foreign' && kind !== 'shadcn') return;
        const library = libraryLabel(mod, kind);
        for (const spec of node.specifiers as Node[]) {
          const imported = spec.type === 'ImportSpecifier' ? name(spec.imported) : name(spec.local);
          if (!imported || !/^[A-Z]/.test(imported) || isNonVisual(imported) || allow.has(imported)) continue;
          const suggestion = dsEquivalent(imported, comps);
          context.report({ node: spec, messageId: suggestion ? 'foreign' : 'foreignNoMatch', data: { name: imported, library, suggestion: suggestion ?? '', packages: packages.join(', ') } });
        }
      },
      JSXOpeningElement(node) {
        const tag = name(node.name);
        if (!tag || !natives.includes(tag) || allow.has(tag)) return;
        const typeAttr = (node.attributes as Node[]).find((a) => a.type === 'JSXAttribute' && name(a.name) === 'type');
        const type = typeAttr && (typeAttr.value as Node | undefined)?.type === 'Literal' ? String((typeAttr.value as Node).value) : undefined;
        if (tag === 'input' && type === 'hidden') return;
        const suggestion = nativeEquivalent(tag, type, comps);
        context.report({ node, messageId: 'native', data: { name: tag, suggestion: suggestion ?? 'component' } });
      },
    };
  },
};

export const rules = {
  'no-hardcoded-style-values': noHardcodedStyleValues,
  'prefer-ds-components': preferDsComponents,
};

const plugin = {
  meta: { name: '@bridge-ds/eslint-plugin', version: '0.1.0' },
  rules,
  configs: {} as Record<string, unknown>,
};

/** Flat config: `import bridge from '@bridge-ds/eslint-plugin'; export default [bridge.configs.recommended];` */
plugin.configs.recommended = {
  plugins: { bridge: plugin },
  rules: { 'bridge/no-hardcoded-style-values': 'warn', 'bridge/prefer-ds-components': 'warn' },
};

export default plugin;
