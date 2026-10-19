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
  type SpecCoverage,
  type SpecExample,
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
  type SpecVector,
  hashSpec,
  iconComponentName,
  specHash,
  validateComponentSpec,
  tokenCssVar,
  variantKeyOf,
} from '../component-spec';
import { CONFIG_FILE, loadConfig } from '../config';
import { buildTokenSet, layoutOptions } from '../token-set';
import { type CssElement, type CssRule, type CssState, DEFAULT_STATE, computeValues, declaredFor, parseCssModule, splitTop } from './spec-css';

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
  /** Every component folder, to find components a file exports besides its own (Radio in RadioGroup.tsx). */
  components?: string[] | undefined;
  /** Repo-relative global stylesheet apps load before the components (inherited text styles, tag rules). */
  baseCss?: string | undefined;
  /** Repo-relative folder of specs drafted with Claude; default `component-spec-overrides` next to the specs file. */
  overridesDir?: string | undefined;
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
  /** Component folder the file lives in ("RadioGroup" for Radio). */
  folder: string;
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
  /** Every exported component of the file, by name (Radio in RadioGroup.tsx). */
  exported: Map<string, ts.FunctionLikeDeclaration>;
  /** Identifiers imported from @base-ui/react: their elements carry Base UI's state attributes. */
  baseUi: Set<string>;
  /** Plain helper functions of the file (`initials(name)`), callable with literal arguments. */
  helpers: Map<string, ts.FunctionDeclaration>;
  /** Local name -> lucide-react export, for icons the component draws itself (a checkbox's check mark). */
  lucide: Map<string, string>;
  /** Top-level consts of the file (`const TONE_ICON = { ... }`). */
  consts: Map<string, ts.Expression>;
  /** Base UI modules the file imports ("checkbox", "switch", "progress"). */
  baseUiModules: Set<string>;
  /** Top-level consts holding a function (`const defaultTitle = (n) => ...`): callable values. */
  fnConsts: Map<string, ts.ArrowFunction | ts.FunctionExpression>;
  /**
   * Functions imported from the package's own plain modules (`swatchColor` from ../../utils/color): modules with no
   * imports and no JSX, run as they are, called with data.
   */
  imported: Map<string, (...args: unknown[]) => unknown>;
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

  /** Export name -> component folder, for components a file exports besides its own (Radio in RadioGroup). */
  private exportIndex: Map<string, string> | undefined;

  /** The folder a component comes from: its own, or the folder whose file exports it. */
  folderOf(name: string): string | undefined {
    if (this.opts.read(`${this.dirOf(name)}/${name}.tsx`) !== undefined) return name;
    if (!this.exportIndex) {
      this.exportIndex = new Map();
      for (const folder of this.opts.components ?? []) {
        const text = this.opts.read(`${this.dirOf(folder)}/${folder}.tsx`) ?? '';
        for (const m of text.matchAll(/forwardRef[^(]*\(\s*function\s+([A-Z]\w*)|export function ([A-Z]\w*)/g)) {
          const n = (m[1] ?? m[2])!;
          if (n !== folder && !this.exportIndex.has(n)) this.exportIndex.set(n, folder);
        }
      }
    }
    return this.exportIndex.get(name);
  }

  exists(name: string): boolean {
    return this.folderOf(name) !== undefined;
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
    const folder = this.folderOf(name);
    const file = `${this.dirOf(folder ?? name)}/${folder ?? name}.tsx`;
    const text = folder ? this.opts.read(file) : undefined;
    if (text === undefined) {
      this.cache.set(name, null);
      return null;
    }
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const styles = new Map<string, string>();
    const baseUi = new Set<string>();
    const helpers = new Map<string, ts.FunctionDeclaration>();
    const lucide = new Map<string, string>();
    const consts = new Map<string, ts.Expression>();
    const baseUiModules = new Set<string>();
    const fnConsts = new Map<string, ts.ArrowFunction | ts.FunctionExpression>();
    const imported = new Map<string, (...args: unknown[]) => unknown>();
    for (const st of sf.statements) {
      if (ts.isVariableStatement(st))
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer) continue;
          const init = skipCasts(d.initializer);
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) fnConsts.set(d.name.text, init);
          else if (!/forwardRef|^\(/.test(d.initializer.getText(sf).slice(0, 12))) consts.set(d.name.text, d.initializer);
        }
      if (ts.isFunctionDeclaration(st) && st.name && /^[a-z]/.test(st.name.text) && st.body) helpers.set(st.name.text, st);
      if (!ts.isImportDeclaration(st) || !st.importClause) continue;
      const spec = unquote(st.moduleSpecifier.getText(sf));
      // A plain module of the package (utils): its functions run as they are.
      if (spec.startsWith('.') && !/\.css$/.test(spec) && !/^\.\.\/\w+$/.test(spec)) {
        const b = st.importClause.namedBindings;
        const mod = b && ts.isNamedImports(b) ? this.plainModule(posix.normalize(posix.join(this.dirOf(folder!), spec))) : undefined;
        if (mod && b && ts.isNamedImports(b))
          for (const e of b.elements) {
            const f = mod[(e.propertyName ?? e.name).text];
            if (typeof f === 'function') imported.set(e.name.text, f as (...args: unknown[]) => unknown);
          }
      }
      if (spec === 'lucide-react') {
        const b = st.importClause.namedBindings;
        if (b && ts.isNamedImports(b)) for (const e of b.elements) lucide.set(e.name.text, (e.propertyName ?? e.name).text);
        continue;
      }
      if (spec.startsWith('@base-ui/react')) {
        baseUiModules.add(spec.replace(/^@base-ui\/react\/?/, ''));
        const b = st.importClause.namedBindings;
        if (st.importClause.name) baseUi.add(st.importClause.name.text);
        if (b && ts.isNamedImports(b)) for (const e of b.elements) baseUi.add(e.name.text);
        continue;
      }
      if (!st.importClause.name || !spec.endsWith(this.opts.styleSuffix ?? '.module.css')) continue;
      styles.set(st.importClause.name.text, posix.normalize(posix.join(this.dirOf(folder!), spec)));
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
    const src: ComponentSource = { name, folder: folder!, file, sf, styles, props, native, fn, subcomponents, exported: fns, baseUi, helpers, lucide, consts, baseUiModules, fnConsts, imported };
    this.cache.set(name, src);
    return src;
  }

  private modules = new Map<string, Record<string, unknown> | undefined>();

  /**
   * Exports of a plain module of the package (`utils/color.ts`): no imports, no JSX, so it runs on its own. Undefined
   * for anything else (a module that imports React or another file).
   */
  plainModule(path: string): Record<string, unknown> | undefined {
    if (this.modules.has(path)) return this.modules.get(path);
    let out: Record<string, unknown> | undefined;
    const text = this.opts.read(`${path}.ts`) ?? this.opts.read(`${path}/index.ts`);
    if (text !== undefined) {
      const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      // A .ts file has no JSX; it must not import anything (React, other files) to run on its own.
      const plain = !sf.statements.some((s) => ts.isImportDeclaration(s) || (ts.isExportDeclaration(s) && !!s.moduleSpecifier));
      if (plain) {
        try {
          const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
          const exports: Record<string, unknown> = {};
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          new Function('exports', 'module', js)(exports, { exports });
          out = exports;
        } catch {
          out = undefined;
        }
      }
    }
    this.modules.set(path, out);
    return out;
  }
}

/** The expression under casts and parentheses (`(x as T)`, `x satisfies T`). */
function skipCasts(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
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

/** Content of a node prop the main component draws as text ("label"): a TEXT property with a default. */
interface TextRef {
  textProp: string;
  text: string;
}

/** A function as a value (a default prop `errorSummaryTitle = defaultTitle`, an arrow passed as a prop): callable. */
interface FnRef {
  fnRef: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;
  scope: Scope;
}

type Value = undefined | null | boolean | number | string | symbol | ClassRef | StylesRef | JsxRef | TextRef | LucideRef | FnRef | Value[] | { [k: string]: Value };

const isFnRef = (v: Value): v is FnRef => !!v && typeof v === 'object' && 'fnRef' in (v as object);

const isClass = (v: Value): v is ClassRef => !!v && typeof v === 'object' && 'cls' in (v as object);
const isTextRef = (v: Value): v is TextRef => !!v && typeof v === 'object' && 'textProp' in (v as object);
/** A lucide-react icon the code names (`Info`, `TONE_ICON[tone]`). */
interface LucideRef {
  lucide: string;
}
const isLucide = (v: Value): v is LucideRef & Value => !!v && typeof v === 'object' && 'lucide' in (v as object);
const isStyles = (v: Value): v is StylesRef => !!v && typeof v === 'object' && 'module' in (v as object);
const isJsx = (v: Value): v is JsxRef => !!v && typeof v === 'object' && 'jsx' in (v as object);

interface Scope {
  src: ComponentSource;
  vars: Map<string, Value>;
  /** Local consts, evaluated on first use. */
  locals: Map<string, ts.Expression>;
  /** Identifiers bound to optional icon props (or a boolean shown as a part): JSX conditions on them become BOOLEAN properties. */
  toggles: Map<string, string>;
  /** Optional node or string props behind a toggle: the value they take while their part is drawn. */
  toggleValues?: Map<string, Value> | undefined;
  /** Local consts by name (kept after evaluation), to see which toggle a derived condition depends on. */
  inits?: Map<string, ts.Expression> | undefined;
  /** Content from the docs preview for `{children}` (a group's options), when the component is drawn with it. */
  preview?: DocChild[] | undefined;
  /** A nested component's checked state, from its props (`defaultChecked`, `indeterminate`). */
  checked?: 'true' | 'false' | 'mixed' | undefined;
  /** Optional props shown by default because the example gives them. */
  toggleOn?: Set<string> | undefined;
  /** React context values provided above (`<TabsContext.Provider value={...}>`), by context name. */
  contexts?: Map<string, Value> | undefined;
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
  const icon = scope.src.lucide.get(name);
  if (icon) return { lucide: icon };
  const top = scope.src.consts.get(name);
  if (top) return evaluate(top, { ...scope, vars: new Map(), locals: new Map() });
  const fnConst = scope.src.fnConsts.get(name);
  if (fnConst) return { fnRef: fnConst, scope: { ...scope, vars: new Map(), locals: new Map(), toggles: new Map() } };
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
    if ((Array.isArray(obj) || typeof obj === 'string') && e.name.text === 'length') return obj.length;
    if (obj === OPAQUE) return OPAQUE;
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && !isClass(obj) && !isJsx(obj)) return (obj as Record<string, Value>)[e.name.text];
    return undefined;
  }
  if (ts.isElementAccessExpression(e)) {
    const obj = evaluate(e.expression, scope);
    const key = evaluate(e.argumentExpression, scope);
    if (isStyles(obj) && typeof key === 'string') return { cls: `${obj.module}|${key}` };
    if (Array.isArray(obj) && typeof key === 'number') return obj[key];
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && (typeof key === 'string' || typeof key === 'number') && !isClass(obj) && !isJsx(obj)) return (obj as Record<string, Value>)[key];
    return undefined;
  }
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return !truthy(evaluate(e.operand, scope));
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken) {
    const v = evaluate(e.operand, scope);
    return typeof v === 'number' ? -v : OPAQUE;
  }
  if (ts.isTypeOfExpression(e)) {
    const v = evaluate(e.expression, scope);
    if (v === OPAQUE || isJsx(v)) return OPAQUE;
    return v === null ? 'object' : Array.isArray(v) ? 'object' : typeof v === 'symbol' ? OPAQUE : typeof v;
  }
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
        return arithmetic(op, l, r);
    }
  }
  if (ts.isCallExpression(e)) {
    const callee = e.expression.getText(sf);
    if (callee === 'cx' || callee === 'clsx' || callee === 'classNames') return e.arguments.map((a) => evaluate(a, scope)).filter(truthy);
    // Base UI's mergeProps: the props objects merged, later ones winning (unknown spreads add nothing drawn).
    if (callee === 'mergeProps') {
      const out: Record<string, Value> = {};
      for (const a of e.arguments) {
        const v = evaluate(a, scope);
        if (v && typeof v === 'object' && !Array.isArray(v) && !isJsx(v) && !isClass(v)) Object.assign(out, v);
      }
      return out;
    }
    // Math on known numbers.
    const math = /^Math\.(max|min|floor|ceil|round|abs)$/.exec(callee);
    if (math) {
      const args = e.arguments.map((a) => evaluate(a, scope));
      return args.every((a) => typeof a === 'number') ? (Math[math[1] as 'max'] as (...n: number[]) => number)(...(args as number[])) : OPAQUE;
    }
    // Object.entries / keys / values of a known object (or of nothing: an empty list).
    const objFn = /^Object\.(entries|keys|values)$/.exec(callee);
    if (objFn && e.arguments[0]) {
      const o = evaluate(e.arguments[0], scope);
      if (o === undefined || o === null) return [];
      if (o && typeof o === 'object' && !Array.isArray(o) && !isJsx(o) && !isClass(o)) {
        const rec = o as Record<string, Value>;
        return objFn[1] === 'keys' ? Object.keys(rec) : objFn[1] === 'values' ? Object.values(rec) : Object.entries(rec).map(([k, v]) => [k, v]);
      }
      return OPAQUE;
    }
    // createElement(tag, props, ...children): an element like JSX.
    if ((callee === 'createElement' || callee === 'React.createElement') && e.arguments[0]) {
      const tag = evaluate(e.arguments[0], scope);
      const props = e.arguments[1] ? evaluate(e.arguments[1], scope) : undefined;
      if (typeof tag !== 'string') return OPAQUE;
      return { element: tag, props: (props && typeof props === 'object' && !Array.isArray(props) ? props : {}) as Record<string, Value>, kids: e.arguments.slice(2).map((a) => evaluate(a, scope)) } as unknown as Value;
    }
    // React context: createContext(default) is its default; useContext reads the nearest provider's value, else it.
    if ((callee === 'createContext' || callee === 'React.createContext') && e.arguments[0]) return evaluate(e.arguments[0], scope);
    if ((callee === 'useContext' || callee === 'React.useContext') && e.arguments[0]) {
      const key = e.arguments[0].getText(sf);
      return scope.contexts?.has(key) ? scope.contexts.get(key) : evaluate(e.arguments[0], scope);
    }
    // Base UI's useRender({ defaultTagName, props }): the element it renders by default.
    if (callee === 'useRender' && e.arguments[0]) {
      const o = evaluate(e.arguments[0], scope) as Record<string, Value> | undefined;
      const props = (o?.props && typeof o.props === 'object' && !Array.isArray(o.props) ? o.props : {}) as Record<string, Value>;
      return { element: typeof o?.defaultTagName === 'string' ? o.defaultTagName : 'div', props, kids: [] } as unknown as Value;
    }
    // useMemo(() => value, deps): the value.
    if ((callee === 'useMemo' || callee === 'React.useMemo') && e.arguments[0]) return callArrow(e.arguments[0], [], scope);
    // Array.isArray(x) and Array.from({ length: n }, fn) on known values.
    if (callee === 'Array.isArray' && e.arguments[0]) {
      const v = evaluate(e.arguments[0], scope);
      return v === OPAQUE || isFnRef(v) ? OPAQUE : Array.isArray(v);
    }
    if (callee === 'Array.from' && e.arguments[0]) {
      const v = evaluate(e.arguments[0], scope);
      const length = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Value>).length : undefined;
      const list: Value[] | undefined = Array.isArray(v) ? v : typeof length === 'number' && length >= 0 && length < 1000 ? Array.from({ length }, () => undefined) : undefined;
      if (!list) return OPAQUE;
      const fn = e.arguments[1];
      if (!fn) return list;
      const results = list.map((x, i) => callArrow(fn, [x, i], scope));
      return results.some((r) => r === OPAQUE) ? OPAQUE : results;
    }
    if (ts.isPropertyAccessExpression(e.expression) && /^(map|flatMap|filter|some|every|find)$/.test(e.expression.name.text)) {
      const list = evaluate(e.expression.expression, scope);
      if (Array.isArray(list)) return listMethod(list, e.expression.name.text, e.arguments, scope);
    }
    // String and list methods on known values (`text.split('.')`, `formatted.join(' to ')`).
    if (ts.isPropertyAccessExpression(e.expression)) {
      const obj = evaluate(e.expression.expression, scope);
      const r = valueMethod(obj, e.expression.name.text, e.arguments.map((a) => evaluate(a, scope)));
      if (r !== undefined) return r;
    }
    // A local arrow function (`const renderItem = (o) => <Item ... />`), called with values.
    if (ts.isIdentifier(e.expression)) {
      const fnExpr = scope.inits?.get(e.expression.text) ?? scope.locals.get(e.expression.text);
      if (fnExpr && (ts.isArrowFunction(fnExpr) || ts.isFunctionExpression(fnExpr)))
        return callArrow(
          fnExpr,
          e.arguments.map((a) => evaluate(a, scope)),
          scope,
        );
    }
    const helper = ts.isIdentifier(e.expression) ? scope.src.helpers.get(e.expression.text) : undefined;
    if (helper) {
      const args = e.arguments.map((a) => evaluate(a, scope));
      // A helper that returns elements (`breakAfterDots(text)`): read like the component, not run.
      if (containsJsx(helper)) return callArrow(helper, args, { ...scope, vars: new Map(), locals: new Map(), toggles: new Map(), inits: new Map() });
      return callHelper(helper, args, scope.src);
    }
    const imported = ts.isIdentifier(e.expression) ? scope.src.imported.get(e.expression.text) : undefined;
    if (imported) return callData(imported, e.arguments.map((a) => evaluate(a, scope)));
    // A function held by a value (a default prop, a top-level const): called with values.
    if (ts.isIdentifier(e.expression)) {
      const v = evaluate(e.expression, scope);
      if (isFnRef(v)) return callArrow(v.fnRef, e.arguments.map((a) => evaluate(a, scope)), v.scope);
    }
    return OPAQUE;
  }
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return { fnRef: e, scope };
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return { jsx: e, scope };
  if (ts.isObjectLiteralExpression(e)) {
    const out: Record<string, Value> = {};
    for (const p of e.properties) {
      if (ts.isPropertyAssignment(p)) out[unquote(p.name.getText(sf))] = evaluate(p.initializer, scope);
      else if (ts.isShorthandPropertyAssignment(p)) out[p.name.text] = lookup(scope, p.name.text);
      else if (ts.isSpreadAssignment(p)) {
        const v = evaluate(p.expression, scope);
        if (v && typeof v === 'object' && !Array.isArray(v) && !isJsx(v) && !isClass(v)) Object.assign(out, v);
      } else return OPAQUE;
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(e)) return e.elements.map((x) => evaluate(x, scope));
  return OPAQUE;
}

/**
 * A plain helper of the component file (`initials(name)`) called with literal arguments: transpiled and run, so the
 * drawn text is what code renders. Only strings, numbers and booleans go in and come out; anything else is opaque.
 */
/** Data only: strings, numbers, booleans, and lists or objects of them (a select's options). */
const isData = (v: Value): boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined ||
  (Array.isArray(v) && v.every(isData)) ||
  (!!v && typeof v === 'object' && !isJsx(v) && !isClass(v) && !isStyles(v) && !isTextRef(v) && !isFnRef(v) && Object.values(v as Record<string, Value>).every(isData));

/** A function run on data (texts are passed as their text): its result when it is data, else opaque. */
function callData(fn: (...args: unknown[]) => unknown, args: Value[]): Value {
  const data = args.map((a) => (isTextRef(a) ? a.text : a));
  if (!data.every(isData)) return OPAQUE;
  try {
    const out: unknown = fn(...structuredClone(data));
    const v = jsonValue(JSON.parse(JSON.stringify(out ?? null)));
    return isData(v) ? v : OPAQUE;
  } catch {
    return OPAQUE;
  }
}

function callHelper(fn: ts.FunctionDeclaration, args: Value[], src: ComponentSource): Value {
  try {
    const js = ts.transpileModule(fn.getText(src.sf).replace(/^export\s+(default\s+)?/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function(`${js}; return ${fn.name!.text}.apply(null, arguments);`) as (...a: unknown[]) => unknown;
    return callData(run, args);
  } catch {
    return OPAQUE;
  }
}

/** Whether a function's body writes JSX (it returns elements, not data). */
function containsJsx(fn: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(fn);
  return found;
}

/** String and list methods on known values: split, join, trim, slice, includes, startsWith, endsWith, case changes. */
function valueMethod(obj: Value, method: string, args: Value[]): Value | undefined {
  const str = (i: number) => (typeof args[i] === 'string' ? (args[i] as string) : undefined);
  const int = (i: number) => (typeof args[i] === 'number' ? (args[i] as number) : args[i] === undefined ? undefined : NaN);
  if (typeof obj === 'string') {
    switch (method) {
      case 'split':
        return str(0) !== undefined ? obj.split(str(0)!) : undefined;
      case 'trim':
        return obj.trim();
      case 'toLowerCase':
        return obj.toLowerCase();
      case 'toUpperCase':
        return obj.toUpperCase();
      case 'startsWith':
        return str(0) !== undefined ? obj.startsWith(str(0)!) : undefined;
      case 'endsWith':
        return str(0) !== undefined ? obj.endsWith(str(0)!) : undefined;
      case 'includes':
        return str(0) !== undefined ? obj.includes(str(0)!) : undefined;
      case 'slice':
        return Number.isNaN(int(0)) || Number.isNaN(int(1)) ? undefined : obj.slice(int(0), int(1));
      default:
        return undefined;
    }
  }
  if (Array.isArray(obj)) {
    switch (method) {
      case 'join':
        return obj.every((x) => typeof x === 'string' || typeof x === 'number') ? obj.join(str(0) ?? ',') : undefined;
      case 'slice':
        return Number.isNaN(int(0)) || Number.isNaN(int(1)) ? undefined : obj.slice(int(0), int(1));
      case 'includes':
        return obj.includes(args[0]);
      default:
        return undefined;
    }
  }
  return undefined;
}

/** An arrow or function expression called with values (`(o) => ({ value: o.value })`), when its body is readable. */
function callArrow(fn: ts.Expression | ts.FunctionDeclaration, args: Value[], scope: Scope): Value {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn) && !ts.isFunctionDeclaration(fn)) return OPAQUE;
  if (!fn.body) return OPAQUE;
  const vars = new Map(scope.vars);
  fn.parameters.forEach((p, i) => {
    const v = args[i];
    if (ts.isIdentifier(p.name)) vars.set(p.name.text, v);
    else if (ts.isObjectBindingPattern(p.name) && v && typeof v === 'object')
      for (const el of p.name.elements) if (ts.isIdentifier(el.name)) vars.set(el.name.text, (v as Record<string, Value>)[(el.propertyName ?? el.name).getText(scope.src.sf)]);
    const pattern: ts.BindingName = p.name;
    if (ts.isArrayBindingPattern(pattern) && Array.isArray(v))
      pattern.elements.forEach((el, j) => {
        if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) vars.set(el.name.text, v[j]);
      });
  });
  const inner: Scope = { ...scope, vars, locals: new Map(scope.locals) };
  if (!ts.isBlock(fn.body)) return evaluate(fn.body, inner);
  const run = (stmts: readonly ts.Statement[]): { value: Value } | undefined => {
    for (const st of stmts) {
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) inner.locals.set(d.name.text, d.initializer);
      if (ts.isIfStatement(st)) {
        const c = evaluate(st.expression, inner);
        if (c === OPAQUE) return { value: OPAQUE };
        const branch = truthy(c) ? st.thenStatement : st.elseStatement;
        const r = branch ? run(ts.isBlock(branch) ? branch.statements : [branch]) : undefined;
        if (r) return r;
      }
      // A loop that fills a list cannot be followed: the result is not known.
      if (ts.isForOfStatement(st) || ts.isForStatement(st) || ts.isWhileStatement(st)) return { value: OPAQUE };
      if (ts.isReturnStatement(st)) return { value: st.expression ? evaluate(st.expression, inner) : undefined };
    }
    return undefined;
  };
  return run(fn.body.statements)?.value;
}

/** List methods on known lists, with a readable callback: map, filter, some, every, find. */
function listMethod(list: Value[], method: string, args: readonly ts.Expression[], scope: Scope): Value {
  let fn = args[0];
  // A callback named by a local (`items.map(renderItem)`).
  if (fn && ts.isIdentifier(fn)) fn = scope.inits?.get(fn.text) ?? scope.locals.get(fn.text) ?? fn;
  if (!fn) return OPAQUE;
  const results = list.map((x, i) => callArrow(fn, [x, i], scope));
  if (results.some((r) => r === OPAQUE)) return OPAQUE;
  switch (method) {
    case 'map':
      return results;
    case 'flatMap':
      return results.flatMap((r) => (Array.isArray(r) ? r : [r]));
    case 'filter':
      return list.filter((_, i) => truthy(results[i]));
    case 'some':
      return results.some(truthy);
    case 'every':
      return results.every(truthy);
    case 'find':
      return list.find((_, i) => truthy(results[i]));
    default:
      return OPAQUE;
  }
}

/** Arithmetic and comparisons on known numbers (and string concatenation); a missing value compares false. */
function arithmetic(op: ts.SyntaxKind, l: Value, r: Value): Value {
  if (l === OPAQUE || r === OPAQUE) return OPAQUE;
  const K = ts.SyntaxKind;
  const compare = op === K.LessThanToken || op === K.GreaterThanToken || op === K.LessThanEqualsToken || op === K.GreaterThanEqualsToken;
  if (compare && (l === undefined || l === null || r === undefined || r === null)) return false;
  if (op === K.PlusToken && (typeof l === 'string' || typeof r === 'string') && (typeof l === 'string' || typeof l === 'number') && (typeof r === 'string' || typeof r === 'number')) return `${l}${r}`;
  if (typeof l !== 'number' || typeof r !== 'number') return OPAQUE;
  switch (op) {
    case K.PlusToken:
      return l + r;
    case K.MinusToken:
      return l - r;
    case K.AsteriskToken:
      return l * r;
    case K.SlashToken:
      return l / r;
    case K.LessThanToken:
      return l < r;
    case K.GreaterThanToken:
      return l > r;
    case K.LessThanEqualsToken:
      return l <= r;
    case K.GreaterThanEqualsToken:
      return l >= r;
    default:
      return OPAQUE;
  }
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
  const taken = new Set<string>();
  for (const el of param.name.elements) {
    if (el.dotDotDotToken || !ts.isIdentifier(el.name)) continue;
    const prop = el.propertyName ? el.propertyName.getText(scope.src.sf) : el.name.text;
    names.set(el.name.text, prop);
    taken.add(prop);
    let v = given[prop];
    if (v === undefined && el.initializer) v = evaluate(el.initializer, scope);
    scope.vars.set(el.name.text, v);
  }
  // `...rest`: the props given that are not named (children passed through a spread, data attributes).
  const rest = param.name.elements.find((el) => el.dotDotDotToken && ts.isIdentifier(el.name));
  // Children an example gives a nested component (a table header's rows) go through the spread too.
  const keepChildren = !scope.main && !!scope.preview?.some((c) => typeof c !== 'string');
  if (rest && ts.isIdentifier(rest.name)) scope.vars.set(rest.name.text, Object.fromEntries(Object.entries(given).filter(([k, v]) => !taken.has(k) && v !== undefined && (v !== CHILDREN || keepChildren))) as Value);
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
        for (const d of st.declarationList.declarations) {
          // const [value, setValue] = useState(initial): the value starts as the initial one.
          if (ts.isArrayBindingPattern(d.name) && d.initializer && ts.isCallExpression(d.initializer) && /^(React\.)?useState$/.test(d.initializer.expression.getText(scope.src.sf))) {
            const first = d.name.elements[0];
            const init = d.initializer.arguments[0];
            if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name) && init) {
              scope.locals.set(first.name.text, init);
              scope.inits?.set(first.name.text, init);
            }
            continue;
          }
          // const { variant, size } = useContext(Ctx): each name from the object.
          if (ts.isObjectBindingPattern(d.name) && d.initializer) {
            const obj = evaluate(d.initializer, scope);
            for (const el of d.name.elements) {
              if (!ts.isIdentifier(el.name) || el.dotDotDotToken) continue;
              const key = (el.propertyName ?? el.name).getText(scope.src.sf);
              let v = obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, Value>)[key] : undefined;
              if (v === undefined && el.initializer) v = evaluate(el.initializer, scope);
              scope.vars.set(el.name.text, v);
            }
            continue;
          }
          if (!ts.isIdentifier(d.name) || !d.initializer) continue;
          scope.locals.set(d.name.text, d.initializer);
          scope.inits?.set(d.name.text, d.initializer);
        }
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
  /** Text written in code (a group's option label, a literal "*"): drawn as is, no TEXT property. */
  chars?: string | undefined;
  /** The text as React renders it, spaces at its ends kept (`Page ` before `{page}`): joins inline runs exactly. */
  raw?: string | undefined;
  /** Whitespace only: joins inline runs, dropped otherwise. */
  space?: boolean | undefined;
  /** A compound root drawn with the parts its file exports (CardHeader...), not with an example's children. */
  fromExports?: boolean | undefined;
  placeholder?: boolean | undefined;
  inputLike?: boolean | undefined;
  /** BOOLEAN property that shows this optional part. */
  visible?: { property: string; prop: string; /** Shown by default: the example gives it. */ on?: boolean } | undefined;
  /** Spreads `...rest` with no children of its own: children come through props. */
  takesChildren?: boolean | undefined;
  /** Name for the layer, when it is not the class. */
  name?: string | undefined;
  /** A Base UI part: carries Base UI's state attributes. */
  baseUi?: boolean | undefined;
  /** data-* and aria-* attributes the JSX sets, as strings. */
  attrs?: Map<string, string> | undefined;
  /** Base UI parts: the checked state they carry, from the drawn state ("state", the main component) or their props. */
  checked?: 'state' | 'true' | 'false' | 'mixed' | undefined;
  /** Icon parts whose icon is written in code (`<Icon icon={Check} />`): the lucide-react name. */
  icon?: string | undefined;
  /** An image (`<img>`, a Base UI `*.Image`): drawn as the media slot. */
  media?: boolean | undefined;
  /** Checked because its `value` is the group's selected option; its Base UI parts (the radio dot) follow it. */
  selectedBy?: boolean | undefined;
  /** Only drawn while checked (a Base UI indicator that is not kept mounted). */
  whenChecked?: boolean | undefined;
  /** Inline SVG: the `<svg>` element's literal attributes; its shapes are in `shapes`, not parts. */
  svgAttrs?: Record<string, string> | undefined;
  shapes?: Node[] | undefined;
  /** Inline style custom properties (`style={{ '--_pct': 64 }}`). */
  styleVars?: Map<string, string> | undefined;
  /** A Base UI value indicator (a progress fill): its share of the track, from the root's value, min and max. */
  fraction?: number | undefined;
  /** A Base UI thumb (a slider's): its center sits at this share of its track. */
  at?: number | undefined;
  /** A Base UI panel whose value is not the selected one: hidden. */
  inactive?: boolean | undefined;
  /** An inline background color (a swatch): content, not a token. */
  inlineFill?: string | undefined;
  /** A Base UI indicator Base UI sizes to the selected item (a tab underline): drawn inside that item, filling it. */
  follows?: boolean | undefined;
  /** A decoration drawn by `::before` or `::after` of its parent. */
  pseudo?: 'before' | 'after' | undefined;
}

const INPUT_TAGS = new Set(['input', 'textarea', 'BaseInput']);
/** SVG shapes drawn inside an inline `<svg>`. */
const SVG_SHAPES = /^(circle|path|rect|line|polyline|polygon|ellipse)$/;

/** Text fields: native inputs and Base UI input parts (`<BaseNumberField.Input>`). */
const isInputTag = (tag: string) => INPUT_TAGS.has(tag) || /\.Input$/.test(tag);

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
  /** What the render met and cannot draw faithfully (content computed while the page runs), in plain language. */
  blockers?: string[] | undefined;
  /** The option a group selects (`defaultValue` of a radio group): Base UI parts with that `value` are checked. */
  selected?: string | undefined;
  /** The `items` of the nearest Base UI root (a combobox's options), for render functions of its lists. */
  items?: Value[] | undefined;
  /** React context values provided above, by context name. */
  contexts?: Map<string, Value> | undefined;
  /** The value share of the nearest Base UI root with a numeric value (a progress at 64 of 100: 0.64). */
  fraction?: number | undefined;
  /** The nearest Base UI root with a numeric value: its value and module ("slider", "progress"). */
  numeric?: { value: number; module: string } | undefined;
  /** Arguments Base UI passes to the render function of a value display (the formatted value). */
  valueArgs?: Value[] | undefined;
  /** `orientation` of the nearest Base UI root: its parts carry it as data-orientation. */
  orientation?: string | undefined;
  /** Errors of the nearest Base UI form, by field name: the Field of that name shows its error. */
  formErrors?: Record<string, Value> | undefined;
  /** Optional text props the example gives the main component: their parts show that text, on by default. */
  examples?: Record<string, Value> | undefined;
}

/** A data-* or aria-* attribute value as the DOM gets it, or undefined when React leaves it out. */
function attrString(v: Value): string | undefined {
  if (v === undefined || v === null || v === OPAQUE || typeof v === 'symbol') return undefined;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function renderJsx(ref: JsxRef, ctx: RenderContext, visible?: Node['visible']): Node[] {
  const { jsx, scope } = ref;
  const sf = scope.src.sf;
  if (ts.isParenthesizedExpression(jsx)) return renderJsx({ jsx: jsx.expression, scope }, ctx, visible);
  if (ts.isJsxFragment(jsx)) return renderChildren(jsx.children, scope, ctx);
  if (!ts.isJsxElement(jsx) && !ts.isJsxSelfClosingElement(jsx)) return [];
  const open = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
  const tag = open.tagName.getText(sf);
  // A line break opportunity (`<wbr />` in a token path): nothing drawn.
  if (tag === 'wbr') return [];
  // <Fragment key={...}> and context providers draw their children only, like <>...</>; a provider's value reaches
  // the components below it (useContext).
  if (/\.Provider$/.test(tag) && ts.isJsxElement(jsx)) {
    const valueAttr = open.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'value');
    const value = valueAttr?.initializer && ts.isJsxExpression(valueAttr.initializer) && valueAttr.initializer.expression ? evaluate(valueAttr.initializer.expression, scope) : undefined;
    const contexts = new Map(ctx.contexts ?? []);
    contexts.set(tag.replace(/\.Provider$/, ''), value);
    const inner = { ...scope, contexts };
    return renderChildren(jsx.children, inner, { ...ctx, contexts });
  }
  if (/^(React\.)?Fragment$|\.Provider$/.test(tag)) return ts.isJsxElement(jsx) ? renderChildren(jsx.children, scope, ctx) : [];
  const attrs: Record<string, Value> = {};
  let spreads = false;
  let spreadChildren: Value;
  for (const a of open.attributes.properties) {
    if (ts.isJsxSpreadAttribute(a)) {
      spreads = true;
      // A spread of known props (`{...rest}`): their data and aria attributes, class names and the values a Base UI
      // root reads (value, min, max, orientation, form errors) apply; their children are drawn.
      const v = evaluate(a.expression, scope);
      if (v && typeof v === 'object' && !Array.isArray(v) && !isJsx(v) && !isClass(v) && !isElementValue(v) && !isFnRef(v)) {
        for (const [k, x] of Object.entries(v as Record<string, Value>)) {
          if (k === 'children') spreadChildren = x;
          else if (/^(data|aria)-/.test(k) || SPREAD_PROPS.has(k)) attrs[k] = x;
        }
      }
      continue;
    }
    const name = a.name.getText(sf);
    if (!a.initializer) attrs[name] = true;
    else if (ts.isStringLiteral(a.initializer)) attrs[name] = a.initializer.text;
    else if (ts.isJsxExpression(a.initializer) && a.initializer.expression) attrs[name] = evaluate(a.initializer.expression, scope);
  }
  const children = ts.isJsxElement(jsx) ? jsx.children : undefined;

  // A Base UI part with a `render` element (`<BaseDialog.Close render={<IconButton ... />} />`): Base UI renders that
  // element, with the part's class names added. `render={children}`: what the consumer passes (a trigger).
  // Base UI parts that only exist in some situations: the empty message of a list that has items, the clear button
  // of a field with no value, the arrow of a popup (placed by Base UI next to its trigger, not drawn).
  // An error message without `match` is shown by Base UI only once the field is invalid (a failed check while the page
  // runs): not drawn.
  if (scope.src.baseUi.has(tag.split('.')[0]!) && ((/\.Empty$/.test(tag) && ctx.items?.length) || (/\.Clear$/.test(tag) && ctx.selected === undefined) || /\.Arrow$/.test(tag) || (/\.Error$/.test(tag) && attrs.match === undefined))) return [];

  // With children of its own (`<Header render={<h3 />}>...`), the part keeps them: drawn as the part.
  if (scope.src.baseUi.has(tag.split('.')[0]!) && attrs.render !== undefined && !children?.some((c) => !ts.isJsxText(c) || c.text.trim())) {
    const r = attrs.render;
    const extra = classList(attrs.className);
    if (isJsx(r)) {
      const nodes = renderJsx(r, ctx, visible);
      if (nodes[0]) nodes[0].classes = [...nodes[0].classes, ...extra];
      return nodes;
    }
    const init = open.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'render')?.initializer;
    if (r === CHILDREN && init && ts.isJsxExpression(init) && init.expression) return renderExpression(init.expression, scope, ctx, visible);
  }

  // A design system component (Icon, Spinner...): rendered through its own TSX and CSS module.
  if (/^[A-Z]/.test(tag) && tag !== ctx.component && ctx.depth < 4 && ctx.reader.exists(tag)) {
    const nested = renderComponent(ctx.reader, tag, withFormError(tag, children?.length ? { ...attrs, children: childrenValue(children, scope) } : attrs, ctx), { ...ctx, depth: ctx.depth + 1 });
    if (nested) {
      if (tag === ICON_COMPONENT) {
        nested.kind = 'icon';
        const iconAttr = open.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'icon');
        const expr = iconAttr?.initializer && ts.isJsxExpression(iconAttr.initializer) ? iconAttr.initializer.expression : undefined;
        const lucideName = expr && ts.isIdentifier(expr) ? scope.src.lucide.get(expr.text) : undefined;
        if (lucideName) nested.icon = lucideName;
        else if (isLucide(attrs.icon)) nested.icon = attrs.icon.lucide;
        // An icon named by an example (`<MenuItem icon={Pencil}>` in the component sandbox): that icon.
        else if (typeof attrs.icon === 'string' && /^[A-Z]\w*$/.test(attrs.icon)) nested.icon = attrs.icon;
      }
      if (visible) nested.visible = visible;
      return [nested];
    }
  }
  const dataAttrs = new Map<string, string>();
  for (const [k, v] of Object.entries(attrs)) {
    if (!/^(data|aria)-/.test(k)) continue;
    const str = attrString(v);
    if (str !== undefined) dataAttrs.set(k, str);
  }
  const isBaseUi = scope.src.baseUi.has(tag.split('.')[0]!);
  // Base UI parts carry their root's orientation (`data-orientation`).
  const orientation = isBaseUi && typeof attrs.orientation === 'string' ? attrs.orientation : ctx.orientation;
  if (isBaseUi && orientation && !dataAttrs.has('data-orientation')) dataAttrs.set('data-orientation', orientation);
  const node: Node = {
    key: '',
    tag,
    classes: classList(attrs.className),
    children: [],
    kind: 'frame',
    ...(visible ? { visible } : {}),
    ...(scope.src.baseUi.has(tag.split('.')[0]!)
      ? ctx.selected !== undefined && typeof attrs.value === 'string'
        ? { baseUi: true, checked: attrs.value === ctx.selected ? 'true' : 'false', selectedBy: true }
        : { baseUi: true, checked: scope.main ? 'state' : (scope.checked ?? 'false') }
      : {}),
    ...(dataAttrs.size ? { attrs: dataAttrs } : {}),
    ...(/(^img$|\.Image$)/.test(tag) ? { media: true } : {}),
    // Base UI indicators are only mounted while their item is checked, unless keepMounted.
    ...(/\.(Item)?Indicator$/.test(tag) && scope.src.baseUi.has(tag.split('.')[0]!) && attrs.keepMounted !== true && ctx.fraction === undefined ? { whenChecked: true } : {}),
  };
  // A panel of a selection (a tab's panel) is hidden by Base UI unless its value is the selected one.
  if (isBaseUi && /\.Panel$/.test(tag) && node.selectedBy && node.checked === 'false') node.inactive = true;
  // A thumb of a numeric root (a slider): Base UI places its center at the value.
  if (isBaseUi && /\.Thumb$/.test(tag) && ctx.fraction !== undefined) node.at = ctx.fraction;
  // An inline background color (a swatch of the token's own color): content, not a token.
  const bg = attrs.style && typeof attrs.style === 'object' && !Array.isArray(attrs.style) ? (attrs.style as Record<string, Value>).backgroundColor : undefined;
  if (typeof bg === 'string') node.inlineFill = bg;
  // Inline style custom properties: they feed the CSS (`style={{ '--_pct': pct }}`).
  const style = attrs.style;
  if (style && typeof style === 'object' && !Array.isArray(style) && !isJsx(style)) {
    const vars = new Map<string, string>();
    for (const [k, v] of Object.entries(style as Record<string, Value>)) if (k.startsWith('--') && (typeof v === 'number' || typeof v === 'string')) vars.set(k, String(v));
    if (vars.size) node.styleVars = vars;
  }
  // Inline SVG: drawn as one vector layer, its shapes styled by the CSS (stroke, width, opacity, dashes).
  if (tag === 'svg') {
    const lit: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) if ((typeof v === 'string' || typeof v === 'number') && k !== 'className') lit[k] = String(v);
    node.svgAttrs = lit;
    node.shapes = children ? renderChildren(children, scope, ctx).filter((c) => SVG_SHAPES.test(c.tag)) : [];
    return [node];
  }
  if (SVG_SHAPES.test(tag)) {
    const lit: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) if ((typeof v === 'string' || typeof v === 'number') && k !== 'className') lit[k] = String(v);
    node.svgAttrs = lit;
    return [node];
  }
  if (isInputTag(tag)) {
    // A text field: its box (a textarea's border and padding) and the placeholder text inside. The box is merged away
    // when it draws nothing of its own (an input inside a styled wrapper).
    node.inputLike = true;
    // A field the example fills (`defaultValue="acme/design-tokens"`): its value, in the field's text color.
    const typed = typeof attrs.value === 'string' && attrs.value ? attrs.value : typeof attrs.defaultValue === 'string' && attrs.defaultValue ? attrs.defaultValue : undefined;
    if (typed !== undefined && !scope.main) {
      node.children = [textNode(typed)];
      return [node];
    }
    const value = typeof attrs.placeholder === 'string' ? attrs.placeholder : 'Placeholder';
    node.children = [{ key: '', tag: '#placeholder', classes: [], children: [], kind: 'text', placeholder: true, text: { property: 'Placeholder', default: value } }];
    return [node];
  }
  // A Base UI root with a numeric value (a progress, a meter): its indicator fills that share of the track.
  if (node.baseUi && /\.Indicator$/.test(tag) && ctx.fraction !== undefined) node.fraction = ctx.fraction;
  let childCtx: RenderContext = Array.isArray(attrs.items) && node.baseUi ? { ...ctx, items: attrs.items } : ctx;
  if (isBaseUi && orientation) childCtx = { ...childCtx, orientation };
  // A Base UI form with errors: each Field of that name shows its error.
  if (isBaseUi && attrs.errors && typeof attrs.errors === 'object' && !Array.isArray(attrs.errors) && !isFnRef(attrs.errors)) childCtx = { ...childCtx, formErrors: attrs.errors as Record<string, Value> };
  const numeric = typeof attrs.value === 'number' ? attrs.value : attrs.value === undefined && typeof attrs.defaultValue === 'number' ? attrs.defaultValue : undefined;
  if (node.baseUi && /\.Root$/.test(tag) && numeric !== undefined) {
    const min = typeof attrs.min === 'number' ? attrs.min : 0;
    const max = typeof attrs.max === 'number' ? attrs.max : 100;
    const local = tag.split('.')[0]!.toLowerCase();
    const module = [...scope.src.baseUiModules].find((m) => m && local.includes(m.split('/')[0]!)) ?? '';
    childCtx = { ...childCtx, fraction: Math.min(1, Math.max(0, (numeric - min) / (max - min || 1))), numeric: { value: numeric, module } };
  }
  // A Base UI value display under a numeric root: Base UI formats the value (a slider's number, a progress's percentage)
  // and passes it to a render function child.
  const formatted = ctx.fraction !== undefined && ctx.numeric ? (ctx.numeric.module === 'slider' ? new Intl.NumberFormat('en-US').format(ctx.numeric.value) : `${Math.round(ctx.fraction * 100)}%`) : undefined;
  if (node.baseUi && /\.Value$/.test(tag) && formatted !== undefined && ctx.numeric) childCtx = { ...childCtx, valueArgs: ctx.numeric.module === 'slider' ? [[formatted], [ctx.numeric.value]] : [formatted, ctx.numeric.value] };
  if (children) node.children = renderChildren(children, scope, childCtx);
  else if (spreadChildren === CHILDREN && scope.preview?.some((c) => typeof c !== 'string')) node.children = renderPreview(scope.preview, childCtx);
  else if (spreadChildren !== undefined && spreadChildren !== CHILDREN) node.children = renderValues([spreadChildren], ctx);
  else if (spreads) node.takesChildren = true;
  // A Base UI value display (`<BaseSelect.Value placeholder=... />`): Base UI writes the text; drawn as its placeholder.
  if (!node.children.length && node.baseUi && /\.Value$/.test(tag)) {
    // A value display under a numeric root (a progress at 64): Base UI writes the formatted value.
    const placeholder = formatted ?? (ctx.fraction !== undefined ? `${Math.round(ctx.fraction * 100)}%` : typeof attrs.placeholder === 'string' ? attrs.placeholder : 'Value');
    node.children = [{ key: '', tag: '#text', classes: [], children: [], kind: 'text', text: { property: 'Value', default: placeholder } }];
  }
  return [node];
}

/** Props a spread passes on to the element it lands on, besides data and aria attributes. */
const SPREAD_PROPS = new Set(['className', 'value', 'defaultValue', 'min', 'max', 'orientation', 'errors']);

/** A Base UI form's error for a nested component of the same `name` (a Field): passed as its `error`. */
function withFormError(tag: string, props: Record<string, Value>, ctx: RenderContext): Record<string, Value> {
  const name = props.name;
  if (!ctx.formErrors || typeof name !== 'string' || props.error !== undefined || !ctx.reader.load(tag)?.props.has('error')) return props;
  const message = ctx.formErrors[name];
  const text = Array.isArray(message) ? message[0] : message;
  return typeof text === 'string' ? { ...props, error: text } : props;
}

/** JSX children passed to a nested design system component (`<Field><Input /></Field>`), as its `children` prop. */
interface ChildrenRef {
  children: ts.NodeArray<ts.JsxChild>;
  scope: Scope;
}
const isChildrenRef = (v: Value): v is ChildrenRef & Value => !!v && typeof v === 'object' && 'children' in (v as object) && 'scope' in (v as object);

function childrenValue(children: ts.NodeArray<ts.JsxChild>, scope: Scope): Value {
  const texts = children.filter((c) => !ts.isJsxText(c) || c.text.trim());
  // Plain text children ("Save") are a string, like React gives them.
  if (texts.every((c) => ts.isJsxText(c))) return texts.map((c) => (c as ts.JsxText).text.trim()).join(' ');
  return { children, scope } as unknown as Value;
}

function renderChildren(children: ts.NodeArray<ts.JsxChild>, scope: Scope, ctx: RenderContext): Node[] {
  const out: Node[] = [];
  for (const c of children) {
    if (ts.isJsxText(c)) {
      const raw = jsxText(c.text);
      if (raw.trim()) out.push(textNode(raw.replace(/\s+/g, ' ').trim(), raw));
      else if (raw) out.push(spaceNode(raw));
      continue;
    }
    if (ts.isJsxExpression(c)) {
      if (c.expression) out.push(...renderExpression(c.expression, scope, ctx));
      continue;
    }
    out.push(...renderJsx({ jsx: c, scope }, ctx));
  }
  return out;
}

/** Whitespace between inline runs (`{' '}`, a space between words): joins runs, never a layer of its own. */
const spaceNode = (raw: string): Node => ({ key: '', tag: '#text', classes: [], children: [], kind: 'text', chars: '', raw, space: true });

const textNode = (chars: string, raw?: string): Node => ({ key: '', tag: '#text', classes: [], children: [], kind: 'text', chars, ...(raw !== undefined && raw !== chars ? { raw } : {}) });

/**
 * JSX text as React renders it (Babel's rule): lines trimmed where they meet a line break, empty lines dropped, the
 * others joined with one space; spaces inside a line, and at the ends of a single line, are kept.
 */
export function jsxText(text: string): string {
  const lines = text.split(/\r\n|\n|\r/);
  let out = '';
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, ' ');
    if (i !== 0) l = l.replace(/^ +/, '');
    if (i !== lines.length - 1) l = l.replace(/ +$/, '');
    if (!l) return;
    if (out && i !== 0) out += ' ';
    out += l;
  });
  return out;
}

/** Identifiers an expression reads, following local consts (`const invalid = error != null`). */
function identifiersIn(e: ts.Node, scope: Scope, seen = new Set<string>()): Set<string> {
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && !seen.has(n.text)) {
      seen.add(n.text);
      const init = scope.inits?.get(n.text);
      if (init) identifiersIn(init, scope, seen);
    }
    if (ts.isPropertyAccessExpression(n)) return visit(n.expression);
    ts.forEachChild(n, visit);
  };
  visit(e);
  return seen;
}

/** The scope a toggled part renders in: the toggle's prop holds its drawn value, derived locals are evaluated again. */
function toggledScope(scope: Scope, local: string): Scope {
  const vars = new Map(scope.vars);
  for (const k of scope.inits?.keys() ?? []) vars.delete(k);
  vars.set(local, scope.toggleValues?.get(local) ?? true);
  return { ...scope, vars, locals: new Map(scope.inits ?? []) };
}

/**
 * A JSX condition on an optional prop (`iconStart && ...`, `description && ...`, `invalid && ...` where invalid comes
 * from `error`): the part it shows becomes optional, behind a BOOLEAN property. Returns the property and the scope the
 * part renders in, or undefined when the condition does not depend on a toggle (or is false even with it on).
 */
function toggleFor(cond: ts.Expression, scope: Scope): { visible: NonNullable<Node['visible']>; scope: Scope } | undefined {
  if (!scope.toggles.size) return undefined;
  const ids = identifiersIn(cond, scope);
  const local = [...scope.toggles.keys()].find((k) => ids.has(k));
  if (!local) return undefined;
  const prop = scope.toggles.get(local)!;
  const inner = toggledScope(scope, local);
  if (!truthy(evaluate(cond, inner))) return undefined;
  // Shown whether the prop is set or not (`size === 'lg'` in the other branch): not behind the toggle.
  const off = { ...scope, vars: new Map(scope.vars), locals: new Map(scope.inits ?? []) };
  for (const k of scope.inits?.keys() ?? []) off.vars.delete(k);
  if (truthy(evaluate(cond, off))) return undefined;
  const kind = scope.src.props.get(prop)?.kind;
  const property = kind === 'icon' ? sentenceCase(prop) : `Show ${sentenceCase(prop).toLowerCase()}`;
  return { visible: { property, prop, ...(scope.toggleOn?.has(prop) ? { on: true } : {}) }, scope: inner };
}

/** A toggle on a string prop (an avatar's `src`) is named after the part it shows ("Show image"), not the prop. */
function nameToggle(visible: NonNullable<Node['visible']>, nodes: Node[], scope: Scope): Node[] {
  const cls = nodes[0]?.classes[0]?.split('|')[1];
  if (scope.src.props.get(visible.prop)?.kind === 'string' && cls) visible.property = `Show ${sentenceCase(cls).toLowerCase()}`;
  return nodes;
}

function renderExpression(e: ts.Expression, scope: Scope, ctx: RenderContext, visible?: Node['visible']): Node[] {
  if (ts.isParenthesizedExpression(e)) return renderExpression(e.expression, scope, ctx, visible);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const t = visible ? undefined : toggleFor(e.left, scope);
    if (t) return nameToggle(t.visible, renderExpression(e.right, t.scope, ctx, t.visible), scope);
    return truthy(evaluate(e.left, scope)) ? renderExpression(e.right, scope, ctx, visible) : [];
  }
  if (ts.isConditionalExpression(e)) {
    // `cond ? a : b` draws b while the optional prop is off: no toggle (Figma cannot show b when a BOOLEAN is off).
    const t = visible || truthy(evaluate(e.whenFalse, scope)) ? undefined : toggleFor(e.condition, scope);
    if (t) return nameToggle(t.visible, renderExpression(e.whenTrue, t.scope, ctx, t.visible), scope);
    return renderExpression(truthy(evaluate(e.condition, scope)) ? e.whenTrue : e.whenFalse, scope, ctx, visible);
  }
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return renderJsx({ jsx: e, scope }, ctx, visible);
  const v = evaluate(e, scope);
  if (v === CHILDREN) {
    if (scope.preview?.some((c) => typeof c !== 'string')) return renderPreview(scope.preview, ctx);
    return [{ key: '', tag: '#text', classes: [], children: [], kind: 'text', text: { property: 'Label', default: ctx.component, prop: 'children' } }];
  }
  if (isTextRef(v)) {
    const property = v.textProp === 'children' ? 'Label' : sentenceCase(v.textProp);
    return [{ key: '', tag: '#text', classes: [], children: [], kind: 'text', text: { property, default: v.text, prop: v.textProp }, ...(visible ? { visible } : {}) }];
  }
  if (isChildrenRef(v)) return renderChildren(v.children, v.scope, ctx);
  if (typeof v === 'string' && v.trim()) return [{ ...textNode(v.trim(), v), ...(visible ? { visible } : {}) }];
  if (typeof v === 'string' && v) return [spaceNode(v)];
  if (typeof v === 'number') return [textNode(String(v))];
  if (isJsx(v)) return renderJsx(v, ctx, visible);
  if (Array.isArray(v) || isElementValue(v)) return renderValues([v], ctx);
  if (v === OPAQUE || isFnRef(v)) {
    const mapped = renderMap(e, scope, ctx);
    if (mapped) return mapped;
    // A render function child of a Base UI list (`<Combobox.List>{renderItem}</Combobox.List>`): called for each item of
    // the root's `items`.
    const fn = functionOf(e, scope);
    if (fn && ctx.items) return renderValues(ctx.items.map((item) => callArrow(fn, [item], scope)), ctx);
    // A render function child of a Base UI value display (`<Slider.Value>{(formatted) => ...}</Slider.Value>`): called
    // with the value Base UI formats.
    if (fn && ctx.valueArgs) {
      const out = callArrow(fn, ctx.valueArgs, scope);
      if (out !== OPAQUE) return renderValues([out], ctx);
    }
    ctx.blockers?.push('shows content computed while the page runs');
  }
  return [];
}

/** The function an expression names: an arrow, a local holding one, or the branch of a condition that is one. */
function functionOf(e: ts.Expression, scope: Scope): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (ts.isParenthesizedExpression(e)) return functionOf(e.expression, scope);
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e;
  if (ts.isIdentifier(e)) {
    const init = scope.inits?.get(e.text) ?? scope.locals.get(e.text);
    return init ? functionOf(init, scope) : undefined;
  }
  if (ts.isConditionalExpression(e)) {
    const c = evaluate(e.condition, scope);
    return c === OPAQUE ? undefined : functionOf(truthy(c) ? e.whenTrue : e.whenFalse, scope);
  }
  return undefined;
}

/** A list of rendered values (a `.map()` of elements, texts): each drawn in order. */
/** An element made by `createElement` or `useRender`, with its props and children values. */
interface ElementValue {
  element: string;
  props: Record<string, Value>;
  kids: Value[];
}
const isElementValue = (v: Value): v is ElementValue & Value => !!v && typeof v === 'object' && 'element' in (v as object) && 'kids' in (v as object);

function elementNode(el: ElementValue, ctx: RenderContext): Node {
  const node: Node = { key: '', tag: el.element, classes: classList(el.props.className), children: [], kind: 'frame' };
  const kids = el.kids.length ? el.kids : el.props.children !== undefined ? [el.props.children] : [];
  for (const k of kids) {
    if (k === CHILDREN) node.children.push({ key: '', tag: '#text', classes: [], children: [], kind: 'text', text: { property: 'Label', default: ctx.component, prop: 'children' } });
    else if (isTextRef(k)) node.children.push({ key: '', tag: '#text', classes: [], children: [], kind: 'text', text: { property: k.textProp === 'children' ? 'Label' : sentenceCase(k.textProp), default: k.text, prop: k.textProp } });
    else node.children.push(...renderValues([k], ctx));
  }
  return node;
}

function renderValues(list: Value[], ctx: RenderContext): Node[] {
  const out: Node[] = [];
  for (const v of list) {
    if (isElementValue(v)) out.push(elementNode(v, ctx));
    else if (isChildrenRef(v)) out.push(...renderChildren(v.children, v.scope, ctx));
    else if (isTextRef(v)) out.push({ key: '', tag: '#text', classes: [], children: [], kind: 'text', text: { property: v.textProp === 'children' ? 'Label' : sentenceCase(v.textProp), default: v.text, prop: v.textProp } });
    else if (isJsx(v)) out.push(...renderJsx(v, ctx));
    else if (Array.isArray(v)) out.push(...renderValues(v, ctx));
    else if ((typeof v === 'string' && v.trim()) || typeof v === 'number') out.push(textNode(String(v).trim(), String(v)));
    else if (typeof v === 'string' && v) out.push(spaceNode(v));
    else if (v === OPAQUE) ctx.blockers?.push('shows content computed while the page runs');
  }
  return out;
}

/**
 * `items.map((item) => <X>{item.label}</X>)` over a list the docs preview gives (a segmented control's items): one
 * element per item, rendered with the item bound. Undefined when the list is not known.
 */
function renderMap(e: ts.Expression, scope: Scope, ctx: RenderContext): Node[] | undefined {
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || e.expression.name.text !== 'map') return undefined;
  const list = evaluate(e.expression.expression, scope);
  const fn = e.arguments[0];
  if (!Array.isArray(list) || !fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return undefined;
  const param = fn.parameters[0];
  const out: Node[] = [];
  list.forEach((item, i) => {
    const vars = new Map(scope.vars);
    if (param && ts.isIdentifier(param.name)) vars.set(param.name.text, item);
    else if (param && ts.isObjectBindingPattern(param.name) && item && typeof item === 'object')
      for (const el of param.name.elements) if (ts.isIdentifier(el.name)) vars.set(el.name.text, (item as Record<string, Value>)[(el.propertyName ?? el.name).getText(scope.src.sf)]);
    const index = fn.parameters[1];
    if (index && ts.isIdentifier(index.name)) vars.set(index.name.text, i);
    const inner: Scope = { ...scope, vars, locals: new Map(scope.locals), inits: new Map(scope.inits ?? []) };
    const body = fn.body;
    if (ts.isBlock(body)) {
      for (const st of body.statements) {
        if (ts.isVariableStatement(st))
          for (const d of st.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || !d.initializer) continue;
            inner.locals.set(d.name.text, d.initializer);
            inner.inits!.set(d.name.text, d.initializer);
          }
        if (ts.isReturnStatement(st) && st.expression) {
          out.push(...renderExpression(st.expression, inner, ctx));
          break;
        }
      }
    } else out.push(...renderExpression(body, inner, ctx));
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Docs preview content

/** An element of a docs.json preview ({ c, p, children }) or a text. */
type DocChild = string | { c: string; p?: Record<string, unknown>; children?: DocChild[] };

/** The first element of a docs preview drawing `name`, depth first. */
function previewElement(v: unknown, name: string): Exclude<DocChild, string> | undefined {
  if (Array.isArray(v)) {
    for (const x of v) {
      const hit = previewElement(x, name);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!v || typeof v !== 'object') return undefined;
  const n = v as Exclude<DocChild, string>;
  if (n.c === name) return n;
  return previewElement(n.children, name);
}

/**
 * The first element `<name>` of a stories file that has content, as a docs preview element: literal props, icons by
 * name, text and element children. Expressions it cannot read are left out.
 */
function storyElement(sf: ts.SourceFile | undefined, name: string): Exclude<DocChild, string> | undefined {
  if (!sf) return undefined;
  const lucide = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || unquote(st.moduleSpecifier.getText(sf)) !== 'lucide-react') continue;
    const b = st.importClause?.namedBindings;
    if (b && ts.isNamedImports(b)) for (const e of b.elements) lucide.add(e.name.text);
  }
  const convert = (n: ts.JsxElement | ts.JsxSelfClosingElement): Exclude<DocChild, string> => {
    const open = ts.isJsxElement(n) ? n.openingElement : n;
    const p: Record<string, unknown> = {};
    for (const a of open.attributes.properties) {
      if (!ts.isJsxAttribute(a)) continue;
      const key = a.name.getText(sf);
      const init = a.initializer;
      if (!init) p[key] = true;
      else if (ts.isStringLiteral(init)) p[key] = init.text;
      else if (ts.isJsxExpression(init) && init.expression) {
        const e = init.expression;
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) p[key] = e.text;
        else if (ts.isNumericLiteral(e)) p[key] = Number(e.text);
        else if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword) p[key] = e.kind === ts.SyntaxKind.TrueKeyword;
        else if (ts.isIdentifier(e) && lucide.has(e.text)) p[key] = e.text;
      }
    }
    const children: DocChild[] = [];
    if (ts.isJsxElement(n))
      for (const c of n.children) {
        if (ts.isJsxText(c)) {
          const t = c.text.replace(/\s+/g, ' ').trim();
          if (t) children.push(t);
        } else if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) children.push(convert(c));
        else if (ts.isJsxExpression(c) && c.expression && (ts.isStringLiteral(c.expression) || ts.isNoSubstitutionTemplateLiteral(c.expression))) children.push(c.expression.text);
      }
    return { c: open.tagName.getText(sf), ...(Object.keys(p).length ? { p } : {}), ...(children.length ? { children } : {}) };
  };
  let found: Exclude<DocChild, string> | undefined;
  const visit = (n: ts.Node) => {
    if (found) return;
    if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && (ts.isJsxElement(n) ? n.openingElement : n).tagName.getText(sf) === name) {
      const el = convert(n);
      if (el.children?.some((c) => typeof c !== 'string')) found = el;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** Literal props of a preview element (strings, numbers, booleans): what code gets. */
function previewProps(el: Exclude<DocChild, string>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(el.p ?? {})) if (v !== null && v !== undefined) out[k] = jsonValue(v);
  return out;
}

/** A JSON value of a docs preview (strings, numbers, lists and objects of them) as an evaluator value. */
function jsonValue(v: unknown): Value {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return v.map(jsonValue);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonValue(x)]));
  return undefined;
}

/** Preview children drawn for `{children}`: design system elements through their own TSX, texts as text. */
function renderPreview(children: DocChild[], ctx: RenderContext): Node[] {
  const out: Node[] = [];
  for (const c of children) {
    if (typeof c === 'string') {
      if (c.trim()) out.push(textNode(c.trim()));
      continue;
    }
    if (!ctx.reader.exists(c.c) || ctx.depth >= 4) continue;
    const kids = c.children ?? [];
    let props: Record<string, Value> = previewProps(c);
    if (kids.length && kids.every((k) => typeof k === 'string')) props.children = (kids as string[]).join(' ');
    else if (kids.length) props.children = CHILDREN;
    props = withFormError(c.c, props, ctx);
    const n = renderComponent(ctx.reader, c.c, props, { ...ctx, depth: ctx.depth + 1 }, undefined, kids.some((k) => typeof k !== 'string') ? kids : undefined);
    if (n) out.push(n);
    else ctx.blockers?.push(`cannot draw its ${c.c} parts yet`);
  }
  return out;
}

/**
 * `return useRender({ defaultTagName: 'a', props: mergeProps({ className, children }, rest) })` (Base UI's render
 * hook, Link): the element it renders by default, with its class names and children.
 */
function useRenderElement(fn: ts.FunctionLikeDeclaration, scope: Scope, ctx: RenderContext): Node[] | undefined {
  if (!fn.body || !ts.isBlock(fn.body)) return undefined;
  const ret = fn.body.statements.find(ts.isReturnStatement)?.expression;
  if (!ret || !ts.isCallExpression(ret) || ret.expression.getText(scope.src.sf) !== 'useRender' || !ret.arguments[0]) return undefined;
  const opts = evaluate(ret.arguments[0], scope) as Record<string, Value> | undefined;
  const tag = typeof opts?.defaultTagName === 'string' ? opts.defaultTagName : 'div';
  const props = (opts?.props && typeof opts.props === 'object' ? opts.props : {}) as Record<string, Value>;
  return [elementNode({ element: tag, props, kids: [] }, ctx)];
}

/** Renders a component for the given props into a node tree (its root node). */
function renderComponent(reader: Reader, name: string, props: Record<string, Value>, ctx: RenderContext, fnOverride?: ts.FunctionLikeDeclaration, preview?: DocChild[]): Node | undefined {
  const src = reader.load(name);
  const fn = fnOverride ?? src?.fn;
  if (!src || !fn) return undefined;
  const scope: Scope = { src, vars: new Map(), locals: new Map(), toggles: new Map(), main: ctx.depth === 0, inits: new Map(), ...(preview ? { preview } : {}), ...(ctx.contexts ? { contexts: ctx.contexts } : {}) };
  const given = { ...props };
  if (!scope.main) {
    const on = (k: string) => props[k] === true;
    scope.checked = on('indeterminate') ? 'mixed' : on('checked') || on('defaultChecked') ? 'true' : 'false';
  }
  if (scope.main) {
    // Content props the component writes ("label", "description"): TEXT properties, defaulting to their name.
    for (const p of src.props.values()) {
      if (given[p.name] !== undefined || p.name === 'children') continue;
      if (p.kind === 'node' && !p.optional) given[p.name] = { textProp: p.name, text: sentenceCase(p.name) };
      if (p.kind === 'string' && !p.optional) given[p.name] = sentenceCase(p.name);
    }
  }
  const names = bindProps(fn, scope, given);
  if (scope.main) {
    // Optional icon props are BOOLEAN properties ("Icon start"): their JSX condition shows a part. So are optional
    // content props ("Show description") and optional strings a part depends on (an avatar photo's `src`).
    scope.toggleValues = new Map();
    for (const [local, prop] of names) {
      const info = src.props.get(prop);
      if (!info?.optional || given[prop] !== undefined) continue;
      if (info.kind === 'icon') scope.toggles.set(local, prop);
      else if (info.kind === 'node' && prop !== 'children') {
        scope.toggles.set(local, prop);
        scope.toggleValues.set(local, { textProp: prop, text: sentenceCase(prop) });
      } else if (info.kind === 'string') {
        scope.toggles.set(local, prop);
        // Text the example gives (a token name): drawn with it, shown by default, like the example.
        const example = ctx.examples?.[prop];
        scope.toggleValues.set(local, typeof example === 'string' ? example : sentenceCase(prop));
        if (typeof example === 'string') (scope.toggleOn ??= new Set()).add(prop);
      }
    }
  }
  const jsx = renderedJsx(fn, scope);
  const nodes = jsx ? renderJsx(jsx, ctx) : useRenderElement(fn, scope, ctx);
  if (!nodes) return undefined;
  return nodes.length === 1 ? nodes[0] : nodes.length ? { key: '', tag: 'div', classes: [], children: nodes, kind: 'frame' } : undefined;
}

/** A wrapper whose only child is the text becomes the text part itself (Button's `<span class="label">`). */
function collapseText(n: Node, root = true, boxed: (n: Node) => boolean = () => false, unseen: (n: Node) => boolean = () => false): Node {
  n.children = n.children.map((c) => collapseText(c, false, boxed, unseen));
  // Screen reader text inside a run (a status word before a detail): never drawn, so not part of the drawn sentence.
  const seen = n.children.filter((c) => !unseen(c));
  if (seen.length < n.children.length && seen.length && /^(span|p|label|small|strong|em|code)$/.test(n.tag)) n.children = seen;
  // Inline text runs ("Page <span>6</span> of <span>12</span>"): one text layer with the whole sentence, styled like
  // its first run (Figma would need mixed styles for the rest). Only texts written in code, never a TEXT property.
  const run = (c: Node): string | undefined =>
    c.kind === 'text' && c.chars !== undefined && !c.visible ? (c.raw ?? c.chars) : c.tag === 'span' && c.kind === 'frame' && !c.visible && c.children.length === 1 ? run(c.children[0]!) : undefined;
  if (n.kind === 'frame' && n.children.filter((c) => !c.space).length > 1 && /^(span|p|label|small|strong|em|code)$/.test(n.tag) && n.children.every((c) => run(c) !== undefined)) {
    // Joined as React renders them: the spaces the texts have (`Page ` before `{page}`, a space between words), none
    // between two texts of one expression (`color` `.` `action`); elements with nothing between them keep one space.
    let chars = '';
    n.children.forEach((c, i) => {
      const text = run(c)!;
      const prev = n.children[i - 1];
      if (prev) {
        const before = run(prev)!;
        chars += /\s$/.test(before) || /^\s/.test(text) || (prev.tag === '#text' && c.tag === '#text') ? '' : ' ';
      }
      chars += text;
    });
    n.children = [{ ...textNode(chars.replace(/\s+/g, ' ').trim()) }];
  }
  n.children = n.children.filter((c) => !c.space);
  // Only inline wrappers (span): a block (Card header) keeps its frame for its padding.
  // Not when the span paints a box (a pill, a count badge): the box stays a frame around its text.
  if (!root && n.tag === 'span' && !n.name && n.kind === 'frame' && n.children.length === 1 && n.children[0]!.kind === 'text' && !n.children[0]!.classes.length && !n.children[0]!.inputLike && !boxed(n)) {
    const t = n.children[0]!;
    return { ...t, tag: n.tag, classes: n.classes, ...(n.visible ? { visible: n.visible } : {}) };
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Spec

interface Built {
  /** What the render could not draw faithfully. */
  blockers: string[];
  root: Node;
  /** Part id -> node, in tree order. */
  parts: Map<string, Node>;
  parents: Map<string, string | undefined>;
}

/** Renders the main component for one set of axis values, with stable part ids. */
/**
 * Which part of a component with a popup a set draws: the component without its popup (a select's trigger), or the
 * popup alone drawn open (`*.Popup` under the `*.Portal`), the way a Figma UI kit draws menus and dialogs.
 */
export type SpecView = 'without-popup' | 'popup';

/** The tree without its portals (popups), or the first `*.Popup` under a portal as the root. */
function applyView(root: Node, view: SpecView | undefined): Node | undefined {
  if (!view) return root;
  const isPortal = (n: Node) => /\.Portal$/.test(n.tag);
  if (view === 'without-popup') {
    const strip = (n: Node): Node => ({ ...n, children: n.children.filter((c) => !isPortal(c)).map(strip) });
    return isPortal(root) ? undefined : strip(root);
  }
  let found: Node | undefined;
  const find = (n: Node, inPortal: boolean) => {
    if (found) return;
    if (inPortal && /\.Popup$/.test(n.tag)) found = n;
    for (const c of n.children) find(c, inPortal || isPortal(n));
  };
  find(root, false);
  // Submenus and nested popups stay closed: only the popup itself is drawn open.
  const strip = (n: Node): Node => ({ ...n, children: n.children.filter((c) => !isPortal(c)).map(strip) });
  return found ? strip({ ...found, visible: undefined }) : undefined;
}

function build(reader: Reader, src: ComponentSource, props: Record<string, Value>, preview?: DocChild[], view?: SpecView, rules: CssRule[] = [], tokens?: Map<string, TokenInfo>, examples?: Record<string, Value>): Built | undefined {
  const blockers: string[] = [];
  const selected = typeof props.defaultValue === 'string' ? props.defaultValue : undefined;
  const rendered = renderComponent(reader, src.name, { ...props, children: CHILDREN }, { reader, depth: 0, component: src.name, blockers, ...(selected !== undefined ? { selected } : {}), ...(examples ? { examples } : {}) }, undefined, preview);
  let root = rendered && applyView(rendered, view);
  if (!root) return undefined;
  // An unstyled outer element around one child (a select's Base UI root around its trigger): the child is the set.
  const overlay = (n: Node) => POPUP_PART.test(n.tag) || /\.Portal$/.test(n.tag);
  while (root.children.length === 1 && !root.classes.length && !root.attrs && root.kind === 'frame' && !overlay(root) && root.children[0]!.kind === 'frame' && !root.children[0]!.visible && !overlay(root.children[0]!))
    root = root.children[0]!;
  // Compound components (Card): children come through props, so draw the parts the file exports (CardHeader...).
  if (root.takesChildren && !root.children.length && src.subcomponents.length) {
    root.fromExports = true;
    for (const sub of src.subcomponents) {
      const label = sub.name.slice(src.name.length);
      const n = renderComponent(reader, src.name, {}, { reader, depth: 1, component: src.name, blockers }, sub.fn);
      if (!n) continue;
      n.name = label;
      if (n.takesChildren && !n.children.length) n.children = [{ key: '', tag: '#text', classes: [], children: [], kind: 'text', text: { property: label, default: label } }];
      root.children.push(n);
    }
  }
  // Parts inside a selected option (a radio's dot) carry its checked state, as Base UI sets it on them.
  const follow = (n: Node, inherited: Node['checked']) => {
    if (n.baseUi && n.selectedBy) inherited = n.checked;
    else if (n.baseUi && inherited) n.checked = inherited;
    for (const c of n.children) follow(c, inherited);
  };
  follow(root, undefined);
  decorate(root, rules, tokens);
  // A span that paints a box in its default look (background, border or padding): kept as a frame.
  const boxed = (n: Node) => {
    const el: CssElement = { tag: n.tag, classes: new Set(n.classes), children: [], present: true, isRoot: false, inputLike: false };
    const d = declaredFor(rules, el, DEFAULT_STATE);
    const set = (k: string) => d.has(k) && !/^(0|0px|none|transparent)$/.test(d.get(k)!.value.trim());
    return ['background-color', 'border-top-width', 'padding-left', 'padding-top'].some(set);
  };
  // Visually hidden (the screen reader text pattern): left out of the text runs it sits in.
  const unseen = (n: Node) => {
    if (n.kind !== 'frame' && n.kind !== 'text') return false;
    const el: CssElement = { tag: n.tag, classes: new Set(n.classes), children: [], present: true, isRoot: false, inputLike: false };
    return visuallyHidden(new Map([...declaredFor(rules, el, DEFAULT_STATE)].map(([k, d]) => [k, d.value])));
  };
  const tree = collapseText(root, true, boxed, unseen);
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
    else base = slug(n.classes[0]?.split('|')[1] ?? (n.chars !== undefined ? 'text' : n.tag)) || 'part';
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    n.key = id;
    parts.set(id, n);
    parents.set(id, parent);
    for (const c of n.children) assign(c, id);
  };
  assign(tree, undefined);
  return { root: tree, parts, parents, blockers };
}

/** CSS elements of a node tree (no part ids yet), for the cascade before the parts are named. */
function cssElements(root: Node): Map<Node, CssElement> {
  const out = new Map<Node, CssElement>();
  const make = (n: Node, parent: CssElement | undefined): CssElement => {
    const el: CssElement = {
      tag: n.tag,
      classes: new Set(n.classes),
      parent,
      children: [],
      present: (!n.visible || !!n.visible.on) && !n.pseudo,
      isRoot: !parent,
      inputLike: !!n.inputLike,
      ...(n.baseUi ? { baseUi: true, checked: n.checked } : {}),
      ...(n.attrs ? { attrs: n.attrs } : {}),
    };
    out.set(n, el);
    el.children = n.children.map((c) => make(c, el));
    return el;
  };
  make(root, undefined);
  return out;
}

const declaredVarCache = new WeakMap<CssRule[], Set<string>>();
/** Custom properties the stylesheets declare (`--_height`): a var() of any other one that is not a token is set at run time. */
function declaredVars(rules: CssRule[]): Set<string> {
  let s = declaredVarCache.get(rules);
  if (!s) {
    s = new Set(rules.flatMap((r) => r.decls.filter((d) => d.prop.startsWith('--')).map((d) => d.prop)));
    declaredVarCache.set(rules, s);
  }
  return s;
}

/** `var(--active-tab-left)`: a custom property Base UI sets while the page runs (no rule declares it, not a token). */
function runtimeVar(raw: string | undefined, rules: CssRule[], tokens: Map<string, TokenInfo> | undefined): boolean {
  const m = raw ? /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw.trim()) : null;
  return !!m && !declaredVars(rules).has(m[1]!) && !tokens?.has(m[1]!);
}

/** Paints of a `::before` / `::after` that make it a visible decoration. */
const PSEUDO_PAINTS = ['background-color', 'border-top-width', 'border-bottom-width', 'border-left-width', 'border-right-width'];

/**
 * Layers the CSS draws without an element of their own, made into nodes so Figma gets a layer for them:
 * - `::before` / `::after` with empty content that paint (a hairline under a tab list): a "Decoration" frame, first
 *   when it sits under its siblings (negative z-index or ::before), else last. Styled from its host's pseudo rules.
 * - A Base UI indicator sized at run time to the selected item (`left: var(--active-tab-left)`): moved into that item,
 *   first (under its content), to fill it where code reads the item's size.
 */
function decorate(root: Node, rules: CssRule[], tokens: Map<string, TokenInfo> | undefined): void {
  if (!rules.length) return;
  const els = cssElements(root);
  const visit = (n: Node, parent: Node | undefined) => {
    for (const c of [...n.children]) visit(c, n);
    if (n.kind !== 'frame' || n.svgAttrs || n.pseudo) return;
    const el = els.get(n)!;
    if (n.baseUi && n.whenChecked && /\.Indicator$/.test(n.tag) && parent) {
      const d = declaredFor(rules, el, DEFAULT_STATE);
      if (['left', 'top', 'width', 'height'].some((k) => runtimeVar(d.get(k)?.value, rules, tokens))) {
        const item = parent.children.find((s) => s !== n && s.baseUi && s.selectedBy && s.checked === 'true');
        if (item) {
          parent.children.splice(parent.children.indexOf(n), 1);
          item.children.unshift(n);
          n.follows = true;
          delete n.whenChecked;
        }
      }
    }
    for (const pseudo of ['before', 'after'] as const) {
      const d = declaredFor(rules, el, DEFAULT_STATE, pseudo);
      if (!/^(""|'')$/.test(d.get('content')?.value.trim() ?? '')) continue;
      if (!PSEUDO_PAINTS.some((k) => d.has(k) && !/^(0|none|transparent)$/.test(d.get(k)!.value.trim()))) continue;
      const deco: Node = { key: '', tag: `::${pseudo}`, classes: [], children: [], kind: 'frame', pseudo, name: 'Decoration' };
      if (pseudo === 'before' || /^-/.test(d.get('z-index')?.value.trim() ?? '')) n.children.unshift(deco);
      else n.children.push(deco);
    }
  };
  visit(root, undefined);
}

function toCssTree(b: Built): Map<string, CssElement> {
  const els = new Map<string, CssElement>();
  const make = (n: Node, parent: CssElement | undefined): CssElement => {
    const el: CssElement = {
      tag: n.tag,
      classes: new Set(n.classes),
      parent,
      children: [],
      present: (!n.visible || !!n.visible.on) && !n.pseudo,
      isRoot: !parent,
      inputLike: !!n.inputLike,
      ...(n.baseUi ? { baseUi: true, checked: n.checked } : {}),
      ...(n.attrs ? { attrs: n.attrs } : {}),
    };
    els.set(n.key, el);
    el.children = n.children.map((c) => make(c, el));
    for (const [i, shape] of (n.shapes ?? []).entries()) {
      const sel: CssElement = { tag: shape.tag, classes: new Set(shape.classes), parent: el, children: [], present: true, isRoot: false, inputLike: false };
      els.set(`${n.key}#shape-${i}`, sel);
      el.children.push(sel);
    }
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
  // min(a, b) for a size that shrinks on small screens (`min(var(--size-140), 100%)`): the token it is designed at.
  const mm = /^min\(([\s\S]+)\)$/i.exec(v);
  if (mm) {
    for (const arg of splitTop(mm[1]!, ',')) {
      const r = resolveValue(arg, values, tokens, depth + 1, parent, forColor);
      if (r && r.unmapped === undefined && typeof r.value === 'string') return r;
    }
    return { unmapped: 'min() of no token' };
  }
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
    if (typeof r.value === 'number') return String(r.value);
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

/** Fields CSS may give as a unitless number. */
const NUMBER_FIELDS: ReadonlySet<SpecField> = new Set(['strokeWeight', 'opacity']);

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
  if (field === 'textDecoration') return ['keyword'];
  if (COLOR_FIELDS.has(field)) return ['color'];
  if (field === 'fontFamily') return ['fontFamily'];
  if (field === 'fontWeight') return ['fontWeight', 'number'];
  if (field === 'opacity') return ['number'];
  return ['dimension', 'number'];
}

interface PartValues {
  values: Partial<Record<SpecField, SpecValue>>;
  unmapped: { property: string; value: string; reason: string }[];
}

function partValues(node: Node, computed: Map<string, string>, own: Map<string, string>, tokens: Map<string, TokenInfo>, parent: Map<string, string> | undefined): PartValues {
  const out: PartValues = { values: {}, unmapped: [] };
  const set = (field: SpecField, prop: string, raw: string | undefined, skipZero = false) => {
    // Unitless numbers where CSS takes them (`stroke-width: 3`, `opacity: 0.5`): set as is, nothing to bind.
    if (raw !== undefined && NUMBER_FIELDS.has(field) && /^-?(\d+\.?\d*|\.\d+)$/.test(raw.trim())) {
      out.values[field] = Number(raw.trim());
      return;
    }
    // em: a multiple of the font size (the parent's, for font-size itself), from the font size token.
    const em = raw !== undefined ? /^(\d*\.?\d+)em$/.exec(raw.trim()) : null;
    if (em) {
      const base = prop === 'font-size' ? parent?.get('font-size') : computed.get('font-size');
      const b = resolveValue(base, prop === 'font-size' ? (parent ?? new Map()) : computed, tokens, 0, parent);
      if (b && typeof b.value === 'string' && !b.value.startsWith('calc(')) {
        const n = Number(em[1]);
        out.values[field] = n === 1 ? b.value : `calc(${b.value} * ${n})`;
        return;
      }
    }
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
  // Opacity 0 hides the part and 1 is the default: only values in between are drawn.
  const opacity = own.get('opacity');
  const setOpacity = () => {
    if (opacity !== undefined && !/^(0|1|1\.0+)$/.test(opacity.trim())) set('opacity', 'opacity', opacity);
  };
  if (node.kind === 'text') {
    for (const [prop, field] of TEXT_FIELDS) set(field, prop, computed.get(prop));
    // Underline (a link): a keyword, drawn unless its color is transparent (a standalone link at rest).
    const line = computed.get('text-decoration-line') ?? '';
    const lineColor = (computed.get('text-decoration-color') ?? '').trim().toLowerCase();
    const keyword = /underline/.test(line) ? 'UNDERLINE' : /line-through/.test(line) ? 'STRIKETHROUGH' : undefined;
    if (keyword && lineColor !== 'transparent') out.values.textDecoration = keyword;
    setOpacity();
    return out;
  }
  if (node.kind === 'icon') {
    set('width', 'width', computed.get('width'));
    set('height', 'height', computed.get('height'));
    set('stroke', 'color', computed.get('color'));
    set('strokeWeight', 'stroke-width', computed.get('stroke-width'));
    setOpacity();
    return out;
  }
  setOpacity();
  // Gap: the one along the auto layout direction; a wrapping row also spaces its lines (row-gap).
  const layout = layoutOf(computed);
  const gap = computed.get(layout.direction === 'HORIZONTAL' ? 'column-gap' : 'row-gap');
  for (const [prop, field] of FRAME_FIELDS) set(field, prop, field === 'itemSpacing' ? gap : computed.get(prop), field === 'minWidth' || field === 'minHeight');
  if (layout.wrap) set('counterAxisSpacing', 'row-gap', computed.get('row-gap'));
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

/** A grid with no tracks of its own (`display: grid; place-items: center`): one cell, drawn as a centering auto layout. */
const singleCellGrid = (c: Map<string, string>) =>
  /grid/.test(c.get('display') ?? '') && ['grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-template', 'grid-auto-flow', 'grid-auto-columns'].every((k) => !c.get(k) || c.get(k) === 'none');

/** The browser's display of table elements, when the CSS does not set one. */
const TABLE_DISPLAY: Record<string, string> = { table: 'table', thead: 'table-row-group', tbody: 'table-row-group', tfoot: 'table-row-group', tr: 'table-row', td: 'table-cell', th: 'table-cell', caption: 'table-caption' };

/** Cross-axis alignment of grid items (align-items). */
const gridCounter = (v: string | undefined): SpecLayout['counter'] => (/center/.test(v ?? '') ? 'CENTER' : /end/.test(v ?? '') ? 'MAX' : /start/.test(v ?? '') ? 'MIN' : 'STRETCH');

function layoutOf(computed: Map<string, string>): SpecLayout {
  const shown = computed.get('display');
  // A table row: its cells side by side, as tall as the row. A cell: its content placed by vertical-align and text-align.
  if (shown === 'table-row') return { direction: 'HORIZONTAL', primary: 'MIN', counter: 'STRETCH' };
  if (shown === 'table-cell') {
    const va = computed.get('vertical-align') ?? 'middle';
    const ta = computed.get('text-align') ?? 'start';
    return { direction: 'VERTICAL', primary: /middle/.test(va) ? 'CENTER' : /bottom/.test(va) ? 'MAX' : 'MIN', counter: /center/.test(ta) ? 'CENTER' : /(end|right)/.test(ta) ? 'MAX' : 'MIN' };
  }
  if (singleCellGrid(computed)) {
    const align = computed.get('align-items') ?? 'stretch';
    const justify = computed.get('justify-items') ?? 'stretch';
    const at = (v: string) => (/center/.test(v) ? 'CENTER' : /end/.test(v) ? 'MAX' : 'MIN');
    return { direction: 'VERTICAL', primary: at(align), counter: /stretch|normal/.test(justify) ? 'STRETCH' : at(justify) };
  }
  const dir = computed.get('flex-direction') ?? 'row';
  const display = computed.get('display') ?? 'block';
  const flex = /flex/.test(display);
  const justify = computed.get('justify-content') ?? 'normal';
  const align = computed.get('align-items') ?? 'normal';
  const primary = /center/.test(justify) ? 'CENTER' : /space-between/.test(justify) ? 'SPACE_BETWEEN' : /end/.test(justify) ? 'MAX' : 'MIN';
  const counter = /center/.test(align) ? 'CENTER' : /end/.test(align) ? 'MAX' : /stretch|normal/.test(align) && flex ? 'STRETCH' : 'MIN';
  return {
    direction: flex && !/column/.test(dir) ? 'HORIZONTAL' : 'VERTICAL',
    primary,
    counter: flex ? counter : 'STRETCH',
    ...(flex && /reverse/.test(dir) ? { reverse: true } : {}),
    ...(flex && !/column/.test(dir) && /^wrap/.test(computed.get('flex-wrap') ?? '') ? { wrap: true } : {}),
  };
}

/** `flex: 1` or `flex-grow` of 1 or more: the part takes the free space along its parent's auto layout direction. */
function grows(c: Map<string, string> | undefined): boolean {
  const flex = c?.get('flex')?.trim();
  const grow = c?.get('flex-grow') ?? (flex && /^\d/.test(flex) ? flex.split(/\s+/)[0] : flex === 'auto' ? '1' : undefined);
  return grow !== undefined && Number(grow) >= 1;
}

/**
 * A block of text beside a fixed item in a row (`min-width: 0`, an alert's body next to its icon): in code it shrinks
 * so its text wraps at the row's width. Figma wraps text only in a layer of known width: Fill container.
 */
function shrinksToFit(n: Node, c: Map<string, string> | undefined, parent: SpecLayout | undefined): boolean {
  return n.kind === 'frame' && parent?.direction === 'HORIZONTAL' && !parent.wrap && /^0(px)?$/.test(c?.get('min-width')?.trim() ?? '') && c?.get('flex-shrink')?.trim() !== '0' && !/^(none|0 0)/.test(c?.get('flex')?.trim() ?? '');
}

/** `overflow: hidden | clip`: the frame clips its content (a card's footer fill inside its rounded corners). */
const clips = (c: Map<string, string> | undefined) => /^(hidden|clip)\b/.test(c?.get('overflow') ?? c?.get('overflow-x') ?? '');

/** A block-level root (display block, flex, grid) or `width: 100%`: in code it fills its container's width. */
const INLINE_TAGS = new Set(['a', 'span', 'label', 'kbd', 'code', 'em', 'strong', 'b', 'i', 'small', 'abbr', 'button', 'input', 'textarea', 'select', 'img']);

function fillsContainer(c: Map<string, string> | undefined, tag = 'div'): boolean {
  if (!c) return false;
  if (c.get('width') === '100%') return true;
  const display = c.get('display') ?? (INLINE_TAGS.has(tag) ? 'inline' : 'block');
  return /^(block|flex|grid|flow-root)$/.test(display);
}

/**
 * Why a component cannot be drawn faithfully: thrown by the generator, recorded in the coverage list as the reason
 * ("opens a popup", "uses CSS grid"). The message is plain language for designers.
 */
export class UnsupportedComponentError extends Error {
  constructor(
    public component: string,
    public reason: string,
  ) {
    super(`${component}: ${reason}`);
  }
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
  /** Parts not shown in this variant: display none, opacity 0, scale(0), visually hidden. */
  hidden: Set<string>;
  /** Parts drawn over their parent (absolute, filling it). */
  cover: Set<string>;
  /** Absolute parts pinned to their parent's edges, with the offsets. */
  pins: Map<string, NonNullable<SpecPart['pin']>>;
  /** Inline SVG parts: their markup and the stroke token of each shape. */
  vectors: Map<string, SpecVector>;
  /** Parts as wide or as tall as their parent (`width: 100%`). */
  stretch: Map<string, { width?: boolean; height?: boolean }>;
  /** What the generator cannot draw faithfully, in plain language. */
  blockers: string[];
}

/**
 * An inline `<svg>` as one vector layer: the markup with each shape's CSS written as attributes (stroke width,
 * opacity, dashes, line caps; `pathLength` dashes converted to lengths, a rotation of the svg baked in), and the
 * stroke color token of each shape, bound in Figma. Fills other than none, and values that are not tokens or numbers,
 * cannot be drawn faithfully.
 */
function svgVector(node: Node, id: string, els: Map<string, CssElement>, rules: CssRule[], state: CssState, computed: Map<string, string>, tokens: Map<string, TokenInfo>): SpecVector | { blocker: string } {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const num = (raw: string | undefined, values: Map<string, string>): number | undefined => {
    if (raw === undefined) return undefined;
    const t = raw.trim();
    if (/^-?\d*\.?\d+$/.test(t)) return Number(t);
    // calc() of numbers and custom properties holding numbers (`calc(100 - var(--_pct))`).
    const sub = t.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]+))?\)/g, (_m, name: string, fb: string | undefined) => values.get(name) ?? fb ?? 'NaN');
    if (/^calc\(/.test(sub) && /^[\d\s.+\-*/()calc]+$/.test(sub)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const n = Number(new Function(`return (${sub.replace(/calc/g, '')});`)());
        return Number.isFinite(n) ? n : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  };
  const strokes: SpecValue[] = [];
  const shapes: string[] = [];
  for (const [i, shape] of (node.shapes ?? []).entries()) {
    const el = els.get(`${id}#shape-${i}`)!;
    const own = new Map([...declaredFor(rules, el, state)].map(([k, d]) => [k, d.value]));
    const c = computeValues(declaredFor(rules, el, state), computed);
    const attrs = { ...shape.svgAttrs };
    const fill = own.get('fill') ?? attrs.fill;
    if (fill && !/^(none|transparent)$/.test(fill)) return { blocker: 'draws SVG shapes with fills' };
    const strokeRaw = own.get('stroke') ?? attrs.stroke ?? node.svgAttrs?.stroke ?? 'currentcolor';
    const color = resolveValue(strokeRaw, c, tokens, 0, computed, false);
    if (!color || color.unmapped !== undefined || color.value === undefined) return { blocker: 'draws SVG shapes in colors that are not tokens' };
    strokes.push(color.value);
    const out: Record<string, string> = { ...attrs, fill: 'none', stroke: '#000000' };
    const width = num(own.get('stroke-width') ?? attrs['stroke-width'] ?? attrs.strokeWidth, c);
    if (width !== undefined) out['stroke-width'] = String(width);
    const opacity = num(own.get('opacity'), c);
    if (opacity !== undefined && opacity !== 1) out.opacity = String(opacity);
    const cap = own.get('stroke-linecap');
    if (cap) out['stroke-linecap'] = cap;
    // Dashes against pathLength (a progress ring, a spinner arc): lengths on the real circumference.
    const pathLength = num(attrs.pathLength, c);
    const r = num(attrs.r, c);
    const scale = pathLength && r !== undefined ? (2 * Math.PI * r) / pathLength : 1;
    const dash = own.get('stroke-dasharray');
    if (dash) {
      const parts = splitTop(dash, /\s|,/).map((x) => num(x, c));
      if (parts.some((x) => x === undefined)) return { blocker: 'draws SVG shapes with dashes it cannot read' };
      out['stroke-dasharray'] = parts.map((x) => +(x! * scale).toFixed(3)).join(' ');
    }
    const offset = own.get('stroke-dashoffset');
    if (offset) {
      const o = num(offset, c);
      if (o === undefined) return { blocker: 'draws SVG shapes with dashes it cannot read' };
      out['stroke-dashoffset'] = String(+(o * scale).toFixed(3));
    }
    delete out.pathLength;
    delete out.strokeWidth;
    delete out.key;
    shapes.push(`<${shape.tag} ${Object.entries(out).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`);
  }
  if (!shapes.length) return { blocker: 'draws SVG it cannot read' };
  const viewBox = node.svgAttrs?.viewBox ?? '0 0 24 24';
  const [, , w, h] = viewBox.split(/\s+/).map(Number);
  // A rotation of the svg (a ring that starts at the top): baked into the drawing around its center.
  const rot = /^rotate\((-?\d+(?:\.\d+)?)deg\)$/.exec(computed.get('transform')?.trim() ?? '');
  const body = rot ? `<g transform="rotate(${rot[1]} ${(w ?? 24) / 2} ${(h ?? 24) / 2})">${shapes.join('')}</g>` : shapes.join('');
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w ?? 24}" height="${h ?? 24}" viewBox="${viewBox}" fill="none">${body}</svg>`, strokes };
}

/** Base UI parts that only exist while a popup or overlay is open. */
const POPUP_PART = /\.(Portal|Popup|Positioner|Backdrop|Viewport)$/;

/** `translateX(<value>)` of a transform, or undefined. */
function translateX(transform: string | undefined): string | undefined {
  const m = /^translateX\(([\s\S]+)\)$/.exec(transform?.trim() ?? '');
  return m?.[1]?.trim();
}

/** An element hidden the way the visually hidden pattern does it: clipped to nothing, still read by screen readers. */
const visuallyHidden = (own: Map<string, string>) => /inset\(50%\)/.test(own.get('clip-path') ?? '') || /rect\(0/.test(own.get('clip') ?? '');

function evaluateVariant(
  reader: Reader,
  src: ComponentSource,
  rules: CssRule[],
  props: Record<string, Value>,
  state: CssState,
  tokens: Map<string, TokenInfo>,
  preview?: DocChild[],
  page?: Map<string, string>,
  view?: SpecView,
  examples?: Record<string, Value>,
): Evaluated | undefined {
  const built = build(reader, src, props, preview, view, rules, tokens, examples);
  if (!built) return undefined;
  const els = toCssTree(built);
  /** Grids drawn as rows (every child spans all columns): their tracks and column gap, for subgrid rows. */
  const gridRows = new Map<string, { tracks: string[]; gap: string | undefined }>();
  /** Items in a flexible track of a subgrid row (`minmax(0, 1fr)`): they take the free space. */
  const gridGrow = new Set<string>();
  const computedById = new Map<string, Map<string, string>>();
  const ownById = new Map<string, Map<string, string>>();
  const values: SpecVariant['values'] = {};
  const unmapped: SpecUnmapped[] = [];
  const layouts = new Map<string, SpecLayout>();
  const hidden = new Set<string>();
  const cover = new Set<string>();
  const pins = new Map<string, NonNullable<SpecPart['pin']>>();
  const vectors = new Map<string, SpecVector>();
  const stretch = new Map<string, { width?: boolean; height?: boolean }>();
  const blockers: string[] = [...built.blockers];
  for (const [id, node] of built.parts) {
    const el = els.get(id)!;
    const parentId = built.parents.get(id);
    // A decoration takes its host's ::before or ::after rules.
    const own = node.pseudo && el.parent ? declaredFor(rules, el.parent, state, node.pseudo) : declaredFor(rules, el, state);
    // An indicator that follows the selected item: offsets Base UI sets at run time are 0, sizes fill the item.
    if (node.follows) {
      for (const [k, far] of [['left', ''], ['top', ''], ['width', 'right'], ['height', 'bottom']] as const) {
        const d = own.get(k);
        if (!d || !runtimeVar(d.value, rules, tokens)) continue;
        if (far) {
          own.delete(k);
          own.set(far, { ...d, prop: far, value: '0' });
        } else own.set(k, { ...d, value: '0' });
      }
    }
    let computed = computeValues(own, parentId ? computedById.get(parentId) : page);
    for (const [k, v] of node.styleVars ?? []) computed.set(k, v);
    // Table elements lay out as the browser's own stylesheet says (a row of cells).
    if (!computed.has('display') && TABLE_DISPLAY[node.tag]) computed.set('display', TABLE_DISPLAY[node.tag]!);
    // A table cell with no width of its own takes an equal share of its row; an item in a flexible grid track grows.
    if ((computed.get('display') === 'table-cell' && resolveValue(computed.get('width'), computed, tokens) === undefined) || gridGrow.has(id)) computed.set('flex-grow', '1');
    const ownValues = new Map([...own].map(([k, d]) => [k, d.value]));
    if (node.placeholder && el.parent) {
      // The placeholder text: the field's values (inherited), then its ::placeholder rules.
      const ph = declaredFor(rules, el.parent, state, 'placeholder');
      computed = computeValues(ph, computed);
    }
    computedById.set(id, computed);
    ownById.set(id, ownValues);
    if (POPUP_PART.test(node.tag) && parentId !== undefined) blockers.push('opens a popup');

    const parentHidden = parentId !== undefined && hidden.has(parentId);
    const transform = ownValues.get('transform');
    if (
      parentHidden ||
      computed.get('display') === 'none' ||
      computed.get('visibility') === 'hidden' ||
      /^0(\.0+)?$/.test(ownValues.get('opacity')?.trim() ?? '') ||
      /scale\(0\)/.test(transform ?? '') ||
      visuallyHidden(ownValues) ||
      node.inactive ||
      (node.whenChecked && !/^(true|mixed)$/.test((node.checked === 'state' ? state.checked : node.checked) ?? ''))
    )
      hidden.add(id);
    const pv = partValues(node, computed, ownValues, tokens, parentId ? computedById.get(parentId) : page);
    values[id] = pv.values;
    if (node.svgAttrs && node.tag === 'svg') {
      const vec = svgVector(node, id, els, rules, state, computed, tokens);
      if ('blocker' in vec) blockers.push(vec.blocker);
      else vectors.set(id, vec);
    }
    // A single-line field centers its text vertically, as browsers draw it; a textarea starts at the top.
    if (node.kind === 'frame') layouts.set(id, node.inputLike && node.tag !== 'textarea' ? { direction: 'HORIZONTAL', primary: 'MIN', counter: 'CENTER' } : layoutOf(computed));
    // CSS grid drawn as auto layout: a grid whose children each span every column stacks them (rows); a row that
    // shares its parent's columns (`subgrid`) lines its items up in a row, edge tracks of 0 becoming the gap at its ends.
    let gridDrawn = false;
    if (node.kind === 'frame' && /grid/.test(computed.get('display') ?? '') && !singleCellGrid(computed)) {
      const kids = [...built.parts].filter(([cid]) => built.parents.get(cid) === id);
      const tracks = computed.get('grid-template-columns')?.trim();
      const parentGrid = parentId ? gridRows.get(parentId) : undefined;
      if (tracks === 'subgrid' && parentGrid) {
        gridDrawn = true;
        layouts.set(id, { direction: 'HORIZONTAL', primary: 'MIN', counter: gridCounter(computed.get('align-items')) });
        const gap = parentGrid.gap === undefined ? undefined : resolveValue(parentGrid.gap, computedById.get(parentId!) ?? new Map(), tokens);
        const g = gap && gap.unmapped === undefined && gap.value !== null ? gap.value : undefined;
        if (g !== undefined) {
          pv.values.itemSpacing = g;
          if (/^0(px)?$/.test(parentGrid.tracks[0] ?? '')) pv.values.paddingLeft = g;
          if (/^0(px)?$/.test(parentGrid.tracks[parentGrid.tracks.length - 1] ?? '')) pv.values.paddingRight = g;
        }
        for (const [cid] of kids) {
          const start = Number(/^\s*(\d+)/.exec(declaredFor(rules, els.get(cid)!, state).get('grid-column-start')?.value ?? declaredFor(rules, els.get(cid)!, state).get('grid-column')?.value ?? '')?.[1]);
          if (start && /fr\)?$/.test(parentGrid.tracks[start - 1] ?? '')) gridGrow.add(cid);
        }
        unmapped.push({ part: id, property: 'grid-template-columns', value: 'subgrid', reason: 'columns line up across rows in code; in Figma each row sizes its own' });
      } else if (tracks && tracks !== 'none' && tracks !== 'subgrid' && kids.length && kids.every(([cid]) => /^1\s*\/\s*-1$/.test(declaredFor(rules, els.get(cid)!, state).get('grid-column')?.value.trim() ?? ''))) {
        gridDrawn = true;
        gridRows.set(id, { tracks: splitTop(tracks, /\s/).filter(Boolean), gap: computed.get('column-gap') });
        layouts.set(id, { direction: 'VERTICAL', primary: 'MIN', counter: 'STRETCH' });
      }
    }
    // A hidden part keeps its values (shown again, it looks right), but what it cannot draw does not matter here.
    if (hidden.has(id)) continue;
    // Decorations drawn by ::before or ::after that are not a layer (text content, or no paint we can draw).
    for (const pseudo of ['before', 'after'] as const) {
      if (node.children.some((c) => c.pseudo === pseudo)) continue;
      const d = declaredFor(rules, el, state, pseudo);
      const paints = [...PSEUDO_PAINTS, 'box-shadow'].some((k) => d.has(k) && !/^(0|none|transparent)$/.test(d.get(k)!.value));
      if (d.has('content') && paints) blockers.push('draws with ::before or ::after');
    }
    // A visible frame with nothing in it and nothing to paint: content the code puts there was not read.
    if (node.kind === 'frame' && !node.children.length && !node.inputLike && !node.media && !node.svgAttrs && Object.values(pv.values).every((x) => x === 0 || x === null || x === undefined))
      blockers.push('has parts whose content the generator cannot read yet');
    if (/grid/.test(computed.get('display') ?? '') && !singleCellGrid(computed) && !gridDrawn) blockers.push('uses CSS grid');
    // A value indicator with no height of its own (a slider's range): as tall as its track, like Base UI draws it.
    if (node.fraction !== undefined && ownValues.get('height') === undefined) stretch.set(id, { ...stretch.get(id), height: true });
    // A swatch of the token's own color: not a token, so not bound; set per instance.
    if (node.inlineFill) unmapped.push({ part: id, property: 'background-color', value: node.inlineFill, reason: "the token's own color, from the content: not bound, set it on each instance" });
    // Over its parent: absolute and filling it, or as wide and tall as a parent of fixed size (an avatar photo).
    const position = ownValues.get('position');
    const full = ownValues.get('width') === '100%' && ownValues.get('height') === '100%';
    const pVals = parentId ? values[parentId] : undefined;
    const inset = ['top', 'right', 'bottom', 'left'].every((k) => /^0(px)?$/.test(ownValues.get(k) ?? ''));
    if (parentId && ((position === 'absolute' && (inset || full)) || (position !== 'absolute' && full && pVals?.width !== undefined && pVals?.height !== undefined))) {
      cover.add(id);
      delete pv.values.width;
      delete pv.values.height;
      pv.unmapped = pv.unmapped.filter((u) => u.property !== 'width' && u.property !== 'height');
    } else if (parentId && position !== 'absolute' && (ownValues.get('width') === '100%' || ownValues.get('height') === '100%')) {
      // As wide or as tall as its parent (a progress bar's fill): Fill container on that axis.
      stretch.set(id, { ...(ownValues.get('width') === '100%' ? { width: true } : {}), ...(ownValues.get('height') === '100%' ? { height: true } : {}) });
      pv.unmapped = pv.unmapped.filter((u) => !((u.property === 'width' || u.property === 'height') && u.value === '100%'));
      for (const k of ['width', 'height'] as const) if (ownValues.get(k) === '100%') delete pv.values[k];
    } else if (parentId && position === 'absolute') {
      // Pinned to its parent's edges by tokens (a dialog's close button at the top right): an absolute layer in Figma.
      const pin: NonNullable<SpecPart['pin']> = {};
      let ok = true;
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const raw = ownValues.get(side);
        if (raw === undefined || raw === 'auto') continue;
        const r = resolveValue(raw, computed, tokens);
        if (!r || r.unmapped !== undefined || r.value === null || r.value === undefined) ok = false;
        else pin[side] = r.value;
      }
      if (ok && Object.keys(pin).length) pins.set(id, pin);
      else blockers.push('places layers over each other');
    } else if (parentId && position === 'fixed') blockers.push('places layers over each other');
    for (const u of pv.unmapped) unmapped.push({ part: id, ...u });
    // Transforms: scale(0) hides (above); none and scale(1) draw nothing; translateX moves a part inside its row.
    if (transform && !/^(none|scale\(1\))$/.test(transform.trim()) && !translateX(transform) && /^(translate|rotate|scale)/.test(transform.trim()) && !/^0(\.0+)?$/.test(ownValues.get('opacity') ?? '1')) {
      unmapped.push({ part: id, property: 'transform', value: transform, reason: 'transforms are not drawn' });
    }
  }
  // translateX of the only child of a fixed-width row (a switch thumb): the offset becomes the row's padding, at the
  // start, or at the end when it is "row width - own width - inset". Anything else cannot be drawn faithfully.
  for (const [id] of built.parts) {
    const tx = translateX(ownById.get(id)?.get('transform'));
    if (!tx || hidden.has(id)) continue;
    const parentId = built.parents.get(id);
    const siblings = [...built.parts].filter(([cid, n]) => built.parents.get(cid) === parentId && !hidden.has(cid) && !n.visible);
    const parentLayout = parentId ? layouts.get(parentId) : undefined;
    const r = resolveValue(tx, computedById.get(id)!, tokens);
    // translateX(0), or a gesture offset that is 0 at rest (`var(--swipe-x, 0)`): nothing moves.
    if (r?.value === 0) continue;
    const pv = parentId ? values[parentId] : undefined;
    const own = values[id] ?? {};
    if (!parentId || !pv || siblings.length !== 1 || parentLayout?.direction !== 'HORIZONTAL' || !r || r.unmapped !== undefined || r.value === null || r.value === undefined) {
      blockers.push('moves a part with a transform');
      continue;
    }
    const v = r.value;
    const end = typeof v === 'string' && v.startsWith('calc(') ? new RegExp(`^calc\\(${escapeRe(String(pv.width))} - ${escapeRe(String(own.width))} - (\\S+)\\)$`).exec(v) : null;
    if (end) {
      pv.paddingRight = end[1]!;
      layouts.set(parentId, { ...parentLayout, primary: 'MAX' });
    } else if (typeof v === 'number' || (typeof v === 'string' && !v.startsWith('calc('))) {
      pv.paddingLeft = v;
      layouts.set(parentId, { ...parentLayout, primary: 'MIN' });
    } else blockers.push('moves a part with a transform');
  }
  const classes = [...built.parts].map(([id, n]) => `${id}:${n.classes.join(',')}:${n.visible?.prop ?? ''}`).join(';');
  return { built, values, unmapped, layouts, classes, computed: computedById, hidden, cover, pins, vectors, stretch, blockers };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function product(axes: { name: string; values: string[] }[]): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];
  for (const a of axes) out = out.flatMap((p) => a.values.map((v) => ({ ...p, [a.name]: v })));
  return out;
}


/** What a variant draws, to compare two variants. */
const drawn = (e: Evaluated) => JSON.stringify([e.values, [...e.hidden].sort(), [...e.layouts], [...e.vectors]]);

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
  if (!root || root.kind !== 'frame' || children.length !== 1 || !w || w.kind !== 'frame' || w.visible || w.clip || w.cover) return;
  for (const v of variants) {
    const r = v.values[root.id] ?? {};
    const x = v.values[w.id] ?? {};
    if (BOX_FIELDS.some((f) => !empty(r[f])) || PAINT_FIELDS.some((f) => !empty(x[f])) || x.opacity !== undefined) return;
    if (v.hidden?.includes(w.id) || v.layout?.[w.id] || v.layout?.[root.id]) return;
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

/**
 * A text field's box that draws nothing of its own in any variant (an input inside a styled wrapper, like Input): the
 * placeholder text takes its place, so Figma gets the text directly in the wrapper.
 */
function mergeFieldBoxes(parts: SpecPart[], variants: SpecVariant[], unmapped: SpecUnmapped[], fields: Set<string>): void {
  for (const box of parts.filter((p) => fields.has(p.id))) {
    const kids = parts.filter((p) => p.parent === box.id);
    const text = kids[0];
    if (kids.length !== 1 || text?.kind !== 'text' || !box.parent || box.visible || box.cover) continue;
    const drawsNothing = variants.every((v) => {
      const x = v.values[box.id] ?? {};
      return BOX_FIELDS.every((f) => empty(x[f])) && PAINT_FIELDS.every((f) => empty(x[f])) && x.opacity === undefined && !v.hidden?.includes(box.id) && !v.layout?.[box.id];
    });
    if (!drawsNothing) continue;
    text.parent = box.parent;
    if (box.source) text.source = box.source;
    for (const v of variants) delete v.values[box.id];
    for (const u of unmapped) if (u.part === box.id) u.part = text.id;
    parts.splice(parts.indexOf(box), 1);
  }
}

/** Reasons, most telling first: what a designer would recognize as the reason the component is not drawn. */
const REASON_ORDER = ['opens a popup', 'draws SVG shapes', 'uses CSS grid', 'draws with ::before or ::after', 'moves a part with a transform', 'places layers over each other', 'shows content computed while the page runs'];

/** The one reason recorded for a component the generator cannot draw. */
function mainReason(reasons: string[]): string {
  const rank = (r: string) => {
    const i = REASON_ORDER.indexOf(r);
    return i < 0 ? REASON_ORDER.length : i;
  };
  return [...new Set(reasons)].sort((a, b) => rank(a) - rank(b))[0]!;
}

/** The checked state an axis value stands for. */
const CHECKED: Record<string, CssState['checked']> = { false: 'false', true: 'true', mixed: 'mixed' };

/** The spec of one component, or an error message when it cannot be derived. */
export function generateComponentSpec(name: string, opts: SpecGeneratorOptions, view?: SpecView, setName = name, fixed: Record<string, string> = {}): ComponentSpec {
  const reader = new Reader(opts);
  const src = reader.load(name);
  if (!src) throw new Error(`${name}: ${opts.componentsDir}/${name}/${name}.tsx was not found.`);
  if (!src.fn) throw new UnsupportedComponentError(name, 'is shown from a hook or a provider, not placed as a component');

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
  // Docs preview: content for `{children}` (a group's options) and the components it draws.
  const docs = readDocs(src.folder, opts);
  // The docs preview, else the first example of the component sandbox that gives it content (a menu's items).
  const fromDocs = previewElement(docs?.preview, name);
  const previewEl = fromDocs ?? storyElement(readStories(src.folder, opts), name);
  const previewKids = previewEl?.children?.some((c) => typeof c !== 'string') ? previewEl.children : undefined;
  for (const c of docElements(previewKids)) {
    if (typeof c.c !== 'string' || nestedNames.has(c.c) || !reader.exists(c.c)) continue;
    nestedNames.add(c.c);
    const other = reader.load(c.c);
    addModules(other);
    if (other) findNested(other, 1);
  }
  // Base styles of the nested components first, then the component's own (they override, as with CSS module order).
  const ownDir = `${opts.componentsDir}/${src.folder}/`;
  const ordered = [...modules].sort(([a], [b]) => Number(a.startsWith(ownDir)) - Number(b.startsWith(ownDir)));
  const rules: CssRule[] = [];
  const cssErrors: string[] = [];
  // The page's base stylesheet first (tag rules like `:where(kbd)`), and what the page root gives every component to
  // inherit (`:where(html)`: text color, font family, size and line height).
  let page: Map<string, string> | undefined;
  const baseText = opts.baseCss ? opts.read(opts.baseCss) : undefined;
  if (baseText !== undefined) {
    const r = parseCssModule(opts.baseCss!, baseText, 0);
    rules.push(...r.rules);
    const html: CssElement = { tag: 'html', classes: new Set(), children: [], present: true, isRoot: false, inputLike: false };
    page = computeValues(declaredFor(r.rules, html, DEFAULT_STATE), undefined);
  }
  for (const [path, text] of ordered) {
    const r = parseCssModule(path, text, rules.length);
    rules.push(...r.rules);
    cssErrors.push(...r.errors);
  }
  // Required text props the docs preview fills (an avatar's name, for its initials).
  const baseProps: Record<string, Value> = {};
  // Lists the preview gives (a segmented control's items), and the option it selects (`defaultValue`).
  for (const p of src.props.values()) {
    const v = previewEl?.p?.[p.name];
    if (v === undefined || v === null) continue;
    if (p.kind === 'string' && typeof v === 'string' && (!p.optional || p.name === 'defaultValue')) baseProps[p.name] = v;
    if (p.kind === 'other' && (typeof v === 'object' || typeof v === 'number' || (typeof v === 'string' && p.name === 'defaultValue'))) baseProps[p.name] = jsonValue(v);
  }

  // Axes: string-literal union props that change the rendered classes.
  // Optional texts the example gives (a token name next to its value): drawn with that text, shown by default.
  const examples: Record<string, Value> = {};
  for (const p of src.props.values()) {
    const v = previewEl?.p?.[p.name];
    if (p.kind === 'string' && p.optional && typeof v === 'string' && baseProps[p.name] === undefined) examples[p.name] = v;
  }
  const evalAt = (props: Record<string, Value>, state: CssState) =>
    evaluateVariant(reader, src, rules, { ...baseProps, ...props, ...fixed }, state, opts.tokens, previewKids, page, view, Object.keys(examples).length ? examples : undefined);
  const base = evalAt({}, DEFAULT_STATE);
  if (!base) throw new UnsupportedComponentError(name, 'renders in a way the generator cannot read yet');
  const unmappedProps: SpecUnmapped[] = [];
  const axes: SpecAxis[] = [];
  const defaults = new Map<string, Value>();
  {
    const scope: Scope = { src, vars: new Map(), locals: new Map(), toggles: new Map(), main: true };
    bindProps(src.fn, scope, {});
    for (const [prop] of src.props) defaults.set(prop, scope.vars.get(prop));
  }
  for (const p of src.props.values()) {
    if (p.kind !== 'union' || !p.values || fixed[p.name] !== undefined) continue;
    const changes = p.values.some((v) => evalAt({ [p.name]: v }, DEFAULT_STATE)?.classes !== base.classes);
    if (!changes) {
      unmappedProps.push({ part: 'root', property: `prop ${p.name}`, value: p.values.join(' | '), reason: 'does not change the styles' });
      continue;
    }
    const def = defaults.get(p.name);
    axes.push({ name: sentenceCase(p.name), prop: p.name, values: [...p.values], default: typeof def === 'string' && p.values.includes(def) ? def : p.values[0]! });
  }

  // Checked: Base UI parts of the component itself (a checkbox box, a switch thumb) styled by data-checked. Not for a
  // popup drawn open: its options show the preview's selection.
  const checkable = ['checked', 'defaultChecked', 'indeterminate'].some((p) => src.props.has(p)) || [...src.baseUiModules].some((m) => /^(checkbox|switch|radio|toggle|menu)/.test(m));
  if (view !== 'popup' && checkable) {
    const on = evalAt({}, { ...DEFAULT_STATE, checked: 'true' });
    const off = evalAt({}, { ...DEFAULT_STATE, checked: 'false' });
    if (on && off && drawn(on) !== drawn(off)) {
      const mixed = src.props.has('indeterminate') ? evalAt({}, { ...DEFAULT_STATE, checked: 'mixed' }) : undefined;
      axes.push({ name: 'Checked', values: mixed && drawn(mixed) !== drawn(on) ? ['false', 'true', 'mixed'] : ['false', 'true'], default: 'false' });
    }
  }

  const combos = product(axes);
  const propsFor = (combo: Record<string, string>) => Object.fromEntries(axes.filter((a) => a.prop).map((a) => [a.prop!, combo[a.name]!]));
  const stateFor = (combo: Record<string, string>, s: CssState): CssState => (combo.Checked ? { ...s, checked: CHECKED[combo.Checked] } : s);
  const canDisable = src.native === 'button' || src.native === 'input' || src.native === 'textarea' || src.props.has('disabled');
  // A popup drawn open is not hovered or pressed as a whole: its own states are not drawn.
  const states = view === 'popup' ? STATES.slice(0, 1) : STATES.filter((s) => s.name !== 'Disabled' || canDisable);
  const byState = new Map<string, Map<string, Evaluated>>();
  for (const s of states) {
    const m = new Map<string, Evaluated>();
    for (const combo of combos) {
      const ev = evalAt(propsFor(combo), stateFor(combo, s.state));
      if (ev) m.set(JSON.stringify(combo), ev);
    }
    byState.set(s.name, m);
  }
  // A state is drawn when it looks different from Default (and Pressed from Hover) in at least one variant.
  const differs = (s: string, from: string) =>
    combos.some((c) => {
      const a = byState.get(s)!.get(JSON.stringify(c));
      const b = byState.get(from)?.get(JSON.stringify(c));
      return a && b && drawn(a) !== drawn(b);
    });
  const stateNames = states
    .map((s) => s.name)
    .filter((s) => s === 'Default' || (differs(s, 'Default') && (s !== 'Pressed' || differs(s, 'Hover'))));
  if (stateNames.length > 1) axes.push({ name: 'State', values: stateNames, default: 'Default' });

  const blockers = new Set<string>();
  const evaluated: { props: Record<string, string>; ev: Evaluated }[] = [];
  for (const combo of combos) {
    for (const s of stateNames.length > 1 ? stateNames : ['Default']) {
      const ev = byState.get(s)!.get(JSON.stringify(combo));
      if (!ev) continue;
      evaluated.push({ props: stateNames.length > 1 ? { ...combo, State: s } : { ...combo }, ev });
      for (const b of ev.blockers) blockers.add(b);
    }
  }
  // Every variant must have the parts of the default one: a set's variants share their layers.
  // Variants share their layers: a part some variants do not render (a value shown only at the large size) is a layer
  // of the set, hidden in those variants. The parts must keep one parent and one order across variants.
  const order: string[] = [...base.built.parts.keys()];
  const owner = new Map<string, Evaluated>(order.map((id) => [id, base]));
  for (const { ev } of evaluated) {
    let prev: string | undefined;
    for (const id of ev.built.parts.keys()) {
      const known = owner.get(id);
      if (known && known.built.parents.get(id) !== ev.built.parents.get(id)) blockers.add('changes its layers between variants');
      if (!known) {
        order.splice(prev === undefined ? 0 : order.indexOf(prev) + 1, 0, id);
        owner.set(id, ev);
      }
      prev = id;
    }
  }
  for (const { ev } of evaluated) for (const id of order) if (!ev.built.parts.has(id)) ev.hidden.add(id);
  if (blockers.size) throw new UnsupportedComponentError(name, mainReason([...blockers]));

  // Axes that change nothing Figma draws (a Spacing prop that only sets margins): left out, reported.
  for (const axis of [...axes]) {
    if (!axis.prop) continue;
    const key = (p: Record<string, string>) => JSON.stringify(Object.entries(p).filter(([k]) => k !== axis.name));
    const groups = new Map<string, string[]>();
    for (const e of evaluated) groups.set(key(e.props), [...(groups.get(key(e.props)) ?? []), drawn(e.ev)]);
    if ([...groups.values()].some((g) => new Set(g).size > 1)) continue;
    axes.splice(axes.indexOf(axis), 1);
    unmappedProps.push({ part: 'root', property: `prop ${axis.prop}`, value: axis.values.join(' | '), reason: 'changes nothing the set draws (margins, or content it does not show), not drawn' });
    for (let i = evaluated.length - 1; i >= 0; i--) {
      const e = evaluated[i]!;
      if (e.props[axis.name] !== axis.default) {
        evaluated.splice(i, 1);
        continue;
      }
      delete e.props[axis.name];
    }
  }

  const variants: SpecVariant[] = [];
  const unmapped: SpecUnmapped[] = [];
  // Parts no variant shows (a visually hidden legend, a glyph for a state the set does not draw): left out.
  const neverShown = new Set(order.filter((id) => evaluated.every((e) => e.ev.hidden.has(id))));
  for (const e of evaluated) {
    const ev = e.ev;
    const values = Object.fromEntries(Object.entries(ev.values).filter(([id]) => !neverShown.has(id)));
    const parentOf = (id: string) => owner.get(id)?.built.parents.get(id) ?? '';
    const hidden = order.filter((id) => ev.hidden.has(id) && !neverShown.has(id) && !neverShown.has(parentOf(id)));
    const layout: Record<string, SpecLayout> = {};
    for (const [id, l] of ev.layouts) if (JSON.stringify(l) !== JSON.stringify(owner.get(id)?.layouts.get(id))) layout[id] = l;
    // Icons the code picks per variant (an alert's tone icon): the icon instance each variant shows.
    const icons: Record<string, string> = {};
    for (const [id, n] of ev.built.parts) if (n.kind === 'icon' && n.icon && !neverShown.has(id)) icons[id] = iconComponentName(n.icon);
    const vectors = Object.fromEntries([...ev.vectors].filter(([id]) => !neverShown.has(id)));
    // Absolute layers placed differently in this variant (an indicator under a vertical tab, or filling a contained one).
    const pinOf = (x: Evaluated, id: string) => (x.cover.has(id) ? { top: 0, right: 0, bottom: 0, left: 0 } : x.pins.get(id));
    const pins: NonNullable<SpecVariant['pins']> = {};
    for (const id of order) {
      const own = pinOf(ev, id);
      const base = owner.get(id) && pinOf(owner.get(id)!, id);
      if (own && base && JSON.stringify(own) !== JSON.stringify(base) && !neverShown.has(id)) pins[id] = own;
    }
    variants.push({
      props: e.props,
      values,
      ...(Object.keys(icons).length ? { slots: icons } : {}),
      ...(hidden.length ? { hidden } : {}),
      ...(Object.keys(layout).length ? { layout } : {}),
      ...(Object.keys(vectors).length ? { vectors } : {}),
      ...(Object.keys(pins).length ? { pins } : {}),
    });
    unmapped.push(...ev.unmapped.filter((u) => !neverShown.has(u.part)));
  }
  if (variants.length > MAX_VARIANTS) throw new UnsupportedComponentError(name, `has ${variants.length} variants, more than ${MAX_VARIANTS}`);

  // Parts, layout and properties come from the default variant.
  const parts: SpecPart[] = [];
  const properties: SpecProperty[] = [];
  const dropped = new Set<string>();
  for (const id of order) {
    const at = owner.get(id)!;
    const n = at.built.parts.get(id)!;
    const parent = at.built.parents.get(id);
    if (neverShown.has(id) || (parent && dropped.has(parent))) {
      dropped.add(id);
      continue;
    }
    const cls = n.classes[0]?.split('|')[1];
    const part: SpecPart = {
      id,
      name: !parent ? setName : n.kind === 'text' ? (n.text?.property ?? (cls ? sentenceCase(cls) : 'Text')) : n.visible ? n.visible.property.replace(/^Show /, '').replace(/^./, (c) => c.toUpperCase()) : (n.name ?? (n.kind === 'icon' ? 'Icon' : (cls ?? n.tag))),
      kind: n.svgAttrs && n.tag === 'svg' ? 'vector' : n.kind,
      ...(parent ? { parent } : {}),
      ...(n.classes.length ? { source: n.classes.map((c) => c.split('|').map((x, i) => (i === 0 ? posix.basename(x) : `.${x}`)).join(' ')).join(', ') } : {}),
      ...(n.kind === 'frame' ? { layout: at.layouts.get(id) ?? layoutOf(at.computed.get(id) ?? new Map()) } : {}),
      ...(n.kind === 'frame' && clips(at.computed.get(id)) ? { clip: true } : {}),
      ...(!parent && fillsContainer(at.computed.get(id), n.tag) ? { fill: true } : {}),
      ...(n.text ? { text: n.text.property } : {}),
      ...(n.chars !== undefined ? { characters: n.chars } : {}),
      ...(n.visible ? { visible: n.visible.property } : {}),
      ...(at.cover.has(id) ? { cover: true } : {}),
      ...(at.pins.has(id) ? { pin: at.pins.get(id) } : {}),
      ...(at.stretch.has(id) ? { stretch: at.stretch.get(id) } : {}),
      ...(n.fraction !== undefined ? { fraction: n.fraction } : {}),
      ...(n.at !== undefined ? { at: n.at } : {}),
      ...(parent && (grows(at.computed.get(id)) || shrinksToFit(n, at.computed.get(id), at.layouts.get(parent))) ? { grow: true } : {}),
      ...(n.kind === 'icon' && n.icon ? { icon: iconComponentName(n.icon) } : {}),
    };
    parts.push(part);
    if (n.text && !properties.some((p) => p.name === n.text!.property)) properties.push({ name: n.text.property, type: 'TEXT', default: n.text.default, ...(n.text.prop ? { prop: n.text.prop } : {}) });
  }
  for (const id of order) {
    const n = owner.get(id)!.built.parts.get(id)!;
    if (!dropped.has(id) && n.visible && !properties.some((p) => p.name === n.visible!.property)) properties.push({ name: n.visible.property, type: 'BOOLEAN', default: !!n.visible.on, prop: n.visible.prop });
  }

  // Props the spec does not draw (loading, slots...), so readers know what is missing.
  const used = new Set([...axes.map((a) => a.prop), ...properties.map((p) => p.prop), 'disabled', 'className', 'children', 'render']);
  if (axes.some((a) => a.name === 'Checked')) for (const p of ['checked', 'defaultChecked', 'indeterminate']) used.add(p);
  for (const p of src.props.values()) {
    if (used.has(p.name) || p.kind === 'function' || p.kind === 'string' || p.kind === 'other' || p.kind === 'union') continue;
    unmappedProps.push({ part: 'root', property: `prop ${p.name}`, value: p.kind, reason: p.kind === 'node' ? 'slot content is not drawn' : p.kind === 'icon' ? 'icon prop with no icon part' : 'not drawn in this version' });
  }
  for (const e of cssErrors) unmappedProps.push({ part: 'root', property: 'css', value: e, reason: 'selector not understood' });

  mergeFieldBoxes(parts, variants, unmapped, new Set([...base.built.parts].filter(([, n]) => n.inputLike).map(([id]) => id)));
  flattenWrapper(parts, variants, unmapped);
  const compoundParts = new Set([...base.built.parts].filter(([, n]) => n.name).map(([id]) => id));
  const swapped = addSwaps(name, src, parts, properties, axes, variants, opts, compoundParts);
  // Images: the media slot, swappable for a real picture.
  for (const part of parts) {
    if (!base.built.parts.get(part.id)?.media || part.swap) continue;
    part.swap = { property: part.name, default: MEDIA_SLOT.name, options: [MEDIA_SLOT.name] };
    for (const v of variants) (v.slots ??= {})[part.id] = MEDIA_SLOT.name;
  }
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
  // The code example the content comes from, for the fidelity check: the props the set used and the example's children.
  // Example texts count only where they are drawn (behind a BOOLEAN shown by default), not where code ignores them.
  const shownExamples = Object.fromEntries(Object.entries(examples).filter(([k]) => properties.some((p) => p.type === 'BOOLEAN' && p.prop === k && p.default === true)));
  const exampleProps = Object.fromEntries(Object.entries({ ...baseProps, ...shownExamples }).filter(([, v]) => isData(v)));
  const example: SpecExample | undefined =
    (previewKids && !base.built.root.fromExports) || Object.keys(exampleProps).length
      ? { c: src.name, ...(Object.keys(exampleProps).length ? { p: exampleProps } : {}), ...(previewKids && !base.built.root.fromExports ? { children: previewKids as SpecExample['children'] } : {}) }
      : undefined;
  const component = {
    ...(src.folder !== setName ? { component: src.folder } : {}),
    ...(Object.keys(fixed).length ? { fixed: { ...fixed } } : {}),
    ...(view ? { view } : {}),
    ...(example ? { example } : {}),
  };
  const spec: Omit<ComponentSpec, 'hash'> = { name: setName, ...component, source, axes, properties, parts, variants, unmapped: dedup };
  return { name: setName, ...component, hash: hashSpec(spec), source, axes, properties, parts, variants, unmapped: dedup };
}

/** Whether a spec draws anything: a fill, a border, an icon or a text of its own. Layout helpers draw nothing. */
export function specDrawsSomething(spec: ComponentSpec): boolean {
  const kinds = new Map(spec.parts.map((p) => [p.id, p]));
  for (const v of spec.variants)
    for (const [id, vals] of Object.entries(v.values)) {
      const part = kinds.get(id);
      if (part?.kind === 'icon' || part?.kind === 'vector') return true;
      if (part?.kind === 'text' && part.text !== 'Label') return true;
      // The children text of a link (its own color or an underline), not the page text a layout helper passes through.
      if (part?.kind === 'text' && (vals.textDecoration !== undefined || (typeof vals.textFill === 'string' && vals.textFill !== 'color.text.default'))) return true;
      if ((vals.fill !== undefined && vals.fill !== null) || (vals.stroke !== undefined && vals.stroke !== null)) return true;
    }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Swappable parts: icons and content slots

/** The design system component that draws an icon (`<Icon icon={...} />`): its parts are icon instances. */
const ICON_COMPONENT = 'Icon';

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
function defaultIcon(name: string, prop: string, opts: SpecGeneratorOptions, folder = name): string {
  const docs = readDocs(folder, opts);
  for (const el of docElements(docs?.preview)) {
    const v = el.c === name ? el.p?.[prop] : undefined;
    if (typeof v === 'string' && /^[A-Z]\w*$/.test(v)) return v;
  }
  return allStatesIcon(readStories(folder, opts), name, prop) ?? FALLBACK_ICON[name] ?? DEFAULT_FALLBACK_ICON;
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
function addSwaps(name: string, src: ComponentSource, parts: SpecPart[], properties: SpecProperty[], axes: SpecAxis[], variants: SpecVariant[], opts: SpecGeneratorOptions, compound: Set<string>): Set<string> {
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
      const icon = iconComponentName(defaultIcon(name, prop, opts, src.folder));
      part.swap = { property: sentenceCase(prop), default: icon, prop };
      setSlot(part.id, () => icon);
      props.add(prop);
      continue;
    }
    const parent = parts.find((p) => p.id === part.parent);
    if (part.kind !== 'text' || !part.text || !parent?.parent || parent.kind !== 'frame' || !compound.has(parent.id)) continue;
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
    for (const p of c.parts) {
      if (p.swap && !p.swap.options) names.push(p.swap.default.replace(/^Icon\//, ''));
      if (p.icon) names.push(p.icon.replace(/^Icon\//, ''));
    }
    for (const v of c.variants) for (const x of Object.values(v.slots ?? {})) if (x.startsWith('Icon/')) names.push(x.slice(5));
    names.push(...referencedIcons(c.component ?? c.name, opts));
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

function specsFile(components: ComponentSpec[], opts: SpecGeneratorOptions, coverage?: SpecCoverage[]): ComponentSpecsFile {
  const slots = generateSlots(components);
  return {
    version: COMPONENT_SPECS_VERSION,
    generated: 'Generated by `npm run specs` from the component TSX and CSS modules. Do not edit: the test suite fails when it is out of date.',
    components,
    icons: generateIcons(components, opts, slots),
    iconStyle: ICON_STYLE,
    slots,
    ...(coverage ? { coverage } : {}),
  };
}

/** Specs of the named components (sets), in that order. Throws when one cannot be generated. */
export function generateComponentSpecs(names: string[], opts: SpecGeneratorOptions): ComponentSpecsFile {
  return specsFile(
    names.map((n) => generateComponentSpec(n, opts)),
    opts,
  );
}

/** One set per value of the union prop whose values change a component's layers, when each value draws faithfully. */
function splitByLayers(folder: string, opts: SpecGeneratorOptions): ComponentSpec[] {
  const src = new Reader(opts).load(folder);
  for (const p of src?.props.values() ?? []) {
    if (p.kind !== 'union' || !p.values) continue;
    const out: ComponentSpec[] = [];
    for (const v of p.values) {
      try {
        const spec = generateComponentSpec(folder, opts, undefined, `${folder}/${sentenceCase(v)}`, { [p.name]: v });
        if (specDrawsSomething(spec)) out.push(spec);
      } catch {
        out.length = 0;
        break;
      }
    }
    if (out.length === p.values.length) return out;
  }
  return [];
}

/** CSS that paints something (a color, a background, a border, a shadow): a component without any is a layout helper. */
const PAINTS = /(^|[;{\s])(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|box-shadow|fill|stroke)\s*:(?!\s*(0[;\s}]|none|transparent))/m;

/**
 * Every component folder, generated when the generator can draw it faithfully, else recorded with the reason it
 * cannot (unsupported) or as a layout helper with no visual of its own. Support is decided here, from what the generator
 * can read: no list to maintain. A folder's other exports (Radio in RadioGroup) get their own set when they draw
 * something; exports drawn inside the main set (CardHeader) do not.
 */
export function generateAllComponentSpecs(folders: string[], opts: SpecGeneratorOptions): ComponentSpecsFile {
  const withList = { ...opts, components: opts.components ?? folders };
  const reader = new Reader(withList);
  const components: ComponentSpec[] = [];
  const coverage: SpecCoverage[] = [];
  const cssOf = (folder: string) => [...(reader.load(folder)?.styles.values() ?? [])].map((path) => (opts.read(path) ?? '').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  const paints = (folder: string) => PAINTS.test(cssOf(folder));
  for (const folder of [...folders].sort()) {
    const reasons: string[] = [];
    const attempt = (name: string, view?: SpecView, setName?: string): ComponentSpec | undefined => {
      try {
        const spec = generateComponentSpec(name, withList, view, setName);
        return specDrawsSomething(spec) ? spec : undefined;
      } catch (err) {
        reasons.push(err instanceof UnsupportedComponentError ? err.reason : 'renders in a way the generator cannot read yet');
        return undefined;
      }
    };
    const exports = [folder, ...[...(reader.load(folder)?.exported.keys() ?? [])].filter((n) => n !== folder)];
    const sets: ComponentSpec[] = [];
    let main = attempt(folder);
    // Variants with different layers (a linear and a circular progress): one set per value of the prop that changes
    // them ("Progress/Linear", "Progress/Circular").
    if (!main && reasons.includes('changes its layers between variants')) {
      const split = splitByLayers(folder, withList);
      if (split.length) {
        sets.push(...split);
        main = split[0];
        reasons.length = 0;
      }
    }
    if (main && !sets.length) {
      sets.push(main);
      const compound = new Set(main.parts.map((p) => p.name));
      const drawnIn = new Set(main.parts.map((p) => p.source).filter(Boolean));
      for (const other of exports.slice(1)) {
        if (other.startsWith(folder) && compound.has(other.slice(folder.length))) continue;
        const spec = attempt(other);
        if (!spec) continue;
        // Not drawn alone when it is not faithful alone or adds nothing: a part that reads private custom properties
        // its parent sets (a tab's height from its list), or one the main set already draws with nothing to set
        // (a tab list).
        const readsParent = spec.unmapped.some((u) => /^--_[\w-]+ is not a token$/.test(u.reason));
        const duplicate = drawnIn.has(spec.parts[0]?.source) && !spec.properties.length && spec.axes.every((a) => a.name === 'State');
        if (readsParent || duplicate) continue;
        sets.push(spec);
      }
    }
    // Popups (a select's list, a dialog, a tooltip): drawn open, as their own set, next to what opens them, the way a
    // Figma UI kit draws them. Base UI behaviour is not drawn, only the look.
    const hasPopup = /\.(Portal|Popup)\b/.test(opts.read(`${opts.componentsDir}/${folder}/${folder}.tsx`) ?? '');
    if (!main && hasPopup) {
      reasons.length = 0;
      for (const name of exports) {
        // What opens the popup counts when the component styles it (a select's trigger), not when it is the consumer's
        // own element (a tooltip's trigger).
        const closedSpec = attempt(name, 'without-popup');
        const closed = closedSpec?.parts.some((p) => p.source?.includes(`${folder}.module.css`)) ? closedSpec : undefined;
        if (closed && !sets.some((x) => x.name === closed.name)) sets.push(closed);
        const suffix = name === folder ? '' : name.startsWith(folder) ? name.slice(folder.length) : name;
        const popupName = `${folder}/${sets.some((x) => x.name === `${folder}/Popup`) ? suffix || 'Popup' : 'Popup'}`;
        // Drawn open by the export that renders the portal itself (DialogContent), not by those that only wrap it.
        const fnNode = reader.load(name)?.fn;
        const ownsPortal = !!fnNode && /\.Portal\b/.test(fnNode.getText());
        const open = ownsPortal ? attempt(name, 'popup', popupName) : undefined;
        if (open && !sets.some((x) => x.name === open.name)) sets.push(open);
      }
    }
    // The icon component: every icon is drawn as its own component on the Icons page.
    if (!sets.length && folder === ICON_COMPONENT) {
      coverage.push({ name: folder, status: 'generated', reason: 'drawn as icon components on the Icons page' });
      continue;
    }
    if (!sets.length) {
      const fileText = opts.read(`${opts.componentsDir}/${folder}/${folder}.tsx`) ?? '';
      // A component made of Base UI popup parts (a dialog, a menu, a toast) opens a popup, whatever it draws first.
      const reason = /\.(Portal|Popup|Positioner)\b/.test(fileText) && !reasons.length ? 'opens a popup' : reasons.length ? mainReason(reasons) : undefined;
      // What the generator cannot read but Claude drafted from the code (component-spec-overrides/<Name>.json).
      const drafted = draftedSpec(folder, withList);
      if (drafted) {
        components.push(drafted);
        coverage.push({ name: folder, status: 'drafted', reason: drafted.drafted!.reason, ...(drafted.name !== folder ? { sets: [drafted.name] } : {}) });
        continue;
      }
      if (!paints(folder)) coverage.push({ name: folder, status: 'layout', reason: /inset\(50%\)/.test(cssOf(folder)) ? 'screen reader text only, nothing to draw' : 'layout only, use auto layout' });
      else coverage.push({ name: folder, status: 'unsupported', reason: reason ?? 'draws nothing the generator can read yet' });
      continue;
    }
    components.push(...sets);
    coverage.push({ name: folder, status: 'generated', ...(sets.length > 1 || sets[0]!.name !== folder ? { sets: sets.map((x) => x.name) } : {}) });
  }
  return specsFile(components, withList, coverage);
}

// ---------------------------------------------------------------------------------------------
// Drafted with Claude

/** Where drafted specs live: next to component-specs.json (packages/react/component-spec-overrides). */
export const overridesDirOf = (componentsDir: string) => posix.join(posix.dirname(posix.dirname(componentsDir)), 'component-spec-overrides');

/** FNV-1a of the code a drafted spec was read from, to tell when the code changed since. */
export function draftedCodeHash(files: string[], read: (path: string) => string | undefined): string {
  return specHash(files.map((f) => `${f}\n${read(f) ?? ''}`).join('\n'));
}

/**
 * A spec Claude drafted for a component the generator cannot read: `component-spec-overrides/<Folder>.json`, a
 * ComponentSpec marked `"source": "drafted"` with the files it was read from (`files`), the generator's reason and the
 * code's hash when drafted (`codeHash`). Validated like a generated spec, against the repo's tokens: an invalid one
 * fails `npm run specs`. Never counted as generated: its coverage is `drafted`, and it is `stale` once the code changed.
 */
export function draftedSpec(folder: string, opts: SpecGeneratorOptions): ComponentSpec | undefined {
  const path = `${opts.overridesDir ?? overridesDirOf(opts.componentsDir)}/${folder}.json`;
  const text = opts.read(path);
  if (text === undefined) return undefined;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  if (raw.source !== 'drafted') throw new Error(`${path}: a drafted spec says "source": "drafted".`);
  const files = Array.isArray(raw.files) ? (raw.files as unknown[]).filter((f): f is string => typeof f === 'string') : [];
  if (!files.length) throw new Error(`${path}: list the code it was drafted from in "files".`);
  const reason = typeof raw.reason === 'string' && raw.reason ? raw.reason : 'the generator cannot read it yet';
  const { $comment: _c, source: _s, files: _f, reason: _r, codeHash, hash: _h, drafted: _d, ...fields } = raw;
  const stale = typeof codeHash === 'string' && codeHash !== draftedCodeHash(files, opts.read);
  const body = { ...(fields as unknown as Omit<ComponentSpec, 'hash' | 'source' | 'drafted'>), drafted: { reason, ...(stale ? { stale: true } : {}) } };
  const problems = validateComponentSpec({ ...body, source: files }, new Map([...typesOf(opts.tokens)].map(([k, v]) => [k, v.type])));
  if (problems.length) throw new Error(`${path} does not match the component spec format:\n- ${problems.join('\n- ')}`);
  const { name, axes, properties, parts, variants, unmapped, ...rest } = body;
  const spec: Omit<ComponentSpec, 'hash'> = { name, ...rest, source: files, axes, properties, parts, variants, unmapped };
  return { name, ...rest, hash: hashSpec(spec), source: files, axes, properties, parts, variants, unmapped };
}

// ---------------------------------------------------------------------------------------------
// Repo helpers (Node)

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

/** Generator options for the repo at `root` from bridge.config.json (tokens root, components dir, cssVar), and its component folders. */
export function repoSpecOptions(root: string): { opts: SpecGeneratorOptions; folders: string[] } {
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
  const dir = join(root, componentsDir);
  const folders = readdirSync(dir)
    .filter((n) => /^[A-Z]/.test(n) && statSync(join(dir, n)).isDirectory() && read(`${componentsDir}/${n}/${n}.tsx`) !== undefined)
    .sort();
  // The global base stylesheet next to the components (packages/react/src/styles/base.css), when the repo has one.
  const baseCss = posix.join(posix.dirname(componentsDir), 'styles/base.css');
  return { opts: { componentsDir, read, tokens, styleSuffix: config.components?.styleSuffix, components: folders, ...(read(baseCss) !== undefined ? { baseCss } : {}) }, folders };
}

/**
 * Specs for the repo at `root`. With `names`, those sets only (throws when one cannot be generated). Without, every
 * component folder: the sets the generator can draw, and the coverage of all of them (what `npm run specs` writes).
 */
export function generateRepoComponentSpecs(root: string, names?: string[]): ComponentSpecsFile {
  const { opts, folders } = repoSpecOptions(root);
  return names ? generateComponentSpecs(names, opts) : generateAllComponentSpecs(folders, opts);
}

/** The JSON text written to disk: stable, two-space indent, trailing newline. */
export const serializeComponentSpecs = (f: ComponentSpecsFile) => `${JSON.stringify(f, null, 2)}\n`;
