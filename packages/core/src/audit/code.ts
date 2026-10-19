// TSX/JSX/TS/JS scanner (TypeScript compiler API, syntax only): style objects (style, sx, styled, makeStyles,
// theme objects), CSS-in-JS templates, Tailwind class strings, color literals, DS token references, and
// component usage (DS, foreign UI libraries, native elements, re-created DS components).
import ts from 'typescript';
import { classifyModule, dsEquivalent, isNonVisual, isRouterLink, libraryLabel, nativeEquivalent } from './components';
import { scanCssText } from './css';
import { isColorLiteral, scanJsStyle, type JsStyleContext, type ValueHit } from './scan-value';
import { scanClassString, type TailwindHit } from './tailwind';
import type { DesignSystemIndex } from './ds-index';
import type { ComponentFinding, FindingCategory, FindingSource, StyleFinding } from './types';
import { parseCssColor } from './color';

export interface CodeScan {
  findings: StyleFinding[];
  tokenUsages: number;
  themeRefs: number;
  /** DS component instances by name. */
  ds: Record<string, number>;
  components: ComponentFinding[];
  /** Local component definitions (PascalCase functions, classes, consts). */
  definitions: { name: string; line: number }[];
}

const CLASS_FNS = /^(cn|clsx|classnames|classNames|cva|twMerge|twJoin|tw|cx)$/;
const STYLE_FNS = /^(makeStyles|withStyles|createStyles|css|keyframes|globalCss|injectGlobal|sxProps)$/;
const THEME_FNS = /^(createTheme|extendTheme|createMuiTheme|responsiveFontSizes|experimental_extendTheme|deepmerge)$/;
const CSS_TAGS = /^(styled(\.\w+|\(.*\)(\.attrs\(.*\))?)|css|keyframes|createGlobalStyle|injectGlobal|tw\.\w+)$/s;
const MUI_SPACING_ATTR = /^([mp][trblxy]?|(margin|padding)(Top|Bottom|Left|Right|X|Y)?|gap|rowGap|columnGap|spacing)$/;
const THEME_REF_RE = /\btheme\.(palette|spacing|shape|typography|shadows|zIndex|transitions|vars)\b/g;

/**
 * DS renderers for pages without React (`@bridge-ds/react/dom`): `badgeHtml()`, `codeBlockHtml()`,
 * `tooltipAttributes()`, `badgeClassName()`. A call imported from a DS package whose name is a component name plus one
 * of these suffixes counts as one instance of that component.
 */
const DOM_RENDERER_RE = /^([a-z][A-Za-z0-9]*?)(Html|HTML|HtmlAttributes|Attributes|ClassName)$/;

/** The DS component a DOM renderer stands for: `checklistRowHtml` -> ChecklistRow, else the longest DS name it starts with. */
export function domRendererComponent(fn: string, components: Set<string>): string | undefined {
  const m = DOM_RENDERER_RE.exec(fn);
  if (!m) return undefined;
  const pascal = m[1]![0]!.toUpperCase() + m[1]!.slice(1);
  if (components.has(pascal)) return pascal;
  return [...components].filter((c) => pascal.startsWith(c)).sort((a, b) => b.length - a.length)[0];
}

/**
 * Homemade look-alikes in markup a script builds (`class="pill"`, `data-tip="..."`): the DS component they imitate.
 * Exact class tokens only, so app classes that merely contain the word (`cm-pill-row`) are not counted.
 */
export const LOOKALIKE_CLASSES: Record<string, string> = { pill: 'Badge', badge: 'Badge', chip: 'Tag', tooltip: 'Tooltip', tip: 'Tooltip', 'has-tip': 'Tooltip' };
export const LOOKALIKE_ATTRS: Record<string, string> = { 'data-tip': 'Tooltip' };
const HTML_CLASS_RE = /\bclass(?:Name)?\s*=\s*["']([^"'$]*)/g;
const HTML_ATTR_RE = /\s(data-tip)\s*=/g;

/** Look-alikes in a class list (`pill is-pass`): one finding per imitated component. */
export function lookalikesInClassList(list: string, components: Set<string>): { token: string; component: string }[] {
  const out: { token: string; component: string }[] = [];
  for (const token of list.split(/\s+/)) {
    const component = LOOKALIKE_CLASSES[token];
    if (component && components.has(component) && !out.some((o) => o.component === component)) out.push({ token, component });
  }
  return out;
}

function kindFor(path: string): ts.ScriptKind {
  return path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.jsx') ? ts.ScriptKind.JSX : path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts') ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
}

const RENDER_PROPS = new Set(['render', 'component', 'as', 'linkComponent', 'LinkComponent']);
/** `<Comp render={<Link to="/x" />} />`, `render={<a href="/x" />}` or `{ render: <Link /> }`: the element only gives a component its tag or router. */
function isRenderElement(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
  let p: ts.Node = ts.isJsxOpeningElement(node) ? node.parent.parent : node.parent;
  while (ts.isParenthesizedExpression(p)) p = p.parent;
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return RENDER_PROPS.has(p.parent.name.getText());
  if (ts.isPropertyAssignment(p)) return RENDER_PROPS.has(p.name.getText());
  return false;
}

const keyName = (n: ts.PropertyName | undefined): string | undefined =>
  !n ? undefined : ts.isIdentifier(n) || ts.isPrivateIdentifier(n) ? n.text : ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : undefined;

function contextForDeclaration(name: string, typeText: string): JsStyleContext | null {
  if (/SxProps/.test(typeText)) return 'sx';
  if (/CSSProperties|CSSObject/.test(typeText)) return 'style';
  if (/Theme(Options)?\b/.test(typeText) || /theme$/i.test(name)) return 'theme';
  if (/^(styles?|sx|classes)$|Styles?$|Sx$/.test(name)) return /sx$/i.test(name) ? 'sx' : 'styled';
  return null;
}

/** Imported name -> module and exported name ('default', '*' for a namespace). */
export type ImportMap = Map<string, { module: string; imported: string }>;

/** Import declarations of a script (TS or JS), for markup files whose tags use what the script imports. */
export function importsOf(path: string, text: string): ImportMap {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kindFor(path));
  const imports: ImportMap = new Map();
  for (const node of sf.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const mod = node.moduleSpecifier.text;
    const c = node.importClause;
    if (c?.name) imports.set(c.name.text, { module: mod, imported: 'default' });
    if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) imports.set(c.namedBindings.name.text, { module: mod, imported: '*' });
    if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const el of c.namedBindings.elements) imports.set(el.name.text, { module: mod, imported: (el.propertyName ?? el.name).text });
  }
  return imports;
}

/** One element as written in JSX or in a template (Astro, Vue, Svelte). */
export interface TagUse {
  name: string;
  line: number;
  column: number;
  /** Static `type` attribute. */
  type?: string;
  hasHref: boolean;
  /** The element only gives a component its tag or router (`render={<a href="/x" />}`). */
  inRenderProp?: boolean;
}

/**
 * What an element is: a DS component instance, a foreign, native or re-created component, or nothing (providers,
 * hidden inputs, anchors without href). `localCandidate`: an unimported DS-named tag, re-created only when the file
 * defines it.
 */
export function classifyTag(t: TagUse, imports: ImportMap, ds: DesignSystemIndex): { ds?: string; component?: ComponentFinding; localCandidate?: ComponentFinding } {
  const { name } = t;
  const at = { line: t.line, column: t.column };
  if (/^[a-z][\w-]*$/.test(name)) {
    if (!ds.nativeElements.includes(name)) return {};
    if (name === 'input' && t.type === 'hidden') return {};
    // An anchor without href is not a link (named anchor, placeholder).
    if (name === 'a' && !t.hasHref) return {};
    // `<Button render={<a href="/x" />}>`: the element only gives the DS component its tag; the DS component is the UI.
    if (t.inRenderProp) return {};
    // A native element is a miss only when the design system has a component that replaces it: an <img> is fine in
    // a design system without Image, a <table> in one without Table.
    const suggestion = nativeEquivalent(name, t.type, ds.components);
    if (!suggestion) return {};
    return { component: { ...at, name, kind: 'native', library: 'native', suggestion } };
  }
  const root = name.split('.')[0]!;
  const imp = imports.get(root);
  const ns = imp?.imported === '*';
  // Named imports report the exported name (aliases resolved); namespace imports keep Dialog.Root.
  const shown = imp && !ns && imp.imported !== 'default' ? [imp.imported, ...name.split('.').slice(1)].join('.') : name;
  const leaf = ns && name.includes('.') ? name.split('.').slice(1).join('.') : shown;
  if (imp) {
    const kind = classifyModule(imp.module, ds.packages, ds.foreignLibraries);
    // Providers and other non-visual parts are not UI instances, from the DS or elsewhere.
    if (isNonVisual(leaf.split('.').pop()!)) return {};
    if (kind === 'ds') return { ds: leaf };
    if (kind === 'charts') return { component: { ...at, name: shown, kind: 'foreign', library: libraryLabel(imp.module, kind) } };
    if (kind === 'other' && isRouterLink(imp.module, imp.imported === 'default' ? 'default' : leaf)) {
      if (t.inRenderProp) return {};
      const suggestion = ds.components.has('Link') ? 'Link' : undefined;
      return { component: { ...at, name: shown, kind: 'foreign', library: libraryLabel(imp.module, kind), ...(suggestion ? { suggestion } : {}) } };
    }
    if (kind === 'foreign' || kind === 'shadcn') {
      const suggestion = (ns ? dsEquivalent(root, ds.components) : undefined) ?? dsEquivalent(leaf, ds.components);
      return { component: { ...at, name: shown, kind: 'foreign', library: libraryLabel(imp.module, kind), ...(suggestion ? { suggestion } : {}) } };
    }
    if (kind === 'local' && ds.components.has(leaf.split('.')[0]!)) return { component: { ...at, name: leaf, kind: 'recreated', library: 'local', suggestion: leaf.split('.')[0]! } };
    return {};
  }
  if (ds.components.has(root)) return { localCandidate: { ...at, name, kind: 'recreated', library: 'local', suggestion: root } };
  return {};
}

/** Findings for Tailwind classes (arbitrary values and palette classes); scale classes count as theme references. */
export function tailwindFindings(hits: TailwindHit[], offset: number, pos: (offset: number) => { line: number; column: number }, ds: DesignSystemIndex): { findings: StyleFinding[]; themeRefs: number } {
  const findings: StyleFinding[] = [];
  let themeRefs = 0;
  for (const h of hits) {
    if (h.kind === 'scale') {
      themeRefs++;
      continue;
    }
    if (h.kind === 'token') continue; // counted by the var() pass over every literal
    let cat = h.category!;
    const v = h.value!;
    const isColor = Boolean(parseCssColor(v));
    if (cat === 'color-or-size') cat = isColor ? 'color' : 'font-size';
    else if (cat === 'color-or-width') cat = isColor ? 'color' : 'border-width';
    else if (cat === 'color-or-shadow') cat = isColor ? 'color' : 'shadow';
    else if (cat === 'font') cat = /^\d{3}$/.test(v) ? 'font-weight' : 'font-family';
    if (cat === 'color' && !isColor) continue;
    const suggestion = ds.suggest(cat as FindingCategory, v);
    const cap = h.kind === 'palette' && suggestion && suggestion.confidence > 0.6 ? { ...suggestion, confidence: 0.6, level: 'medium' as const } : suggestion;
    findings.push({ ...pos(offset + h.index), category: cat as FindingCategory, value: h.cls, source: 'tailwind', ...(cap ? { suggestion: cap } : {}) });
  }
  return { findings, themeRefs };
}

export function scanCode(path: string, text: string, ds: DesignSystemIndex): CodeScan {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindFor(path));
  const out: CodeScan = { findings: [], tokenUsages: 0, themeRefs: 0, ds: {}, components: [], definitions: [] };
  const handled = new Set<ts.Node>();
  const imports: ImportMap = new Map();
  const pos = (offset: number) => {
    const lc = sf.getLineAndCharacterOfPosition(offset);
    return { line: lc.line + 1, column: lc.character + 1 };
  };

  const addHit = (h: ValueHit, offset: number, source: FindingSource, property?: string) => {
    const suggestion = ds.suggest(h.category, h.text, property);
    out.findings.push({ ...pos(offset), category: h.category, ...(property ? { property } : {}), value: h.text, source, ...(suggestion ? { suggestion } : {}) });
  };

  const addTailwind = (hits: TailwindHit[], offset: number) => {
    const r = tailwindFindings(hits, offset, pos, ds);
    out.themeRefs += r.themeRefs;
    out.findings.push(...r.findings);
  };

  // A literal value in a style object: string, number, template parts, both branches of a condition.
  const styleValue = (key: string, node: ts.Expression, ctx: JsStyleContext) => {
    const source: FindingSource = ctx === 'sx' ? 'sx' : ctx === 'style' ? 'style' : ctx === 'theme' ? 'theme' : 'styled';
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return styleValue(key, node.expression, ctx);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      handled.add(node);
      const r = scanJsStyle(key, node.text, ctx);
      if (r.themeRef) out.themeRefs++;
      for (const h of r.hits) addHit(h, node.getStart(sf) + 1 + h.index, source, r.hits.length ? cssKey(key) : undefined);
      return;
    }
    if (ts.isNumericLiteral(node) || (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand))) {
      const n = ts.isNumericLiteral(node) ? Number(node.text) : -Number((node.operand as ts.NumericLiteral).text);
      const r = scanJsStyle(key, n, ctx);
      if (r.themeRef) out.themeRefs++;
      for (const h of r.hits) addHit(h, node.getStart(sf), source, cssKey(key));
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const parts: (ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail)[] = [node.head, ...node.templateSpans.map((s) => s.literal)];
      for (const p of parts) {
        handled.add(p);
        const r = scanJsStyle(key, p.text, ctx);
        for (const h of r.hits) addHit(h, p.getStart(sf) + 1 + h.index, source, cssKey(key));
      }
      node.templateSpans.forEach((s) => visit(s.expression, ctx, false));
      return;
    }
    if (ts.isConditionalExpression(node)) {
      visit(node.condition, null, false);
      styleValue(key, node.whenTrue, ctx);
      styleValue(key, node.whenFalse, ctx);
      return;
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) {
      styleValue(key, node.left, ctx);
      styleValue(key, node.right, ctx);
      return;
    }
    visit(node, ctx, false);
  };
  const cssKey = (k: string) => k.replace(/^(Webkit|Moz|ms)(?=[A-Z])/, (p) => `-${p.toLowerCase()}`).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

  const cssTemplate = (tpl: ts.TemplateLiteral) => {
    const start = tpl.getStart(sf) + 1;
    let body = text.slice(start, tpl.getEnd() - 1);
    // ${...} become spaces (keeping newlines) so offsets map back to the file.
    if (ts.isTemplateExpression(tpl)) for (const s of tpl.templateSpans) {
      const a = s.expression.getFullStart() - 2 - start;
      const b = s.literal.getStart(sf) + 1 - start;
      body = body.slice(0, a) + body.slice(a, b).replace(/[^\n]/g, ' ') + body.slice(b);
      visit(s.expression, null, false);
    }
    const parts = ts.isTemplateExpression(tpl) ? [tpl.head, ...tpl.templateSpans.map((s) => s.literal)] : [tpl];
    parts.forEach((p) => handled.add(p));
    const scan = scanCssText(body, 'scss');
    for (const d of scan.decls) {
      if (d.scan.themeRef) out.themeRefs++;
      for (const h of d.scan.hits) addHit(h, start + d.valueStart + h.index, 'styled', d.property.toLowerCase());
    }
    for (const a of scan.applies) addTailwind(a.hits, start + a.start);
  };

  const lookalike = (list: string, offset: number) => {
    for (const l of lookalikesInClassList(list, ds.components)) out.components.push({ ...pos(offset), name: `.${l.token}`, kind: 'recreated', library: 'local', suggestion: l.component });
  };

  const classLiteral = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      handled.add(node);
      lookalike(node.text, node.getStart(sf) + 1);
      addTailwind(scanClassString(node.text), node.getStart(sf) + 1);
    } else if (ts.isTemplateExpression(node)) {
      for (const p of [node.head, ...node.templateSpans.map((s) => s.literal)]) {
        handled.add(p);
        lookalike(p.text, p.getStart(sf) + 1);
        addTailwind(scanClassString(p.text), p.getStart(sf) + 1);
      }
      node.templateSpans.forEach((s) => visit(s.expression, null, true));
    } else visit(node, null, true);
  };

  const jsxName = (n: ts.JsxTagNameExpression) => n.getText(sf);

  const element = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => {
    const name = jsxName(node.tagName);
    const typeAttr = node.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === 'type');
    const type = typeAttr?.initializer && ts.isStringLiteral(typeAttr.initializer) ? typeAttr.initializer.text : undefined;
    const hasHref = node.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'href');
    const r = classifyTag({ name, ...pos(node.getStart(sf)), ...(type !== undefined ? { type } : {}), hasHref, inRenderProp: isRenderElement(node) }, imports, ds);
    if (r.ds) out.ds[r.ds] = (out.ds[r.ds] ?? 0) + 1;
    if (r.component) out.components.push(r.component);
    if (r.localCandidate) pendingLocal.push(r.localCandidate);
  };
  const pendingLocal: ComponentFinding[] = [];

  function visit(node: ts.Node, ctx: JsStyleContext | null, classCtx: boolean): void {
    if (ts.isImportDeclaration(node)) {
      const mod = (node.moduleSpecifier as ts.StringLiteral).text;
      handled.add(node.moduleSpecifier);
      const c = node.importClause;
      if (c?.name) imports.set(c.name.text, { module: mod, imported: 'default' });
      if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings)) imports.set(c.namedBindings.name.text, { module: mod, imported: '*' });
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const el of c.namedBindings.elements) imports.set(el.name.text, { module: mod, imported: (el.propertyName ?? el.name).text });
      return;
    }
    if ((ts.isExportDeclaration(node) && node.moduleSpecifier) || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      node.forEachChild((c) => handled.add(c));
    }
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) out.definitions.push({ name: node.name.text, line: pos(node.getStart(sf)).line });
    if (ts.isClassDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) out.definitions.push({ name: node.name.text, line: pos(node.getStart(sf)).line });
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      const init = node.initializer;
      if (/^[A-Z]/.test(name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || (ts.isCallExpression(init) && /^(React\.)?(forwardRef|memo)$/.test(init.expression.getText(sf)))))
        out.definitions.push({ name, line: pos(node.getStart(sf)).line });
      // const Root = styled(Card)(...): Root renders the imported component, same library.
      if (init && ts.isCallExpression(init) && ts.isCallExpression(init.expression) && init.expression.expression.getText(sf) === 'styled') {
        const base = init.expression.arguments[0];
        const from = base && ts.isIdentifier(base) ? imports.get(base.text) : undefined;
        if (from) imports.set(name, { ...from, imported: from.imported === 'default' || from.imported === '*' ? base!.getText(sf) : from.imported });
      }
      const declCtx = contextForDeclaration(name, node.type?.getText(sf) ?? '');
      if (declCtx && init) {
        visit(init, declCtx, classCtx);
        return;
      }
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const init = node.initializer;
      if (!init) return;
      const expr = ts.isJsxExpression(init) ? init.expression : init;
      if (!expr) return;
      if (/^(className|class|tw)$/.test(name)) return classLiteral(expr);
      if (name === 'style' || /Style$/.test(name)) return visit(expr, 'style', false);
      if (name === 'sx' || /Sx$/.test(name)) return visit(expr, 'sx', false);
      if (name === 'css') return visit(expr, 'style', false);
      if (ts.isStringLiteral(expr) && isColorLiteral(expr.text)) {
        handled.add(expr);
        addHit({ category: 'color', text: expr.text, index: 0 }, expr.getStart(sf) + 1, 'jsx-attr', name);
        return;
      }
      if (MUI_SPACING_ATTR.test(name) && ts.isNumericLiteral(expr)) {
        out.themeRefs++;
        return;
      }
      return visit(expr, ctx, classCtx);
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) element(node);
    if (ts.isTaggedTemplateExpression(node) && CSS_TAGS.test(node.tag.getText(sf))) {
      cssTemplate(node.template);
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const imp = imports.get(node.expression.text);
      if (imp && imp.imported !== '*' && classifyModule(imp.module, ds.packages, ds.foreignLibraries) === 'ds') {
        const comp = domRendererComponent(imp.imported === 'default' ? node.expression.text : imp.imported, ds.components);
        if (comp) out.ds[comp] = (out.ds[comp] ?? 0) + 1;
      }
    }
    // el.className = 'pill is-pass': a class list set from a script.
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'className') {
      visit(node.left, ctx, classCtx);
      return classLiteral(node.right);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (CLASS_FNS.test(callee)) {
        node.arguments.forEach((a) => visitClassArg(a));
        return;
      }
      const argCtx: JsStyleContext | null = /^styled(\.|\(|$)/.test(callee) || STYLE_FNS.test(callee) ? 'styled' : THEME_FNS.test(callee) ? 'theme' : null;
      if (argCtx) {
        visit(node.expression, ctx, classCtx);
        node.arguments.forEach((a) => visit(a, argCtx, false));
        return;
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const key = keyName(node.name);
      if (key !== undefined) {
        if (key === 'className' || key === 'class') return classLiteral(node.initializer);
        if (key === 'sx' || key === 'style' || key === 'styleOverrides' || /Sx$/.test(key)) {
          return visit(node.initializer, key === 'style' ? 'style' : key === 'styleOverrides' ? 'styled' : 'sx', false);
        }
        if (ctx) {
          if (ts.isObjectLiteralExpression(node.initializer) || ts.isArrowFunction(node.initializer) || ts.isArrayLiteralExpression(node.initializer)) return visit(node.initializer, ctx, classCtx);
          return styleValue(key, node.initializer, ctx);
        }
      }
    }
    if (classCtx && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))) return classLiteral(node);
    node.forEachChild((c) => visit(c, ctx, classCtx));
  }

  // cn(...), cva(...) arguments: strings, arrays, conditionals and the cva config object are class strings.
  const visitClassArg = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) return classLiteral(n);
    if (ts.isPropertyAssignment(n)) {
      if (ts.isStringLiteral(n.name)) {
        handled.add(n.name);
        addTailwind(scanClassString(n.name.text), n.name.getStart(sf) + 1);
      }
      return visitClassArg(n.initializer);
    }
    n.forEachChild(visitClassArg);
  };

  visit(sf, null, false);

  // Every remaining literal: DS token references, other CSS variables, color literals anywhere in code.
  const literal = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const t = (node as ts.LiteralLikeNode).text;
      // Markup built in strings (`<span class="pill">`, `data-tip="..."`): homemade look-alikes of DS components.
      if (!handled.has(node) && (t.includes('<') || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) {
        const base = node.getStart(sf) + 1;
        for (const m of t.matchAll(HTML_CLASS_RE)) for (const l of lookalikesInClassList(m[1]!, ds.components)) out.components.push({ ...pos(base + m.index!), name: `.${l.token}`, kind: 'recreated', library: 'local', suggestion: l.component });
        for (const m of t.matchAll(HTML_ATTR_RE)) {
          const component = LOOKALIKE_ATTRS[m[1]!];
          if (component && ds.components.has(component)) out.components.push({ ...pos(base + m.index! + 1), name: `[${m[1]}]`, kind: 'recreated', library: 'local', suggestion: component });
        }
      }
      for (const m of t.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (ds.isDsVar(m[1]!)) out.tokenUsages++;
        else out.themeRefs++;
      }
      if (!handled.has(node) && ts.isStringLiteral(node) && isColorLiteral(t) && !ts.isImportDeclaration(node.parent) && !ts.isExternalModuleReference(node.parent)) {
        addHit({ category: 'color', text: t.trim(), index: 0 }, node.getStart(sf) + 1, 'js', ts.isPropertyAssignment(node.parent) ? keyName(node.parent.name) : undefined);
      }
    }
    node.forEachChild(literal);
  };
  literal(sf);
  out.themeRefs += [...text.matchAll(THEME_REF_RE)].length;

  // DS-named components defined in this file (hoisting: definitions may follow their use).
  const defined = new Set(out.definitions.map((d) => d.name));
  out.components.push(...pendingLocal.filter((f) => defined.has(f.suggestion!)));
  out.findings.sort((a, b) => a.line - b.line || a.column - b.column);
  out.components.sort((a, b) => a.line - b.line || a.column - b.column);
  return out;
}
