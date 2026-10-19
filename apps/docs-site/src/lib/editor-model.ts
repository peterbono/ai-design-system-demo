// Token editing on the web, as pure functions: a draft (list of edits) applied to the token set, written back to the
// DTCG files with minimal diffs, validated with the same guardrails as the Figma plugin and the token build, and
// turned into CSS variable overrides for the live preview. The DOM side lives in scripts/token-editor.ts.
import {
  buildTokenSet,
  composeFiles,
  cssOf,
  cssVarOf,
  previewOverrides,
  contextLabel,
  formatValue,
  isAlias,
  aliasTarget,
  parseColor,
  pathId,
  resolve,
  rgbaToHex,
  validateProposal,
  type AcceptedChange,
  type ContrastPair,
  type ContrastResult,
  type Issue,
  type LayoutOptions,
  type LogicalToken,
  type ResolveContext,
  type TokenSet,
} from '@bridge-ds/core';

/** One pending edit. Values are raw DTCG `$value`s: an alias string like "{palette.primary.600}" or a literal. */
export type DraftEdit =
  | { kind: 'value'; id: string; path: string; mode: string; before: unknown; after: unknown }
  | { kind: 'add'; id: string; path: string; type: string; tier: 'semantic'; values: Record<string, unknown>; description?: string }
  | { kind: 'description'; id: string; path: string; before: string | undefined; after: string }
  | { kind: 'rename'; id: string; path: string; to: string }
  | { kind: 'delete'; id: string; path: string }
  /** A component's docs.json written in the docs editor (lib/docs-draft-model.ts). `path` is the repo path. */
  | { kind: 'docs'; id: string; path: string; component: string; slug: string; before: string | null; after: string };

export interface Draft {
  edits: DraftEdit[];
}

export const emptyDraft = (): Draft => ({ edits: [] });

const clone = (t: LogicalToken): LogicalToken => ({ ...t, values: { ...t.values }, files: { ...t.files } });

/** Folds the draft into one AcceptedChange per token (last edit wins per token and mode). */
export function draftToChanges(head: TokenSet, draft: Draft): AcceptedChange[] {
  const targets = new Map<string, { current: LogicalToken | undefined; target: LogicalToken | undefined }>();
  const entry = (path: string) => {
    for (const v of targets.values()) if ((v.target ?? v.current)?.path === path) return v;
    const current = head.byPath.get(path);
    if (!current) return undefined;
    const v = { current, target: clone(current) as LogicalToken | undefined };
    targets.set(current.id, v);
    return v;
  };
  for (const e of draft.edits) {
    if (e.kind === 'docs') continue;
    if (e.kind === 'add') {
      targets.set(`new:${e.path}`, {
        current: undefined,
        target: { id: pathId(e.path), path: e.path, type: e.type, tier: e.tier, values: { ...e.values }, description: e.description, scopes: undefined, files: {} },
      });
      continue;
    }
    const v = entry(e.path);
    if (!v) continue;
    if (e.kind === 'delete') v.target = undefined;
    else if (!v.target) continue;
    else if (e.kind === 'rename') v.target.path = e.to;
    else if (e.kind === 'description') v.target.description = e.after.trim() || undefined;
    else v.target.values[e.mode] = e.after;
  }
  const out: AcceptedChange[] = [];
  for (const v of targets.values()) {
    const { current, target } = v;
    if (current && target && current.path === target.path && JSON.stringify(current.values) === JSON.stringify(target.values) && (current.description ?? '') === (target.description ?? '')) continue;
    out.push({ current, target });
  }
  return out;
}

export interface Applied {
  changes: AcceptedChange[];
  /** Changed files only, relative to the tokens root, with minimal diffs. */
  files: Record<string, string>;
  proposed: TokenSet;
}

export function applyDraft(head: TokenSet, originals: Record<string, string>, draft: Draft, options: LayoutOptions = {}): Applied {
  const changes = draftToChanges(head, draft);
  const composed = composeFiles(head, originals, changes);
  return { changes, files: composed.files, proposed: buildTokenSet(composed.allFiles, options) };
}

export interface Guardrails {
  blocking: Issue[];
  warnings: Issue[];
  /** Pairs below their minimum after the draft that were not failing before. */
  newContrastFailures: ContrastResult[];
  ok: boolean;
}

export function guardrails(head: TokenSet, proposed: TokenSet, pairs: ContrastPair[]): Guardrails {
  const v = validateProposal(proposed, head, pairs);
  const failedBefore = new Set(v.contrastBefore.filter((r) => r.level === 'fail').map((r) => `${r.brand}/${r.theme}:${r.pair.foreground}|${r.pair.background}`));
  const newContrastFailures = v.contrastAfter.filter((r) => r.level === 'fail' && !failedBefore.has(`${r.brand}/${r.theme}:${r.pair.foreground}|${r.pair.background}`));
  return { blocking: v.blocking, warnings: v.warnings, newContrastFailures, ok: v.blocking.length === 0 };
}

// cssOf, cssVarOf and previewOverrides live in @bridge-ds/core (css-overrides), shared with the admin's Bridge toolbar.
export { cssOf, cssVarOf, previewOverrides };

export interface TrayRow {
  edit: DraftEdit;
  index: number;
  label: string;
  context: string;
  before: { text: string; hex: string | null } | null;
  after: { text: string; hex: string | null } | null;
}

function shown(set: TokenSet, path: string, ctx: ResolveContext, raw: unknown, type: string) {
  const r = resolve(set.byPath, path, { ...ctx, overrides: set.overrideIndex });
  const c = type === 'color' && r.value !== undefined ? parseColor(r.value) : undefined;
  const resolved = cssOf(type, r.value) ?? (r.error ? `unresolved ${r.error}` : '');
  return { text: isAlias(raw) ? `{${aliasTarget(raw)}} ${resolved}` : resolved, hex: c ? rgbaToHex(c) : null };
}

/** Rows for the Draft changes tray, one per edit, with resolved before and after. */
export function trayRows(head: TokenSet, proposed: TokenSet, draft: Draft): TrayRow[] {
  return draft.edits.map((edit, index) => {
    if (edit.kind === 'value') {
      const t = head.byPath.get(edit.path) ?? proposed.byPath.get(edit.path);
      const type = t?.type ?? 'color';
      const axis = t ? axisCtx(head, t.tier, edit.mode) : {};
      return {
        edit,
        index,
        label: edit.path,
        context: edit.mode === '' || edit.mode === '$' ? '' : edit.mode,
        before: shown(head, edit.path, axis, edit.before, type),
        after: shown(proposed, edit.path, axis, edit.after, type),
      };
    }
    if (edit.kind === 'add') return { edit, index, label: edit.path, context: 'new token', before: null, after: { text: Object.entries(edit.values).map(([m, v]) => `${m}: ${String(v)}`).join(', '), hex: null } };
    if (edit.kind === 'description') return { edit, index, label: edit.path, context: 'description', before: { text: edit.before ?? 'No description', hex: null }, after: { text: edit.after || 'No description', hex: null } };
    if (edit.kind === 'rename') return { edit, index, label: `${edit.path} -> ${edit.to}`, context: 'rename', before: null, after: null };
    if (edit.kind === 'docs') return { edit, index, label: `${edit.component} docs`, context: 'docs', before: null, after: { text: 'Request review from its Library page', hex: null } };
    return { edit, index, label: edit.path, context: 'delete', before: null, after: null };
  });
}

/** First brand, light theme, first density, with the edited token's own axis set to `mode`. */
function axisCtx(set: TokenSet, tier: string, mode: string): ResolveContext {
  const ctx: ResolveContext = { brand: set.layout.brands[0]?.mode, theme: set.layout.themes[0]?.mode, density: set.layout.densities[0]?.mode };
  if (tier === 'brand') ctx.brand = mode;
  if (tier === 'semantic') ctx.theme = mode;
  if (tier === 'density') ctx.density = mode;
  return ctx;
}

/** Contrast before -> after for every pair the draft moves, labeled by brand and theme. */
export function contrastMoves(g: { contrastBefore: ContrastResult[]; contrastAfter: ContrastResult[] }) {
  const key = (r: ContrastResult) => `${r.brand}/${r.theme}:${r.pair.foreground}|${r.pair.background}`;
  const before = new Map(g.contrastBefore.map((r) => [key(r), r]));
  return g.contrastAfter
    .filter((r) => r.ratio !== undefined && before.get(key(r))?.ratio !== r.ratio)
    .map((r) => ({ fg: r.pair.foreground, bg: r.pair.background, where: contextLabel(r), before: before.get(key(r))?.ratio, after: r.ratio!, min: r.pair.min }));
}

/** Tokens of the same type an alias may point to, following the tier rules (semantic -> brand palette, etc.). */
export function aliasCandidates(set: TokenSet, t: Pick<LogicalToken, 'tier' | 'type' | 'path'>): string[] {
  const allowed: Record<string, string[]> = {
    primitive: ['primitive'],
    brand: ['primitive'],
    base: ['primitive'],
    density: ['primitive'],
    semantic: t.type === 'color' ? ['brand'] : ['primitive', 'brand', 'base'],
    component: ['semantic', 'base', 'density'],
  };
  const tiers = allowed[t.tier] ?? ['primitive'];
  return [...set.byPath.values()]
    .filter((x) => x.type === t.type && tiers.includes(x.tier) && x.path !== t.path && (t.type !== 'color' || t.tier !== 'semantic' || x.path.startsWith('palette.')))
    .map((x) => x.path)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** Short slug for a branch name from the draft. */
export function draftSlug(draft: Draft): string {
  const edits = draft.edits.filter((e) => e.kind !== 'docs');
  const first = edits[0];
  const base = first ? first.path.split('.').slice(-3).join('-') : 'tokens';
  return `${base}${edits.length > 1 ? `-and-${edits.length - 1}-more` : ''}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40);
}
