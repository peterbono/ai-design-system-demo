// TSX/JSX/TS/JS scanner (TypeScript compiler API, syntax only): style objects (style, sx, styled, makeStyles,
// theme objects), CSS-in-JS templates, Tailwind class strings, color literals, DS token references, and
// component usage (DS, foreign UI libraries, native elements, re-created DS components).
import ts from 'typescript';
import { classifyModule, dsEquivalent, isNonVisual, libraryLabel, nativeEquivalent } from './components';
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

function kindFor(path: string): ts.ScriptKind {
  return path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.jsx') ? ts.ScriptKind.JSX : path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts') ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
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

export function scanCode(path: string, text: string, ds: DesignSystemIndex): CodeScan {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindFor(path));
  const out: CodeScan = { findings: [], tokenUsages: 0, themeRefs: 0, ds: {}, components: [], definitions: [] };
  const handled = new Set<ts.Node>();
  const imports = new Map<string, { module: string; imported: string }>();
  const pos = (offset: number) => {
    const lc = sf.getLineAndCharacterOfPosition(offset);
    return { line: lc.line + 1, column: lc.character + 1 };
  };

  const addHit = (h: ValueHit, offset: number, source: FindingSource, property?: string) => {
    const suggestion = ds.suggest(h.category, h.text, property);
    out.findings.push({ ...pos(offset), category: h.category, ...(property ? { property } : {}), value: h.text, source, ...(suggestion ? { suggestion } : {}) });
  };

  const addTailwind = (hits: TailwindHit[], offset: number) => {
    for (const h of hits) {
      if (h.kind === 'scale') {
        out.themeRefs++;
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
      out.findings.push({ ...pos(offset + h.index), category: cat as FindingCategory, value: h.cls, source: 'tailwind', ...(cap ? { suggestion: cap } : {}) });
    }
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

  const classLiteral = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      handled.add(node);
      addTailwind(scanClassString(node.text), node.getStart(sf) + 1);
    } else if (ts.isTemplateExpression(node)) {
      for (const p of [node.head, ...node.templateSpans.map((s) => s.literal)]) {
        handled.add(p);
        addTailwind(scanClassString(p.text), p.getStart(sf) + 1);
      }
      node.templateSpans.forEach((s) => visit(s.expression, null, true));
    } else visit(node, null, true);
  };

  const jsxName = (n: ts.JsxTagNameExpression) => n.getText(sf);

  const element = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => {
    const name = jsxName(node.tagName);
    const at = pos(node.getStart(sf));
    if (/^[a-z][\w-]*$/.test(name)) {
      if (!ds.nativeElements.includes(name)) return;
      const typeAttr = node.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === 'type');
      const type = typeAttr?.initializer && ts.isStringLiteral(typeAttr.initializer) ? typeAttr.initializer.text : undefined;
      if (name === 'input' && type === 'hidden') return;
      const suggestion = nativeEquivalent(name, type, ds.components);
      out.components.push({ ...at, name, kind: 'native', library: 'native', ...(suggestion ? { suggestion } : {}) });
      return;
    }
    const root = name.split('.')[0]!;
    const imp = imports.get(root);
    const ns = imp?.imported === '*';
    // Named imports report the exported name (aliases resolved); namespace imports keep Dialog.Root.
    const shown = imp && !ns && imp.imported !== 'default' ? [imp.imported, ...name.split('.').slice(1)].join('.') : name;
    const leaf = ns && name.includes('.') ? name.split('.').slice(1).join('.') : shown;
    if (imp) {
      const kind = classifyModule(imp.module, ds.packages, ds.foreignLibraries);
      if (kind === 'ds') {
        out.ds[leaf] = (out.ds[leaf] ?? 0) + 1;
        return;
      }
      if (isNonVisual(leaf.split('.').pop()!)) return;
      if (kind === 'foreign' || kind === 'shadcn') {
        const suggestion = (ns ? dsEquivalent(root, ds.components) : undefined) ?? dsEquivalent(leaf, ds.components);
        out.components.push({ ...at, name: shown, kind: 'foreign', library: libraryLabel(imp.module, kind), ...(suggestion ? { suggestion } : {}) });
        return;
      }
      if (kind === 'local' && ds.components.has(leaf.split('.')[0]!)) out.components.push({ ...at, name: leaf, kind: 'recreated', library: 'local', suggestion: leaf.split('.')[0]! });
      return;
    }
    if (ds.components.has(root)) pendingLocal.push({ ...at, name, kind: 'recreated', library: 'local', suggestion: root });
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
