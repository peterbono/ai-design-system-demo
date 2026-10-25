// Push components from Figma: a component change found by the scan (baseline vs Figma now, the same signatures Pull
// compares in "Review updates", read the other way) becomes a structured diff and a route (planComponentPush in
// @bridge-ds/core): an exact token change, a library branch Claude AI drafts, or something to fix in Figma first.
// Pure: no DOM, no figma.* (the UI and the main thread wire it).
//
// Product rules (plugin README, "Push components"):
// - Exact, no AI: only token swaps on properties code paints through a component token used nowhere else. That token
//   then points to the new variable: a token change, gated for contrast like every token change.
// - Drafted by Claude AI, reviewed by a person: new variants, properties, layers, swapped instances, new components,
//   and token swaps a token alone cannot express. The library branch carries the spec; Claude writes the code there.
// - Unknown or ambiguous edits (a detached layer, a raw value, a style, a variable code lacks) are listed with what to
//   do, never sent and never dropped.
// - After the library branch ships, a pull rebuilds the component from the reviewed code (never diverge).

import {
  type BridgeConfig,
  type ComponentPushDiff,
  type ComponentPushPlan,
  type ContrastPair,
  LayeredTokenSet,
  type PushIssue,
  type PushTokenContext,
  type Rebind,
  type RepoFiles,
  type TokenSet,
  aliasTarget,
  componentContrastPairs,
  isAlias,
  planComponentPush,
  planTokenProposal,
} from '@bridge-ds/core';
import { type ComponentChangeItem, type ComponentSignature, type ScannedComponent, decodeOutlineItem, diffOutlines, newRawValues, rawKey, tokenName } from './components';

/** Figma variable name to token path ("button/primary/bg" -> "button.primary.bg"); styles keep their "style:" prefix. */
const pathOf = (variable: string) => (variable.startsWith('style:') ? variable : variable.replace(/\//g, '.'));
const isStyle = (v: string) => v.startsWith('style:');
const sortedUnique = (xs: string[]) => [...new Set(xs)].sort();

/** Variants where a swap or a layer change explains the bindings that moved: those are not token swaps. */
function explainedVariants(base: ComponentSignature, cur: ComponentSignature): Set<string> {
  const out = new Set<string>();
  for (const key of Object.keys(cur.variants)) {
    const b = base.variants[key];
    const c = cur.variants[key]!;
    if (!b) continue;
    const swapped = Object.keys(c.slots ?? {}).some((part) => b.slots?.[part] !== undefined && b.slots[part] !== c.slots![part]);
    const layers = b.outline && c.outline ? diffOutlines(b.outline, c.outline) : [];
    if (swapped || layers.some((x) => x.op !== 'moved')) out.add(key);
  }
  return out;
}

/** Token swaps between the baseline and Figma now, one row per property kind and before/after, with their variants. */
export function rebindsOf(base: ComponentSignature, cur: ComponentSignature, matches: Record<string, string[]> = {}): Rebind[] {
  const skip = explainedVariants(base, cur);
  const common = Object.keys(cur.variants).filter((k) => base.variants[k]).sort();
  const rows = new Map<string, Rebind>();
  for (const key of common) {
    if (skip.has(key)) continue;
    const b = base.variants[key]!.bindings;
    const c = cur.variants[key]!.bindings;
    for (const kind of sortedUnique([...Object.keys(b), ...Object.keys(c)])) {
      const before = sortedUnique((b[kind] ?? []).map(pathOf));
      const after = sortedUnique((c[kind] ?? []).map(pathOf));
      if (before.join() === after.join()) continue;
      // Only what moved: a variable kept on another layer of the same kind is not part of the swap.
      const gone = before.filter((v) => !after.includes(v));
      // A value set by hand came where a variable went: the property was unbound. Said with the value, and the
      // variables that hold it.
      const raw = gone.length ? newRawValues(base.variants[key]!, cur.variants[key]!, kind) : [];
      // Rebound to a variable another layer of the variant already uses (color.bg.muted): nothing is new, yet the
      // property is still bound. Say every variable it may use now, never "a raw value".
      const added = !raw.length && gone.length && after.length && after.every((v) => before.includes(v)) ? after : after.filter((v) => !before.includes(v));
      const id = `${kind}\u0000${gone.join()}\u0000${added.join()}\u0000${raw.join()}`;
      const row: Rebind = rows.get(id) ?? {
        kind,
        variants: [],
        allVariants: false,
        before: gone,
        after: added,
        ...(raw.length ? { raw: raw.map((value) => ({ value, ...(matches[rawKey(kind, value)]?.length ? { matches: matches[rawKey(kind, value)] } : {}) })) } : {}),
      };
      row.variants.push(key);
      rows.set(id, row);
    }
  }
  return [...rows.values()].map((r) => ({ ...r, allVariants: r.variants.length === common.length && common.length > 1 }));
}

/** Edits the scan cannot read with confidence: detached layers, styles, a look no variable explains. */
export function unknownOf(item: Pick<ComponentChangeItem, 'changes' | 'signature' | 'baseline'>): PushIssue[] {
  const out: PushIssue[] = [];
  const base = item.baseline;
  if (base) {
    const detached = new Map<string, string[]>();
    for (const [key, c] of Object.entries(item.signature.variants)) {
      const b = base.variants[key];
      if (!b?.outline || !c.outline) continue;
      const d = diffOutlines(b.outline, c.outline);
      for (const r of d.filter((x) => x.op === 'removed' && x.item.id.startsWith('part:'))) {
        if (d.some((x) => x.op === 'added' && x.item.name === r.item.name && !x.item.id.startsWith('part:'))) detached.set(r.item.name, [...(detached.get(r.item.name) ?? []), key]);
      }
    }
    for (const [name, variants] of detached) {
      out.push({ what: `"${name}" was detached from its component in ${variants.length === Object.keys(item.signature.variants).length && variants.length > 1 ? 'every variant' : variants.join('; ')}.`, todo: 'Undo the detach (right click, Reset instance), then make the change with the component properties, or describe it in a request.' });
    }
  }
  const styles = sortedUnique(Object.values(item.signature.variants).flatMap((v) => Object.values(v.bindings).flat()).filter(isStyle));
  const baseStyles = new Set(base ? Object.values(base.variants).flatMap((v) => Object.values(v.bindings).flat()).filter(isStyle) : []);
  const newStyles = styles.filter((s) => !baseStyles.has(s));
  if (newStyles.length) out.push({ what: `It now uses ${newStyles.map((s) => tokenName(s)).join(', ')}: Bridge reads variables, not shared styles.`, todo: 'Bind the property to a variable instead of the style, then push again.' });
  for (const c of item.changes) {
    if (/^Look of /.test(c.field)) out.push({ what: `${c.field.replace(/^Look of /, 'The look of ')} changed with the same variables: a value was set by hand.`, todo: 'Bind that value to a variable (or reset it), then push again.' });
  }
  return out;
}

const CODE_ROW = /^(Variant |Prop |New layer |Removed layer |Moved layer |Swapped instance)/;

/** Whether the change needs code beyond token swaps: a new component, variants, properties, layers or swaps. */
function needsCode(item: Pick<ComponentChangeItem, 'kind' | 'changes'>, issues: PushIssue[]): boolean {
  if (item.kind === 'new-component') return true;
  const detachedNames = issues.flatMap((i) => /^"(.+)" was detached/.exec(i.what)?.[1] ?? []);
  return item.changes.some((c) => CODE_ROW.test(c.field) && !detachedNames.some((n) => c.field.includes(`layer "${n}"`)));
}

/** Layers of a variant in words: `instance Icon/Pencil "Icon"`, `text "Label"`. */
const anatomyOf = (outline: string[] | undefined) =>
  (outline ?? []).map((s) => {
    const i = decodeOutlineItem(s);
    return `${i.type.toLowerCase().replace(/_/g, ' ')}${i.main ? ` ${i.main}` : ''} "${i.name}"${i.visibleProp ? ` (shown by ${i.visibleProp})` : ''}`;
  });

/** The structured diff of a component change: what the library branch carries as its spec. */
export function pushDiffOf(
  item: ComponentChangeItem,
  ctx: { coded: readonly string[]; title: string; summary: string; line?: string | undefined; fileKey?: string | undefined; requestedBy?: string | undefined },
): ComponentPushDiff {
  const s = item.signature;
  const unknown = unknownOf(item);
  const url = ctx.fileKey ? `https://www.figma.com/design/${ctx.fileKey}/?node-id=${encodeURIComponent(item.nodeId.replace(/:/g, '-'))}` : undefined;
  const bindings: ComponentPushDiff['bindings'] = {};
  const anatomy: ComponentPushDiff['anatomy'] = {};
  for (const [key, v] of Object.entries(s.variants)) {
    bindings[key] = Object.fromEntries(Object.entries(v.bindings).map(([k, xs]) => [k, xs.map(pathOf)]));
    if (v.outline) anatomy[key] = anatomyOf(v.outline);
  }
  return {
    v: 1,
    component: item.component,
    figmaName: item.figmaName,
    coded: ctx.coded.includes(item.component),
    kind: item.kind,
    title: ctx.title,
    summary: ctx.summary,
    ...(ctx.line ? { line: ctx.line } : {}),
    changes: item.changes,
    rebinds: item.baseline ? rebindsOf(item.baseline, s, item.matches) : [],
    needsCode: needsCode(item, unknown),
    unknown,
    figma: { nodeId: item.nodeId, nodeName: item.figmaName, ...(ctx.fileKey ? { fileKey: ctx.fileKey } : {}), ...(url ? { url } : {}) },
    variantAxes: s.variantAxes,
    properties: s.properties,
    bindings,
    anatomy,
    ...(item.baseline ? { before: { variantAxes: item.baseline.variantAxes, properties: item.baseline.properties } } : {}),
    source: 'figma',
    ...(ctx.requestedBy ? { requestedBy: ctx.requestedBy } : {}),
  };
}

/**
 * Token facts for the plan: the tier of a token on the base branch, and where else a token paints in this file (other
 * variants of the component that still use it, other components that use it).
 */
export function tokenContext(head: Pick<TokenSet, 'byPath'>, item: Pick<ComponentChangeItem, 'nodeId' | 'signature' | 'baseline'>, scanned: readonly Pick<ScannedComponent, 'nodeId' | 'name' | 'signature' | 'baseline'>[]): PushTokenContext {
  return {
    tierOf: (path) => head.byPath.get(path)?.tier,
    usedElsewhere: (path, r) => {
      const variable = path.replace(/\./g, '/');
      const uses = (v: { bindings: Record<string, string[]> } | undefined) => !!v && Object.values(v.bindings).some((xs) => xs.includes(variable));
      const variants: string[] = [];
      const components: string[] = [];
      // Variants outside the swap that still paint with it (in Figma now), or painted with it in the baseline.
      for (const [key, v] of Object.entries(item.signature.variants)) if (!r.variants.includes(key) && (uses(v) || uses(item.baseline?.variants[key]))) variants.push(key);
      // Other components of the file that share the token (IconButton uses button tokens): they change with it.
      for (const c of scanned) {
        if (c.nodeId === item.nodeId) continue;
        if (Object.values(c.signature.variants).some(uses) || Object.values(c.baseline?.variants ?? {}).some(uses)) components.push(c.name);
      }
      return { variants, components };
    },
  };
}

/** What Push shows and sends for one component change: its diff, its route, and why a token change is held back. */
export interface ComponentPush {
  nodeId: string;
  diff: ComponentPushDiff;
  plan: ComponentPushPlan;
  /** A token change that would break the gate (a contrast pair that starts failing): not sent. */
  blocked?: string | undefined;
}

/** The library's token files on the base branch, as the shared token proposal reads them. Null without bridge.config.json. */
export function libraryTokens(files: Pick<RepoFiles, 'config' | 'files'>): { before: LayeredTokenSet; config: BridgeConfig } | null {
  if (!files.config) return null;
  return { before: new LayeredTokenSet(files.config, new Map(Object.entries(files.files))), config: files.config };
}

/** contrast.checks.json plus the component pairs a token swap moves (componentContrastPairs in @bridge-ds/core). */
export function pushPairs(head: Pick<TokenSet, 'byPath'>, pairs: ContrastPair[], edits: { path: string }[]): ContrastPair[] {
  const aliasOf = (path: string) => {
    const t = head.byPath.get(path);
    const v = t ? Object.values(t.values)[0] : undefined;
    return isAlias(v) ? aliasTarget(v) : undefined;
  };
  return [...pairs, ...componentContrastPairs(edits, pairs, { aliasOf, paths: [...head.byPath.keys()] })];
}

/** The route of each component change, with the contrast gate run on the token changes. */
export function componentPushes(
  items: ComponentChangeItem[],
  ctx: { head: Pick<TokenSet, 'byPath'>; files: Pick<RepoFiles, 'config' | 'files'>; pairs: ContrastPair[]; scanned: readonly ScannedComponent[]; coded: readonly string[]; fileKey?: string | undefined; text: (item: ComponentChangeItem) => { title: string; summary: string; line?: string | undefined } },
): ComponentPush[] {
  const lib = libraryTokens(ctx.files);
  return items.map((item) => {
    const diff = pushDiffOf(item, { coded: ctx.coded, fileKey: ctx.fileKey, ...ctx.text(item) });
    let plan = planComponentPush(diff, tokenContext(ctx.head, item, ctx.scanned));
    let blocked: string | undefined;
    if (plan.route === 'token-change') {
      // No bridge.config.json: the shared token write cannot plan it, so Claude AI makes the token swap on a branch.
      if (!lib) plan = { ...plan, route: 'claude-draft', said: 'A developer makes the token swap with Claude: Bridge cannot write it exactly in this design system yet.' };
      else {
        const p = planTokenProposal({ before: lib.before, pairs: pushPairs(ctx.head, ctx.pairs, plan.edits), edits: plan.edits, title: diff.title, config: lib.config, tool: 'the Bridge Figma plugin' });
        if (p?.blocked) blocked = `Not sent: ${p.blocked}. Pick another variable, or ask for a review in a request.`;
        else if (!p) plan = { ...plan, route: 'manual', said: 'The library already paints it this way: nothing to send.', edits: [] };
      }
    }
    return { nodeId: item.nodeId, diff, plan, ...(blocked ? { blocked } : {}) };
  });
}

/** Push tab wording of a route: the tag on the row. */
export const ROUTE_TAG: Record<ComponentPushPlan['route'], string> = { 'token-change': 'Exact token change', 'claude-draft': 'A developer builds it', manual: 'Fix in Figma' };
