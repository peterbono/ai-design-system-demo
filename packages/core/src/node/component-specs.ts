// Component spec generator: reads a component's TSX (props, defaults, rendered tree) and its CSS modules, and derives a
// ComponentSpec (see ../component-spec.ts) a design tool can rebuild: variant axes from string-literal union props,
// a State axis from the interaction states the CSS styles, TEXT and BOOLEAN properties, parts (frames, text, icons),
// and per variant the token path behind every fill, stroke, radius, padding, gap, size and text property.
//
// Derived from code, never hand-maintained: `npm run specs` writes packages/react/component-specs.json, and a test
// fails when the committed file is out of date. Uses the TypeScript parser (Node only, like the audit).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import ts from 'typescript';
import {
  COLOR_FIELDS,
  COMPONENT_SPECS_VERSION,
  type ComponentSpec,
  type ComponentSpecsFile,
  type SpecAxis,
  type SpecField,
  type SpecLayout,
  type SpecPart,
  type SpecIcon,
  type SpecIconStyle,
  type SpecProperty,
  type SpecSlot,
  type SpecUnmapped,
  type SpecValue,
  type SpecVariant,
  hashSpec,
  iconComponentName,
  tokenCssVar,
  variantKeyOf,
} from '../component-spec';
import { CONFIG_FILE, loadConfig } from '../config';
import { buildTokenSet, layoutOptions } from '../token-set';
import { type CssElement, type CssRule, type CssState, DEFAULT_STATE, computeValues, declaredFor, parseCssModule } from './spec-css';

export interface TokenInfo {
  path: string;
  type: string;
}

export interface SpecGeneratorOptions {
  /** Repo-relative components directory ("packages/react/src/components"). */
  componentsDir: string;
  /** Reads a repo-relative file; undefined when it does not exist. */
  read: (path: string) => string | undefined;
  /** CSS custom property -> token. */
  tokens: Map<string, TokenInfo>;
  styleSuffix?: string | undefined;
  /** Repo-relative ESM build of lucide-react ("node_modules/lucide-react/dist/esm"), for the icons section. */
  lucideDir?: string | undefined;
}

/** States drawn as the State axis when the CSS styles them, with the selector state they stand for. */
const STATES: { name: string; state: CssState }[] = [
  { name: 'Default', state: DEFAULT_STATE },
  { name: 'Hover', state: { hover: true, active: false, disabled: false } },
  { name: 'Pressed', state: { hover: true, active: true, disabled: false } },
  { name: 'Disabled', state: { hover: false, active: false, disabled: true } },
];

/** Most variants a set may get; a component past it is reported instead of generated. */
const MAX_VARIANTS = 240;

/** CSS properties that matter visually but have no mapping in this version. Others (cursor, transition...) are silent. */
const REPORTED: Record<string, string> = {
  'box-shadow': 'shadows are code-only tokens (no Figma variable)',
  outline: 'focus rings are not drawn',
  transform: 'transforms are not drawn',
  opacity: 'opacity is not mapped yet',
  filter: 'filters are not drawn',
  'margin-left': 'margins have no auto layout equivalent',
  'margin-right': 'margins have no auto layout equivalent',
  margin: 'margins have no auto layout equivalent',
  'margin-inline-start': 'margins have no auto layout equivalent',
};

// ---------------------------------------------------------------------------------------------
// TSX reading

type PropKind = 'union' | 'boolean' | 'icon' | 'node' | 'string' | 'function' | 'other';

interface PropInfo {
  name: string;
  kind: PropKind;
  values?: string[] | undefined;
  optional: boolean;
}

interface ComponentSource {
  name: string;
  file: string;
  sf: ts.SourceFile;
  /** Import identifier -> repo-relative CSS module path. */
  styles: Map<string, string>;
  props: Map<string, PropInfo>;
  /** Native element the props extend (button, input, span...), from `extends ButtonHTMLAttributes<...>`. */
  native: string | undefined;
  fn: ts.FunctionLikeDeclaration | undefined;
  /** Other exported forwardRef components in the file (CardHeader, CardBody...). */
  subcomponents: { name: string; fn: ts.FunctionLikeDeclaration }[];
}

const NATIVE_ATTRS: Record<string, string> = {
  ButtonHTMLAttributes: 'button',
  InputHTMLAttributes: 'input',
  TextareaHTMLAttributes: 'textarea',
  AnchorHTMLAttributes: 'a',
  HTMLAttributes: 'element',
};

function unquote(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '');
}

class Reader {
  private cache = new Map<string, ComponentSource | null>();
  private aliasCache = new Map<string, Map<string, string>>();
  constructor(private opts: SpecGeneratorOptions) {}

  private dirOf(name: string) {
    return `${this.opts.componentsDir}/${name}`;
  }

  exists(name: string): boolean {
    return this.opts.read(`${this.dirOf(name)}/${name}.tsx`) !== undefined;
  }

  /** `export type X = ...` of a component file and of the component files it imports from. */
  private aliases(file: string, sf: ts.SourceFile, depth = 0): Map<string, string> {
    if (this.aliasCache.has(file)) return this.aliasCache.get(file)!;
    const out = new Map<string, string>();
    this.aliasCache.set(file, out);
    for (const st of sf.statements) {
      if (ts.isTypeAliasDeclaration(st)) out.set(st.name.text, st.type.getText(sf));
      if (ts.isImportDeclaration(st) && depth < 2) {
        const spec = unquote(st.moduleSpecifier.getText(sf));
        const m = /^\.\.\/(\w+)$/.exec(spec);
        if (!m) continue;
        const other = `${this.dirOf(m[1]!)}/${m[1]}.tsx`;
        const text = this.opts.read(other);
        if (!text) continue;
        const osf = ts.createSourceFile(other, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        for (const [k, v] of this.aliases(other, osf, depth + 1)) if (!out.has(k)) out.set(k, v);
      }
    }
    return out;
  }

  load(name: string): ComponentSource | null {
    if (this.cache.has(name)) return this.cache.get(name)!;
    const file = `${this.dirOf(name)}/${name}.tsx`;
    const text = this.opts.read(file);
    if (text === undefined) {
      this.cache.set(name, null);
      return null;
    }
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const styles = new Map<string, string>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause?.name) continue;
      const spec = unquote(st.moduleSpecifier.getText(sf));
      if (!spec.endsWith(this.opts.styleSuffix ?? '.module.css')) continue;
      styles.set(st.importClause.name.text, posix.normalize(posix.join(this.dirOf(name), spec)));
    }
    const aliases = this.aliases(file, sf);
    const props = new Map<string, PropInfo>();
    let native: string | undefined;
    const iface = sf.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === `${name}Props`);
    if (iface) {
      for (const h of iface.heritageClauses ?? []) {
        const txt = h.getText(sf);
        for (const [k, v] of Object.entries(NATIVE_ATTRS)) if (txt.includes(k)) native ??= v;
      }
      for (const m of iface.members) {
        if (!ts.isPropertySignature(m) || !m.type) continue;
        const pname = m.name.getText(sf);
        props.set(pname, { name: pname, optional: !!m.questionToken, ...classifyType(m.type.getText(sf), aliases) });
      }
    }
    const fns = componentFunctions(sf);
    const fn = fns.get(name);
    const subcomponents = [...fns].filter(([n]) => n !== name && n.startsWith(name)).map(([n, f]) => ({ name: n, fn: f }));
    const src: ComponentSource = { name, file, sf, styles, props, native, fn, subcomponents };
    this.cache.set(name, src);
    return src;
  }
}

function classifyType(text: string, aliases: Map<string, string>, depth = 0): { kind: PropKind; values?: string[] } {
  const t = text.trim();
  if (aliases.has(t) && depth < 4) return classifyType(aliases.get(t)!, aliases, depth + 1);
  const parts = t.split('|').map((p) => p.trim());
  if (parts.length > 1 && parts.every((p) => /^'[^']*'$/.test(p))) return { kind: 'union', values: parts.map(unquote) };
  if (t === 'boolean') return { kind: 'boolean' };
  if (t === 'LucideIcon') return { kind: 'icon' };
  if (/^(ReactNode|ReactElement|React\.ReactNode)$/.test(t)) return { kind: 'node' };
  if (t === 'string') return { kind: 'string' };
  if (t.includes('=>')) return { kind: 'function' };
  return { kind: 'other' };
}

/** Exported components of a file: `forwardRef(function Name(...))` or `function Name(...)`. */
function componentFunctions(sf: ts.SourceFile): Map<string, ts.FunctionLikeDeclaration> {
  const out = new Map<string, ts.FunctionLikeDeclaration>();
  const visit = (n: ts.Node) => {
    if (ts.isFunctionExpression(n) && n.name && /^[A-Z]/.test(n.name.text) && ts.isCallExpression(n.parent) && /forwardRef/.test(n.parent.expression.getText(sf))) {
      if (!out.has(n.name.text)) out.set(n.name.text, n);
    } else if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (!out.has(n.name.text)) out.set(n.name.text, n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Evaluating a component for a set of props

const CHILDREN = Symbol('children');
const OPAQUE = Symbol('opaque');

interface ClassRef {
  cls: string;
}
interface StylesRef {
  module: string;
}
interface JsxRef {
  jsx: ts.Node;
  scope: Scope;
}

type Value = undefined | null | boolean | number | string | symbol | ClassRef | StylesRef | JsxRef | Value[] | { [k: string]: Value };

const isClass = (v: Value): v is ClassRef => !!v && typeof v === 'object' && 'cls' in (v as object);
const isStyles = (v: Value): v is StylesRef => !!v && typeof v === 'object' && 'module' in (v as object);
const isJsx = (v: Value): v is JsxRef => !!v && typeof v === 'object' && 'jsx' in (v as object);

interface Scope {
  src: ComponentSource;
  vars: Map<string, Value>;
  /** Local consts, evaluated on first use. */
  locals: Map<string, ts.Expression>;
  /** Identifiers bound to optional icon props (or a boolean shown as a part): JSX conditions on them become BOOLEAN properties. */
  toggles: Map<string, string>;
  /** Component being specified (true) or a nested DS component (false). */
  main: boolean;
}

function lookup(scope: Scope, name: string): Value {
  if (scope.vars.has(name)) return scope.vars.get(name);
  const local = scope.locals.get(name);
  if (local) {
    scope.locals.delete(name);
    const v = evaluate(local, scope);
    scope.vars.set(name, v);
    return v;
  }
  const style = scope.src.styles.get(name);
  if (style) return { module: style };
  if (name === 'undefined') return undefined;
  return undefined;
}

function classList(v: Value, out: string[] = []): string[] {
  if (isClass(v)) out.push(v.cls);
  else if (Array.isArray(v)) for (const x of v) classList(x, out);
  return out;
}

function evaluate(e: ts.Expression, scope: Scope): Value {
  const sf = scope.src.sf;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) return evaluate(e.expression, scope);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (e.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(e)) return lookup(scope, e.text);
  if (ts.isTemplateExpression(e)) {
    let s = e.head.text;
    for (const span of e.templateSpans) s += String(evaluate(span.expression, scope) ?? '') + span.literal.text;
    return s;
  }
  if (ts.isPropertyAccessExpression(e)) {
    const obj = evaluate(e.expression, scope);
    if (isStyles(obj)) return { cls: `${obj.module}|${e.name.text}` };
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && !isClass(obj) && !isJsx(obj)) return (obj as Record<string, Value>)[e.name.text];
    return undefined;
  }
  if (ts.isElementAccessExpression(e)) {
    const obj = evaluate(e.expression, scope);
    const key = evaluate(e.argumentExpression, scope);
    if (isStyles(obj) && typeof key === 'string') return { cls: `${obj.module}|${key}` };
    return undefined;
  }
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return !truthy(evaluate(e.operand, scope));
  if (ts.isConditionalExpression(e)) return truthy(evaluate(e.condition, scope)) ? evaluate(e.whenTrue, scope) : evaluate(e.whenFalse, scope);
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const l = evaluate(e.left, scope);
      return truthy(l) ? evaluate(e.right, scope) : l;
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      const l = evaluate(e.left, scope);
      return truthy(l) ? l : evaluate(e.right, scope);
    }
    if (op === ts.SyntaxKind.QuestionQuestionToken) {
      const l = evaluate(e.left, scope);
      return l === undefined || l === null ? evaluate(e.right, scope) : l;
    }
    const l = evaluate(e.left, scope);
    const r = evaluate(e.right, scope);
    switch (op) {
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
        return l === r;
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        return l !== r;
      case ts.SyntaxKind.EqualsEqualsToken:
        return l == r; // eslint-disable-line eqeqeq
      case ts.SyntaxKind.ExclamationEqualsToken:
        return l != r; // eslint-disable-line eqeqeq
      default:
        return OPAQUE;
    }
  }
  if (ts.isCallExpression(e)) {
    const callee = e.expression.getText(sf);
    if (callee === 'cx' || callee === 'clsx' || callee === 'classNames') return e.arguments.map((a) => evaluate(a, scope)).filter(truthy);
    return OPAQUE;
  }
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return { jsx: e, scope };
  return OPAQUE;
}

function truthy(v: Value): boolean {
  if (v === OPAQUE) return true;
  if (Array.isArray(v)) return true;
  return !!v;
}

/** Binds the destructured props of a component function, with their defaults. */
function bindProps(fn: ts.FunctionLikeDeclaration, scope: Scope, given: Record<string, Value>): Map<string, string> {
  const names = new Map<string, string>(); // local name -> prop name
  const param = fn.parameters[0];
  if (!param || !ts.isObjectBindingPattern(param.name)) return names;
  for (const el of param.name.elements) {
    if (el.dotDotDotToken || !ts.isIdentifier(el.name)) continue;
    const prop = el.propertyName ? el.propertyName.getText(scope.src.sf) : el.name.text;
    names.set(el.name.text, prop);
    let v = given[prop];
    if (v === undefined && el.initializer) v = evaluate(el.initializer, scope);
    scope.vars.set(el.name.text, v);
  }
  return names;
}

/** The JSX a component function returns for the current props: follows `if (cond) return x;` and local consts. */
function renderedJsx(fn: ts.FunctionLikeDeclaration, scope: Scope): JsxRef | undefined {
  const body = fn.body;
  if (!body) return undefined;
  if (!ts.isBlock(body)) {
    const v = evaluate(body, scope);
    return isJsx(v) ? v : undefined;
  }
  const run = (stmts: readonly ts.Statement[]): JsxRef | undefined | null => {
    for (const st of stmts) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) scope.locals.set(d.name.text, d.initializer);
      } else if (ts.isIfStatement(st)) {
        const branch = truthy(evaluate(st.expression, scope)) ? st.thenStatement : st.elseStatement;
        if (!branch) continue;
        const r = run(ts.isBlock(branch) ? branch.statements : [branch]);
        if (r !== null) return r;
      } else if (ts.isReturnStatement(st)) {
        if (!st.expression) return undefined;
        const v = evaluate(st.expression, scope);
        return isJsx(v) ? v : undefined;
      }
    }
    return null;
  };
  return run(body.statements) ?? undefined;
}

// ---------------------------------------------------------------------------------------------
// Element tree

interface Node {
  key: string;
  tag: string;
  classes: string[];
  children: Node[];
  kind: 'frame' | 'text' | 'icon';
  /** Text parts: TEXT property name and default; placeholder text of a text field. */
  text?: { property: string; default: string; prop?: string | undefined } | undefined;
  placeholder?: boolean | undefined;
  inputLike?: boolean | undefined;
  /** BOOLEAN property that shows this optional part. */
  visible?: { property: string; prop: string } | undefined;
  /** Spreads `...rest` with no children of its own: children come through props. */
  takesChildren?: boolean | undefined;
  /** Name for the layer, when it is not the class. */
  name?: string | undefined;
}

const INPUT_TAGS = new Set(['input', 'textarea', 'BaseInput']);

/** "iconStart" -> "Icon start". */
export const sentenceCase = (prop: string) => {
  const words = prop.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

interface RenderContext {
  reader: Reader;
  depth: number;
  /** Elements the main component rendered for `{children}`. */
  component: string;
}

function renderJsx(ref: JsxRef, ctx: RenderContext, visible?: Node['visible']): Node[] {
  const { jsx, scope } = ref;
  const sf = scope.src.sf;
  if (ts.isParenthesizedExpression(jsx)) return renderJsx({ jsx: jsx.expression, scope }, ctx, visible);
  if (ts.isJsxFragment(jsx)) return renderChildren(jsx.children, scope, ctx);
  if (!ts.isJsxElement(jsx) && !ts.isJsxSelfClosingElement(jsx)) return [];
  const open = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
  const tag = open.tagName.getText(sf);
  const attrs: Record<string, Value> = {};
  let spreads = false;
  for (const a of open.attributes.properties) {
    if (ts.isJsxSpreadAttribute(a)) {
      spreads = true;
      continue;
    }
    const name = a.name.getText(sf);
    if (!a.initializer) attrs[name] = true;
    else if (ts.isStringLiteral(a.initializer)) attrs[name] = a.initializer.text;
    else if (ts.isJsxExpression(a.initializer) && a.initializer.expression) attrs[name] = evaluate(a.initializer.expression, scope);
  }
  const children = ts.isJsxElement(jsx) ? jsx.children : undefined;

  // A design system component (Icon, Spinner...): rendered through its own TSX and CSS module.
  if (/^[A-Z]/.test(tag) && tag !== ctx.component && ctx.depth < 4 && ctx.reader.exists(tag)) {
    const nested = renderComponent(ctx.reader, tag, attrs, { ...ctx, depth: ctx.depth + 1 });
    if (nested) {
      if (tag === 'Icon') nested.kind = 'icon';
      if (visible) nested.visible = visible;
      return [nested];
    }
  }
  const node: Node = {
    key: '',
    tag,
    classes: classList(attrs.className),
    children: [],
    kind: INPUT_TAGS.has(tag) ? 'text' : 'frame',
    ...(visible ? { visible } : {}),
  };
  if (INPUT_TAGS.has(tag)) {
    node.inputLike = true;
    node.placeholder = true;
    node.text = { property: 'Placeholder', default: typeof attrs.placeholder === 'string' ? attrs.placeholder : 'Placeholder' };
    return [node];
  }
  if (children) node.children = renderChildren(children, scope, ctx);
  else if (spreads) node.takesChildren = true;
  return [node];
}

function renderChildren(children: ts.NodeArray<ts.JsxChild>, scope: Scope, ctx: RenderContext): Node[] {
  const out: Node[] = [];
  for (const c of children) {
    if (ts.isJsxText(c)) continue;
    if (ts.isJsxExpression(c)) {
      if (c.expression) out.push(...renderExpression(c.expression, scope, ctx));
      continue;
    }
    out.push(...renderJsx({ jsx: c, scope }, ctx));
  }
  return out;
}

function toggleOf(e: ts.Expression, scope: Scope): Node['visible'] {
  const inner = ts.isParenthesizedExpression(e) ? e.expression : e;
  if (!ts.isIdentifier(inner)) return undefined;
  const prop = scope.toggles.get(inner.text);
  return prop ? { property: sentenceCase(prop), prop } : undefined;
}

function renderExpression(e: ts.Expression, scope: Scope, ctx: RenderContext, visible?: Node['visible']): Node[] {
  if (ts.isParenthesizedExpression(e)) return renderExpression(e.expression, scope, ctx, visible);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const t = toggleOf(e.left, scope);
    if (t) return renderExpression(e.right, scope, ctx, visible ?? t);
    return truthy(evaluate(e.left, scope)) ? renderExpression(e.right, scope, ctx, visible) : [];
  }
  if (ts.isConditionalExpression(e)) {
    const t = toggleOf(e.condition, scope);
    if (t) return renderExpression(e.whenTrue, scope, ctx, visible ?? t);
    return renderExpression(truthy(evaluate(e.condition, scope)) ? e.whenTrue : e.whenFalse, scope, ctx, visible);
  }
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return renderJsx({ jsx: e, scope }, ctx, visible);
  const v = evaluate(e, scope);
  if (v === CHILDREN) return [{ key: '', tag: '#text', classes: [], children: [], kind: 'text', text: { property: 'Label', default: ctx.component, prop: 'children' } }];
  if (isJsx(v)) return renderJsx(v, ctx, visible);
  return [];
}

/** Renders a component for the given props into a node tree (its root node). */
function renderComponent(reader: Reader, name: string, props: Record<string, Value>, ctx: RenderContext, fnOverride?: ts.FunctionLikeDeclaration): Node | undefined {
  const src = reader.load(name);
  const fn = fnOverride ?? src?.fn;
  if (!src || !fn) return undefined;
  const scope: Scope = { src, vars: new Map(), locals: new Map(), toggles: new Map(), main: ctx.depth === 0 };
  const names = bindProps(fn, scope, props);
  if (scope.main) {
    // Optional icon props are BOOLEAN properties ("Icon start"): their JSX condition shows a part.
    for (const [local, prop] of names) if (src.props.get(prop)?.kind === 'icon' && src.props.get(prop)?.optional) scope.toggles.set(local, prop);
  }
  const jsx = renderedJsx(fn, scope);
  if (!jsx) return undefined;
  const nodes = renderJsx(jsx, ctx);
  return nodes.length === 1 ? nodes[0] : nodes.length ? { key: '', tag: 'div', classes: [], children: nodes, kind: 'frame' } : undefined;
}

/** A wrapper whose only child is the text becomes the text part itself (Button's `<span class="label">`). */
function collapseText(n: Node, root = true): Node {
  n.children = n.children.map((c) => collapseText(c, false));
  // Only inline wrappers (span): a block (Card header) keeps its frame for its padding.
  if (!root && n.tag === 'span' && !n.name && n.kind === 'frame' && n.children.length === 1 && n.children[0]!.kind === 'text' && !n.children[0]!.classes.length && !n.children[0]!.inputLike) {
    const t = n.children[0]!;
    return { ...t, tag: n.tag, classes: n.classes, ...(n.visible ? { visible: n.visible } : {}) };
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Spec

interface Built {
  root: Node;
  /** Part id -> node, in tree order. */
  parts: Map<string, Node>;
  parents: Map<string, string | undefined>;
}

/** Renders the main component for one set of axis values, with stable part ids. */
function build(reader: Reader, src: ComponentSource, props: Record<string, Value>): Built | undefined {
  const root = renderComponent(reader, src.name, { ...props, children: CHILDREN }, { reader, depth: 0, component: src.name });
  if (!root) return undefined;
  // Compound components (Card): children come through props, so draw the parts the file exports (CardHeader...).
  if (root.takesChildren && !root.children.length && src.subcomponents.length) {
    for (const sub of src.subcomponents) {
      const label = sub.name.slice(src.name.length);
      const n = renderComponent(reader, src.name, {}, { reader, depth: 1, component: src.name }, sub.fn);
      if (!n) continue;
      n.name = label;
      if (n.takesChildren && !n.children.length) n.children = [{ key: '', tag: '#text', classes: [], children: [], kind: 'text', text: { property: label, default: label } }];
      root.children.push(n);
    }
  }
  const tree = collapseText(root);
  const parts = new Map<string, Node>();
  const parents = new Map<string, string | undefined>();
  const used = new Set<string>();
  const slug = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const assign = (n: Node, parent: string | undefined) => {
    let base: string;
    if (!parent) base = 'root';
    else if (n.visible) base = slug(n.visible.prop);
    else if (n.text && n.kind === 'text' && !n.placeholder) base = n.text.prop === 'children' ? 'text' : `${slug(n.text.property)}-text`;
    else if (n.placeholder) base = 'placeholder';
    else if (n.name) base = slug(n.name);
    else base = slug(n.classes[0]?.split('|')[1] ?? n.tag) || 'part';
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    n.key = id;
    parts.set(id, n);
    parents.set(id, parent);
    for (const c of n.children) assign(c, id);
  };
  assign(tree, undefined);
  return { root: tree, parts, parents };
}

function toCssTree(b: Built): Map<string, CssElement> {
  const els = new Map<string, CssElement>();
  const make = (n: Node, parent: CssElement | undefined): CssElement => {
    const el: CssElement = { tag: n.tag, classes: new Set(n.classes), parent, children: [], present: !n.visible, isRoot: !parent, inputLike: !!n.inputLike };
    els.set(n.key, el);
    el.children = n.children.map((c) => make(c, el));
    return el;
  };
  make(b.root, undefined);
  return els;
}

interface Resolved {
  value?: SpecValue;
  unmapped?: string;
}

const isZero = (v: string) => /^0(px|rem|em|%)?$/.test(v);

/** A CSS value as a token path, a literal 0, or null (no paint). */
function resolveValue(raw: string | undefined, values: Map<string, string>, tokens: Map<string, TokenInfo>, depth = 0, parent?: Map<string, string>, forColor = false): Resolved | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  const low = v.toLowerCase();
  if (depth > 12) return { unmapped: 'custom properties form a cycle' };
  if (low === 'transparent' || low === 'none') return { value: null };
  if (isZero(v)) return { value: 0 };
  // currentcolor is the element's color; inside `color` itself it is the parent's (CSS Color 4).
  if (low === 'currentcolor') return forColor ? resolveValue(parent?.get('color'), parent ?? new Map(), tokens, depth + 1) : resolveValue(values.get('color'), values, tokens, depth + 1, parent, true);
  if (low === 'normal' || low === 'auto' || low === 'inherit' || low === 'initial' || low === 'unset' || low === 'medium') return undefined;
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(v);
  if (m) {
    const name = m[1]!;
    const token = tokens.get(name);
    if (token) return { value: token.path };
    if (values.has(name)) return resolveValue(values.get(name), values, tokens, depth + 1, parent, forColor);
    if (m[2] !== undefined) return resolveValue(m[2], values, tokens, depth + 1, parent, forColor);
    return { unmapped: `${name} is not a token` };
  }
  if (/^calc\(/i.test(v)) return calcValue(v, values, tokens, depth, parent);
  if (v === '100%') return { unmapped: 'fills its container: Figma draws it at a fixed width' };
  if (/%$/.test(v)) return { unmapped: 'relative size: the Figma part hugs its content' };
  return { unmapped: 'literal value, not a token' };
}

/**
 * A calc() of tokens ("calc(var(--space-2) + var(--space-0-5))") as an expression of token paths: "calc(space.2 + space.0-5)".
 * A calc() of a single token is that token (bound in Figma). Literals other than plain numbers and px are not mapped.
 */
function calcValue(v: string, values: Map<string, string>, tokens: Map<string, TokenInfo>, depth: number, parent?: Map<string, string>): Resolved {
  const inner = v.slice(v.indexOf('(') + 1, v.lastIndexOf(')'));
  let failed: string | undefined;
  const substituted = inner.replace(/var\(\s*--[\w-]+\s*(?:,[^()]*)?\)/g, (m) => {
    const r = resolveValue(m, values, tokens, depth + 1, parent);
    if (!r || r.unmapped !== undefined || r.value === null || r.value === undefined) {
      failed ??= r?.unmapped ?? `${m} has no value`;
      return '0';
    }
    if (r.value === 0) return '0';
    return r.value.startsWith('calc(') ? `(${r.value.slice(5, -1)})` : r.value;
  });
  if (failed) return { unmapped: `calc(): ${failed}` };
  const types = typesOf(tokens);
  const parts = substituted.match(/[()*/]|[^\s()*/]+/g) ?? [];
  for (const t of parts) {
    if (/^[()*/+-]$/.test(t) || /^-?\d+(\.\d+)?(px)?$/.test(t) || types.has(t)) continue;
    return { unmapped: `calc() with ${t}: only tokens, numbers and px are mapped` };
  }
  const paths = parts.filter((t) => types.has(t));
  if (!paths.length) return { unmapped: 'calc() of literals, not a token' };
  if (parts.length === 1) return { value: paths[0]! };
  return { value: `calc(${parts.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')')})` };
}

const FRAME_FIELDS: [string, SpecField][] = [
  ['background-color', 'fill'],
  ['border-radius', 'cornerRadius'],
  ['padding-top', 'paddingTop'],
  ['padding-right', 'paddingRight'],
  ['padding-bottom', 'paddingBottom'],
  ['padding-left', 'paddingLeft'],
  ['gap', 'itemSpacing'],
  ['width', 'width'],
  ['height', 'height'],
  ['min-width', 'minWidth'],
  ['min-height', 'minHeight'],
];

const TEXT_FIELDS: [string, SpecField][] = [
  ['color', 'textFill'],
  ['font-family', 'fontFamily'],
  ['font-size', 'fontSize'],
  ['font-weight', 'fontWeight'],
  ['line-height', 'lineHeight'],
  ['letter-spacing', 'letterSpacing'],
];

const SIDE_FIELDS: Record<string, SpecField> = { top: 'strokeTopWeight', right: 'strokeRightWeight', bottom: 'strokeBottomWeight', left: 'strokeLeftWeight' };

const typeCache = new WeakMap<Map<string, TokenInfo>, Map<string, TokenInfo>>();
/** Token path -> token, for type checks. */
function typesOf(tokens: Map<string, TokenInfo>): Map<string, TokenInfo> {
  let m = typeCache.get(tokens);
  if (!m) {
    m = new Map([...tokens.values()].map((t) => [t.path, t]));
    typeCache.set(tokens, m);
  }
  return m;
}

function expectedTypes(field: SpecField): string[] {
  if (COLOR_FIELDS.has(field)) return ['color'];
  if (field === 'fontFamily') return ['fontFamily'];
  if (field === 'fontWeight') return ['fontWeight', 'number'];
  return ['dimension', 'number'];
}

interface PartValues {
  values: Partial<Record<SpecField, SpecValue>>;
  unmapped: { property: string; value: string; reason: string }[];
}

function partValues(node: Node, computed: Map<string, string>, own: Map<string, string>, tokens: Map<string, TokenInfo>, parent: Map<string, string> | undefined): PartValues {
  const out: PartValues = { values: {}, unmapped: [] };
  const set = (field: SpecField, prop: string, raw: string | undefined, skipZero = false) => {
    const r = resolveValue(raw, computed, tokens, 0, parent, prop === 'color');
    if (!r) return;
    if (r.unmapped) {
      out.unmapped.push({ property: prop, value: raw!, reason: r.unmapped });
      return;
    }
    if (r.value === 0 && skipZero) return;
    if (r.value === null && !COLOR_FIELDS.has(field)) return;
    if (typeof r.value === 'string') {
      const t = typesOf(tokens).get(r.value);
      if (t && !expectedTypes(field).includes(t.type)) {
        out.unmapped.push({ property: prop, value: raw!, reason: `${r.value} is a ${t.type} token, ${field} needs ${expectedTypes(field).join(' or ')}` });
        return;
      }
    }
    out.values[field] = r.value as SpecValue;
  };
  if (node.kind === 'text') {
    for (const [prop, field] of TEXT_FIELDS) set(field, prop, computed.get(prop));
    return out;
  }
  if (node.kind === 'icon') {
    set('width', 'width', computed.get('width'));
    set('height', 'height', computed.get('height'));
    set('stroke', 'color', computed.get('color'));
    set('strokeWeight', 'stroke-width', computed.get('stroke-width'));
    return out;
  }
  for (const [prop, field] of FRAME_FIELDS) set(field, prop, computed.get(prop), field === 'minWidth' || field === 'minHeight');
  // Borders: one stroke for four equal sides, or per-side weights (a top rule).
  const widths = (['top', 'right', 'bottom', 'left'] as const).map((s) => computed.get(`border-${s}-width`));
  const colors = (['top', 'right', 'bottom', 'left'] as const).map((s) => computed.get(`border-${s}-color`));
  const present = widths.map((w) => w !== undefined && !isZero(w));
  if (present.every(Boolean) && new Set(widths).size === 1 && new Set(colors).size === 1) {
    set('strokeWeight', 'border-width', widths[0]);
    set('stroke', 'border-color', colors[0]);
  } else if (present.some(Boolean)) {
    const colorAt = present.indexOf(true);
    set('stroke', 'border-color', colors[colorAt]);
    (['top', 'right', 'bottom', 'left'] as const).forEach((s, i) => (present[i] ? set(SIDE_FIELDS[s]!, `border-${s}-width`, widths[i]) : (out.values[SIDE_FIELDS[s]!] = 0)));
  }
  for (const [prop, reason] of Object.entries(REPORTED)) {
    const v = own.get(prop);
    if (v !== undefined && /var\(/.test(v)) out.unmapped.push({ property: prop, value: v, reason });
  }
  return out;
}

function layoutOf(computed: Map<string, string>): SpecLayout {
  const dir = computed.get('flex-direction') ?? 'row';
  const display = computed.get('display') ?? 'block';
  const flex = /flex/.test(display);
  const justify = computed.get('justify-content') ?? 'normal';
  const align = computed.get('align-items') ?? 'normal';
  const primary = /center/.test(justify) ? 'CENTER' : /space-between/.test(justify) ? 'SPACE_BETWEEN' : /end/.test(justify) ? 'MAX' : 'MIN';
  const counter = /center/.test(align) ? 'CENTER' : /end/.test(align) ? 'MAX' : /stretch|normal/.test(align) && flex ? 'STRETCH' : 'MIN';
  return { direction: flex && !/column/.test(dir) ? 'HORIZONTAL' : 'VERTICAL', primary, counter: flex ? counter : 'STRETCH' };
}

/** `overflow: hidden | clip`: the frame clips its content (a card's footer fill inside its rounded corners). */
const clips = (c: Map<string, string> | undefined) => /^(hidden|clip)\b/.test(c?.get('overflow') ?? c?.get('overflow-x') ?? '');

/** A block-level root (display block, flex, grid) or `width: 100%`: in code it fills its container's width. */
function fillsContainer(c: Map<string, string> | undefined): boolean {
  if (!c) return false;
  if (c.get('width') === '100%') return true;
  const display = c.get('display') ?? 'block';
  return /^(block|flex|grid|flow-root)$/.test(display);
}

interface Evaluated {
  built: Built;
  values: SpecVariant['values'];
  unmapped: SpecUnmapped[];
  layouts: Map<string, SpecLayout>;
  /** Fingerprint of the classes rendered, to tell whether a prop changes anything. */
  classes: string;
  /** Part id -> computed CSS values. */
  computed: Map<string, Map<string, string>>;
}

function evaluateVariant(reader: Reader, src: ComponentSource, rules: CssRule[], props: Record<string, Value>, state: CssState, tokens: Map<string, TokenInfo>): Evaluated | undefined {
  const built = build(reader, src, props);
  if (!built) return undefined;
  const els = toCssTree(built);
  const computedById = new Map<string, Map<string, string>>();
  const values: SpecVariant['values'] = {};
  const unmapped: SpecUnmapped[] = [];
  const layouts = new Map<string, SpecLayout>();
  for (const [id, node] of built.parts) {
    const el = els.get(id)!;
    const parentId = built.parents.get(id);
    const own = declaredFor(rules, el, state);
    let computed = computeValues(own, parentId ? computedById.get(parentId) : undefined);
    const ownValues = new Map([...own].map(([k, d]) => [k, d.value]));
    if (node.placeholder) {
      // The placeholder text: the field's own values, then its ::placeholder rules.
      const ph = declaredFor(rules, el, state, 'placeholder');
      computed = computeValues(ph, computed);
    }
    computedById.set(id, computed);
    const pv = partValues(node, computed, ownValues, tokens, parentId ? computedById.get(parentId) : undefined);
    values[id] = pv.values;
    for (const u of pv.unmapped) unmapped.push({ part: id, ...u });
    if (node.kind === 'frame') layouts.set(id, layoutOf(computed));
  }
  const classes = [...built.parts].map(([id, n]) => `${id}:${n.classes.join(',')}:${n.visible?.prop ?? ''}`).join(';');
  return { built, values, unmapped, layouts, classes, computed: computedById };
}

function product(axes: { name: string; values: string[] }[]): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];
  for (const a of axes) out = out.flatMap((p) => a.values.map((v) => ({ ...p, [a.name]: v })));
  return out;
}

const sameValues = (a: SpecVariant['values'], b: SpecVariant['values']) => JSON.stringify(a) === JSON.stringify(b);

const BOX_FIELDS: SpecField[] = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing'];
const PAINT_FIELDS: SpecField[] = ['fill', 'stroke', 'strokeWeight', 'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'cornerRadius', 'width', 'height', 'minWidth', 'minHeight'];
const empty = (v: SpecValue | undefined) => v === undefined || v === 0 || v === null;

/**
 * A root whose only child is a plain frame that only adds padding and gap (Tag's `<span class="label">`): the wrapper
 * is merged into the root, so Figma gets one auto layout frame with the icon and the text, like Badge. Only when the CSS
 * allows it: the root has no padding or gap of its own, and the wrapper has no paint, border, radius or size, in every
 * variant.
 */
function flattenWrapper(parts: SpecPart[], variants: SpecVariant[], unmapped: SpecUnmapped[]): void {
  const root = parts.find((p) => !p.parent);
  const children = parts.filter((p) => p.parent === root?.id);
  const w = children[0];
  if (!root || root.kind !== 'frame' || children.length !== 1 || !w || w.kind !== 'frame' || w.visible || w.clip) return;
  for (const v of variants) {
    const r = v.values[root.id] ?? {};
    const x = v.values[w.id] ?? {};
    if (BOX_FIELDS.some((f) => !empty(r[f])) || PAINT_FIELDS.some((f) => !empty(x[f]))) return;
  }
  for (const v of variants) {
    const r = (v.values[root.id] ??= {});
    const x = v.values[w.id] ?? {};
    for (const f of BOX_FIELDS) if (x[f] !== undefined) r[f] = x[f];
    delete v.values[w.id];
  }
  if (w.layout) root.layout = w.layout;
  if (w.source) root.source = root.source ? `${root.source}, ${w.source}` : w.source;
  for (const p of parts) if (p.parent === w.id) p.parent = root.id;
  for (const u of unmapped) if (u.part === w.id) u.part = root.id;
  parts.splice(parts.indexOf(w), 1);
}

/** The spec of one component, or an error message when it cannot be derived. */
export function generateComponentSpec(name: string, opts: SpecGeneratorOptions): ComponentSpec {
  const reader = new Reader(opts);
  const src = reader.load(name);
  if (!src) throw new Error(`${name}: ${opts.componentsDir}/${name}/${name}.tsx was not found.`);
  if (!src.fn) throw new Error(`${name}: no forwardRef(function ${name}(...)) or exported function ${name} in ${src.file}.`);

  // Every CSS module the rendered tree may use: the component's own, the ones it imports, and those of nested components.
  const modules = new Map<string, string>();
  const addModules = (s: ComponentSource | null) => {
    if (!s) return;
    for (const path of s.styles.values()) {
      if (modules.has(path)) continue;
      const text = opts.read(path);
      if (text !== undefined) modules.set(path, text);
    }
  };
  addModules(src);
  const nestedNames = new Set<string>();
  const findNested = (s: ComponentSource, depth: number) => {
    const visit = (n: ts.Node) => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && /^[A-Z]/.test(n.tagName.getText(s.sf))) {
        const tag = n.tagName.getText(s.sf);
        if (tag !== name && !nestedNames.has(tag) && reader.exists(tag)) {
          nestedNames.add(tag);
          const other = reader.load(tag);
          addModules(other);
          if (other && depth < 3) findNested(other, depth + 1);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(s.sf);
  };
  findNested(src, 0);
  // Base styles of the nested components first, then the component's own (they override, as with CSS module order).
  const ordered = [...modules].sort(([a], [b]) => Number(a.startsWith(`${opts.componentsDir}/${name}/`)) - Number(b.startsWith(`${opts.componentsDir}/${name}/`)));
  const rules: CssRule[] = [];
  const cssErrors: string[] = [];
  for (const [path, text] of ordered) {
    const r = parseCssModule(path, text, rules.length);
    rules.push(...r.rules);
    cssErrors.push(...r.errors);
  }

  // Axes: string-literal union props that change the rendered classes.
  const base = evaluateVariant(reader, src, rules, {}, DEFAULT_STATE, opts.tokens);
  if (!base) throw new Error(`${name}: could not read what the component renders.`);
  const unmappedProps: SpecUnmapped[] = [];
  const axes: SpecAxis[] = [];
  const defaults = new Map<string, Value>();
  {
    const scope: Scope = { src, vars: new Map(), locals: new Map(), toggles: new Map(), main: true };
    bindProps(src.fn, scope, {});
    for (const [prop] of src.props) defaults.set(prop, scope.vars.get(prop));
  }
  for (const p of src.props.values()) {
    if (p.kind !== 'union' || !p.values) continue;
    const changes = p.values.some((v) => evaluateVariant(reader, src, rules, { [p.name]: v }, DEFAULT_STATE, opts.tokens)?.classes !== base.classes);
    if (!changes) {
      unmappedProps.push({ part: 'root', property: `prop ${p.name}`, value: p.values.join(' | '), reason: 'does not change the styles' });
      continue;
    }
    const def = defaults.get(p.name);
    axes.push({ name: sentenceCase(p.name), prop: p.name, values: [...p.values], default: typeof def === 'string' && p.values.includes(def) ? def : p.values[0]! });
  }

  const combos = product(axes);
  const propsFor = (combo: Record<string, string>) => Object.fromEntries(axes.map((a) => [a.prop!, combo[a.name]!]));
  const canDisable = src.native === 'button' || src.native === 'input' || src.native === 'textarea' || src.props.has('disabled');
  const states = STATES.filter((s) => s.name !== 'Disabled' || canDisable);
  const byState = new Map<string, Map<string, Evaluated>>();
  for (const s of states) {
    const m = new Map<string, Evaluated>();
    for (const combo of combos) {
      const ev = evaluateVariant(reader, src, rules, propsFor(combo), s.state, opts.tokens);
      if (ev) m.set(JSON.stringify(combo), ev);
    }
    byState.set(s.name, m);
  }
  // A state is drawn when it looks different from Default (and Pressed from Hover) in at least one variant.
  const differs = (s: string, from: string) =>
    combos.some((c) => {
      const a = byState.get(s)!.get(JSON.stringify(c));
      const b = byState.get(from)?.get(JSON.stringify(c));
      return a && b && !sameValues(a.values, b.values);
    });
  const stateNames = states
    .map((s) => s.name)
    .filter((s) => s === 'Default' || (differs(s, 'Default') && (s !== 'Pressed' || differs(s, 'Hover'))));
  if (stateNames.length > 1) axes.push({ name: 'State', values: stateNames, default: 'Default' });

  const variants: SpecVariant[] = [];
  const unmapped: SpecUnmapped[] = [];
  for (const combo of combos) {
    for (const s of stateNames.length > 1 ? stateNames : ['Default']) {
      const ev = byState.get(s)!.get(JSON.stringify(combo));
      if (!ev) continue;
      const props = stateNames.length > 1 ? { ...combo, State: s } : { ...combo };
      variants.push({ props, values: ev.values });
      unmapped.push(...ev.unmapped);
    }
  }
  if (variants.length > MAX_VARIANTS) throw new Error(`${name}: ${variants.length} variants, more than ${MAX_VARIANTS}. Split an axis before generating.`);

  // Parts, layout and properties come from the default variant.
  const parts: SpecPart[] = [];
  const properties: SpecProperty[] = [];
  for (const [id, n] of base.built.parts) {
    const parent = base.built.parents.get(id);
    const part: SpecPart = {
      id,
      name: !parent ? name : n.kind === 'text' ? n.text!.property : n.visible ? n.visible.property : n.name ?? (n.kind === 'icon' ? 'Icon' : n.classes[0]?.split('|')[1] ?? n.tag),
      kind: n.kind,
      ...(parent ? { parent } : {}),
      ...(n.classes.length ? { source: n.classes.map((c) => c.split('|').map((x, i) => (i === 0 ? posix.basename(x) : `.${x}`)).join(' ')).join(', ') } : {}),
      ...(n.kind === 'frame' ? { layout: base.layouts.get(id) } : {}),
      ...(n.kind === 'frame' && clips(base.computed.get(id)) ? { clip: true } : {}),
      ...(!parent && fillsContainer(base.computed.get(id)) ? { fill: true } : {}),
      ...(n.text ? { text: n.text.property } : {}),
      ...(n.visible ? { visible: n.visible.property } : {}),
    };
    parts.push(part);
    if (n.text && !properties.some((p) => p.name === n.text!.property)) properties.push({ name: n.text.property, type: 'TEXT', default: n.text.default, ...(n.text.prop ? { prop: n.text.prop } : {}) });
  }
  for (const n of base.built.parts.values())
    if (n.visible && !properties.some((p) => p.name === n.visible!.property)) properties.push({ name: n.visible.property, type: 'BOOLEAN', default: false, prop: n.visible.prop });

  // Props the spec does not draw (loading, slots...), so readers know what is missing.
  const used = new Set([...axes.map((a) => a.prop), ...properties.map((p) => p.prop), 'disabled', 'className', 'children', 'render']);
  for (const p of src.props.values()) {
    if (used.has(p.name) || p.kind === 'function' || p.kind === 'string' || p.kind === 'other' || p.kind === 'union') continue;
    unmappedProps.push({ part: 'root', property: `prop ${p.name}`, value: p.kind, reason: p.kind === 'node' ? 'slot content is not drawn' : p.kind === 'icon' ? 'icon prop with no icon part' : 'not drawn in this version' });
  }
  for (const e of cssErrors) unmappedProps.push({ part: 'root', property: 'css', value: e, reason: 'selector not understood' });

  flattenWrapper(parts, variants, unmapped);
  const swapped = addSwaps(name, src, parts, properties, axes, variants, opts);
  for (let i = unmappedProps.length - 1; i >= 0; i--) if (swapped.has(unmappedProps[i]!.property.replace(/^prop /, ''))) unmappedProps.splice(i, 1);

  const seen = new Set<string>();
  const dedup = [...unmappedProps, ...unmapped].filter((u) => {
    const k = `${u.part}|${u.property}|${u.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Every variant lists all of its fields (even when equal across variants): the plugin binds per variant.
  const source = [src.file, ...[...modules.keys()].sort()];
  const spec: Omit<ComponentSpec, 'hash'> = { name, source, axes, properties, parts, variants, unmapped: dedup };
  return { name, hash: hashSpec(spec), source, axes, properties, parts, variants, unmapped: dedup };
}


// ---------------------------------------------------------------------------------------------
// Swappable parts: icons and content slots

/** Icons every pulled file gets besides the ones the components use, so designers can swap without importing. */
export const COMMON_ICONS = ['Plus', 'Minus', 'Pencil', 'Trash2', 'Copy', 'Search', 'X', 'Check', 'ChevronDown', 'ChevronRight', 'Info', 'AlertTriangle', 'Star', 'Settings', 'ExternalLink', 'Download', 'Upload', 'Ellipsis'];

/** Default icon of a slot when neither the docs preview nor the AllStates story shows one. */
const FALLBACK_ICON: Record<string, string> = { Badge: 'Info' };
const DEFAULT_FALLBACK_ICON = 'Plus';

/** The icon components themselves: Icon.tsx draws `sm` by default; Lucide's grid is 24, the `lg` size. */
export const ICON_STYLE: SpecIconStyle = { size: 'icon.size.lg', color: 'color.text.default', stroke: 'icon.stroke' };

/** Media slot: a neutral plate with a centered image icon, 16:9, as wide as a card (size.80). */
export const MEDIA_SLOT: SpecSlot = {
  name: 'Slot/Media',
  kind: 'media',
  values: { fill: 'color.bg.muted', width: 'size.80' },
  aspect: [16, 9],
  icon: 'Image',
  iconValues: { width: 'icon.size.lg', height: 'icon.size.lg', stroke: 'color.text.muted', strokeWeight: 'icon.stroke' },
};

interface DocNode {
  c?: string;
  p?: Record<string, unknown>;
  children?: unknown[];
}

/** Every `{ c, p }` element of a docs.json value, in document order. */
function docElements(v: unknown, out: DocNode[] = []): DocNode[] {
  if (Array.isArray(v)) for (const x of v) docElements(x, out);
  else if (v && typeof v === 'object') {
    const n = v as DocNode;
    if (typeof n.c === 'string') out.push(n);
    for (const x of Object.values(v)) docElements(x, out);
  }
  return out;
}

function readDocs(name: string, opts: SpecGeneratorOptions): Record<string, unknown> | undefined {
  const text = opts.read(`${opts.componentsDir}/${name}/${name}.docs.json`);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readStories(name: string, opts: SpecGeneratorOptions): ts.SourceFile | undefined {
  const file = `${opts.componentsDir}/${name}/${name}.stories.tsx`;
  const text = opts.read(file);
  return text === undefined ? undefined : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** Names imported from lucide-react by a stories file. */
function storyIcons(sf: ts.SourceFile | undefined): string[] {
  const out: string[] = [];
  for (const st of sf?.statements ?? []) {
    if (!ts.isImportDeclaration(st) || unquote(st.moduleSpecifier.getText(sf)) !== 'lucide-react') continue;
    const b = st.importClause?.namedBindings;
    if (b && ts.isNamedImports(b)) for (const e of b.elements) if (!e.isTypeOnly) out.push((e.propertyName ?? e.name).text);
  }
  return out;
}

/** First icon the AllStates story passes to `<Name prop={Icon}>` (the false branch of a condition: the general case). */
function allStatesIcon(sf: ts.SourceFile | undefined, name: string, prop: string): string | undefined {
  if (!sf) return undefined;
  let decl: ts.Node | undefined;
  for (const st of sf.statements)
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === 'AllStates') decl = d;
  let found: string | undefined;
  const pick = (e: ts.Expression): string | undefined => {
    if (ts.isParenthesizedExpression(e)) return pick(e.expression);
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isConditionalExpression(e)) return pick(e.whenFalse);
    return undefined;
  };
  const visit = (n: ts.Node) => {
    if (found) return;
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === name) {
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== prop || !a.initializer || !ts.isJsxExpression(a.initializer) || !a.initializer.expression) continue;
        found = pick(a.initializer.expression);
        if (found) return;
      }
    }
    ts.forEachChild(n, visit);
  };
  if (decl) visit(decl);
  return found;
}

/** Default icon of an icon prop: the docs preview, then the AllStates story, then a fallback. */
function defaultIcon(name: string, prop: string, opts: SpecGeneratorOptions): string {
  const docs = readDocs(name, opts);
  for (const el of docElements(docs?.preview)) {
    const v = el.c === name ? el.p?.[prop] : undefined;
    if (typeof v === 'string' && /^[A-Z]\w*$/.test(v)) return v;
  }
  return allStatesIcon(readStories(name, opts), name, prop) ?? FALLBACK_ICON[name] ?? DEFAULT_FALLBACK_ICON;
}

/** Icon names a component's docs (icon props of any element) and stories (lucide-react imports) reference. */
function referencedIcons(name: string, opts: SpecGeneratorOptions): string[] {
  const out: string[] = [];
  for (const el of docElements(readDocs(name, opts)))
    for (const [k, v] of Object.entries(el.p ?? {})) if (/^icon/i.test(k) && typeof v === 'string' && /^[A-Z]\w*$/.test(v)) out.push(v);
  out.push(...storyIcons(readStories(name, opts)));
  return out;
}

const zeroInline = (v: Partial<Record<SpecField, SpecValue>> | undefined) => !!v && v.paddingLeft === 0 && v.paddingRight === 0;

/**
 * Marks the swappable parts of a spec and returns the code props they stand for:
 * - Icon parts swap between every icon ("Icon", "Icon start"), default from the docs or stories. Optional icons keep
 *   their BOOLEAN visibility property.
 * - A compound part's content (a text in a non-root frame) that code draws full-bleed in some variant (no inline
 *   padding: Card padding none, for media) becomes a content slot: "Slot/<Component> <part> text" or "Slot/Media",
 *   Media by default where it is full-bleed. Its TEXT property moves to the text slot component.
 */
function addSwaps(name: string, src: ComponentSource, parts: SpecPart[], properties: SpecProperty[], axes: SpecAxis[], variants: SpecVariant[], opts: SpecGeneratorOptions): Set<string> {
  const props = new Set<string>();
  const iconProps = [...src.props.values()].filter((p) => p.kind === 'icon');
  const defaultKey = variantKeyOf(Object.fromEntries(axes.map((a) => [a.name, a.default])));
  const defaultVariant = variants.find((v) => variantKeyOf(v.props) === defaultKey) ?? variants[0];
  const setSlot = (part: string, value: (v: SpecVariant) => string) => {
    for (const v of variants) (v.slots ??= {})[part] = value(v);
  };
  for (const part of parts) {
    if (part.kind === 'icon') {
      const visibleProp = part.visible ? properties.find((p) => p.type === 'BOOLEAN' && p.name === part.visible)?.prop : undefined;
      const prop = visibleProp ?? iconProps.find((p) => !p.optional && !properties.some((x) => x.prop === p.name))?.name;
      if (!prop) continue;
      const icon = iconComponentName(defaultIcon(name, prop, opts));
      part.swap = { property: sentenceCase(prop), default: icon, prop };
      setSlot(part.id, () => icon);
      props.add(prop);
      continue;
    }
    const parent = parts.find((p) => p.id === part.parent);
    if (part.kind !== 'text' || !part.text || !parent?.parent || parent.kind !== 'frame') continue;
    if (!variants.some((v) => zeroInline(v.values[parent.id]))) continue;
    const textSlot = `Slot/${name} ${part.text.toLowerCase()} text`;
    const media = MEDIA_SLOT.name;
    part.swap = { property: part.text, default: zeroInline(defaultVariant?.values[parent.id]) ? media : textSlot, options: [textSlot, media] };
    setSlot(part.id, (v) => (zeroInline(v.values[parent.id]) ? media : textSlot));
    const i = properties.findIndex((p) => p.type === 'TEXT' && p.name === part.text);
    if (i >= 0) properties.splice(i, 1);
    delete part.text;
  }
  return props;
}

// ---------------------------------------------------------------------------------------------
// Lucide icons

/** lucide-react export name -> icon id, from the ESM index ("export { default as Trash2, ... } from './icons/trash.mjs'"). */
function lucideIndex(dir: string, opts: SpecGeneratorOptions): Map<string, string> {
  const text = opts.read(`${dir}/lucide-react.mjs`) ?? opts.read(`${dir}/lucide-react.js`);
  if (text === undefined) throw new Error(`lucide-react was not found at ${dir}: run npm install.`);
  const out = new Map<string, string>();
  for (const m of text.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/icons\/([\w-]+)\.m?js'/g)) {
    for (const part of m[1]!.split(',')) {
      const n = /default as (\w+)/.exec(part.trim());
      if (n) out.set(n[1]!, m[2]!);
    }
  }
  return out;
}

const attrText = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The icon's SVG from its lucide-react module (`__iconData.node` or `__iconNode`), with Lucide's default attributes. */
function lucideSvg(dir: string, id: string, opts: SpecGeneratorOptions): string {
  const file = `${dir}/icons/${id}.mjs`;
  const text = opts.read(file) ?? opts.read(`${dir}/icons/${id}.js`);
  if (text === undefined) throw new Error(`lucide-react has no icon file ${file}.`);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let nodeArray: ts.ArrayLiteralExpression | undefined;
  const visit = (n: ts.Node) => {
    if (nodeArray) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      if (n.name.text === '__iconNode' && ts.isArrayLiteralExpression(n.initializer)) nodeArray = n.initializer;
      if (n.name.text === '__iconData' && ts.isObjectLiteralExpression(n.initializer)) {
        const prop = n.initializer.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'node');
        if (prop && ts.isArrayLiteralExpression(prop.initializer)) nodeArray = prop.initializer;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!nodeArray) throw new Error(`${file}: no icon node found.`);
  const children = nodeArray.elements.map((el) => {
    if (!ts.isArrayLiteralExpression(el)) throw new Error(`${file}: unexpected icon node.`);
    const [tag, attrs] = el.elements;
    const name = tag && ts.isStringLiteral(tag) ? tag.text : '';
    const pairs: string[] = [];
    if (attrs && ts.isObjectLiteralExpression(attrs)) {
      for (const p of attrs.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const key = unquote(p.name.getText(sf));
        if (key === 'key') continue;
        const v = p.initializer;
        const value = ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v) ? v.text : ts.isNumericLiteral(v) ? Number(v.text) : undefined;
        if (value !== undefined) pairs.push(`${key}="${attrText(value)}"`);
      }
    }
    return `<${name}${pairs.length ? ` ${pairs.join(' ')}` : ''}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children.join('')}</svg>`;
}

/**
 * The icons section: every icon a slot defaults to, every icon the components' docs and stories reference, the media
 * slot's icon, then the common set. One entry per Lucide icon (aliases folded into the first name seen), sorted by name.
 */
export function generateIcons(components: ComponentSpec[], opts: SpecGeneratorOptions, slots: SpecSlot[] = []): SpecIcon[] {
  const dir = opts.lucideDir ?? 'node_modules/lucide-react/dist/esm';
  const index = lucideIndex(dir, opts);
  const names: string[] = [];
  for (const c of components) {
    for (const p of c.parts) if (p.swap && !p.swap.options) names.push(p.swap.default.replace(/^Icon\//, ''));
    names.push(...referencedIcons(c.name, opts));
  }
  for (const s of slots) if (s.icon) names.push(s.icon);
  names.push(...COMMON_ICONS);
  const byId = new Map<string, SpecIcon>();
  for (const n of names) {
    const id = index.get(n);
    if (!id) throw new Error(`Icon ${n} is not exported by lucide-react.`);
    const hit = byId.get(id);
    if (!hit) byId.set(id, { name: n, lucide: id, svg: lucideSvg(dir, id, opts) });
    else if (hit.name !== n && !hit.aliases?.includes(n)) (hit.aliases ??= []).push(n);
  }
  return [...byId.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((i) => (i.aliases ? { ...i, aliases: [...i.aliases].sort() } : i));
}

/** Content components the specs' slots swap to: each component's text slot (its default variant's text fields), then Media. */
export function generateSlots(components: ComponentSpec[]): SpecSlot[] {
  const out: SpecSlot[] = [];
  let media = false;
  for (const c of components) {
    const defaultKey = variantKeyOf(Object.fromEntries(c.axes.map((a) => [a.name, a.default])));
    const v = c.variants.find((x) => variantKeyOf(x.props) === defaultKey) ?? c.variants[0];
    for (const p of c.parts) {
      if (!p.swap?.options) continue;
      for (const o of p.swap.options) {
        if (o === MEDIA_SLOT.name) media = true;
        else if (!out.some((s) => s.name === o)) out.push({ name: o, kind: 'text', values: { ...(v?.values[p.id] ?? {}) }, text: { property: 'Text', default: p.name } });
      }
    }
  }
  if (media) out.push(MEDIA_SLOT);
  return out;
}

export function generateComponentSpecs(names: string[], opts: SpecGeneratorOptions): ComponentSpecsFile {
  const components = names.map((n) => generateComponentSpec(n, opts));
  const slots = generateSlots(components);
  return {
    version: COMPONENT_SPECS_VERSION,
    generated: 'Generated by `npm run specs` from the component TSX and CSS modules. Do not edit: the test suite fails when it is out of date.',
    components,
    icons: generateIcons(components, opts, slots),
    iconStyle: ICON_STYLE,
    slots,
  };
}

// ---------------------------------------------------------------------------------------------
// Repo helpers (Node)

/** The 6 base components of the first version. The generator works on any component folder. */
export const SPEC_COMPONENTS = ['Button', 'IconButton', 'Badge', 'Tag', 'Input', 'Card'];

/** CSS custom property -> token, for every token of the repo (all tiers), with the repo's cssVar convention. */
export function tokenCssIndex(files: Record<string, string>, opts: { prefix?: string; separator?: string; layout?: Parameters<typeof buildTokenSet>[1] } = {}): Map<string, TokenInfo> {
  const set = buildTokenSet(files, opts.layout ?? {});
  const out = new Map<string, TokenInfo>();
  for (const t of set.tokens.values()) {
    const v = tokenCssVar(t.path, opts.prefix, opts.separator);
    if (!out.has(v)) out.set(v, { path: t.path, type: t.type });
  }
  return out;
}

/** Specs of `names` for the repo at `root`, with bridge.config.json (tokens root, components dir, cssVar). */
export function generateRepoComponentSpecs(root: string, names: string[] = SPEC_COMPONENTS): ComponentSpecsFile {
  const configText = readFileSync(join(root, CONFIG_FILE), 'utf8');
  const config = loadConfig(configText);
  const tokensRoot = join(root, config.tokens.root);
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const full = join(dir, n);
      if (statSync(full).isDirectory()) walk(full);
      else if (n.endsWith('.tokens.json')) files[relative(tokensRoot, full).split('\\').join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(tokensRoot);
  const tokens = tokenCssIndex(files, { prefix: config.cssVar.prefix, separator: config.cssVar.separator, layout: layoutOptions(config) });
  const read = (p: string) => {
    try {
      return readFileSync(join(root, p), 'utf8');
    } catch {
      return undefined;
    }
  };
  const componentsDir = config.components?.dir ?? 'packages/react/src/components';
  return generateComponentSpecs(names, { componentsDir, read, tokens, styleSuffix: config.components?.styleSuffix });
}

/** The JSON text written to disk: stable, two-space indent, trailing newline. */
export const serializeComponentSpecs = (f: ComponentSpecsFile) => `${JSON.stringify(f, null, 2)}\n`;
