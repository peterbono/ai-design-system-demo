// Pull components: the coded components (component-specs.json on the base branch, generated from the TSX and CSS
// modules) become Figma component sets bound to the variables a pull writes. This file plans it; the main thread
// (src/main/build-components.ts) builds it. Pure: no DOM, no figma.*.
//
// Product rules (plugin README, "Pull components"):
// - Preview first: nothing is written before Apply. Every part that cannot be bound is listed with its reason.
// - Idempotent: a set is found again by shared plugin data (dsbridge / componentId), updated in place, never duplicated.
//   Variants removed in code are flagged "[orphan]", never deleted; layers outside generated sets are never touched.
// - After building, the set's signature is stored as its baseline, so a fresh pull never shows a request in Push.

import {
  type BridgeConfig,
  COLOR_FIELDS,
  type ComponentSpec,
  type ComponentSpecsFile,
  DEFAULT_COMPONENT_SPECS_FILE,
  type GitHubClient,
  type SpecAxis,
  type SpecField,
  type SpecPart,
  type SpecProperty,
  type TokenSet,
  defaultContext,
  parseColor,
  parseComponentSpecs,
  parseDimension,
  resolve,
  variantKeyOf,
  variantName,
} from '@bridge-ds/core';
import { COLLECTIONS, type FigmaResolvedType } from '../shared/messages';
import { isUnmappable, pathToName, tokenToPlanned } from './mapping';

/** A component set DS Bridge generated, as the main thread finds it (shared plugin data). */
export interface GeneratedSet {
  componentId: string;
  nodeId: string;
  name: string;
  page?: string | undefined;
  specHash: string;
  /** Variant keys (variantKeyOf) of the generated variants, orphans excluded. */
  variants: string[];
}

/** What a Figma field gets: a variable binding, a literal, a percent (unitless line height, em tracking), no paint, or a font. */
export type PlannedValue =
  | {
      kind: 'variable';
      path: string;
      tokenId: string;
      /** Figma variable name ("button/primary/bg"). */
      name: string;
      /** Collection of the token's tier ("Semantic"); the split layout ("Semantic/Light") is found from it. */
      collection: string;
      resolvedType: FigmaResolvedType;
      /** Value in the default modes, for the font style choice (font weight) and the preview. */
      value?: number | string | undefined;
    }
  | { kind: 'number'; value: number }
  | { kind: 'percent'; value: number; path: string }
  | { kind: 'none' }
  | { kind: 'font'; families: string[]; path: string };

export interface PlannedField {
  field: SpecField;
  value: PlannedValue;
}

export interface PlannedVariant {
  /** variantKeyOf(props): stored on the variant (dsbridge / variant). */
  key: string;
  /** Figma variant name, axis order: "Variant=primary, Size=md, State=Default". */
  name: string;
  props: Record<string, string>;
  /** Part id -> fields. */
  parts: Record<string, PlannedField[]>;
}

export type ComponentStatus = 'new' | 'updated' | 'unchanged';

export interface PlannedComponent {
  componentId: string;
  name: string;
  hash: string;
  status: ComponentStatus;
  nodeId?: string | undefined;
  description: string;
  axes: SpecAxis[];
  properties: SpecProperty[];
  parts: SpecPart[];
  variants: PlannedVariant[];
  /** Variant keys in Figma that code no longer has: flagged "[orphan]". */
  removedVariants: string[];
  /** Variant keys code added since the last pull. */
  addedVariants: string[];
}

export interface ComponentProblem {
  component: string;
  part: string;
  property: string;
  reason: string;
}

export interface ComponentPullPlan {
  /** Repo path the specs came from. */
  source: string;
  components: PlannedComponent[];
  /** Parts or properties that will not be bound, with the reason. Shown before anything is written. */
  problems: ComponentProblem[];
}

export interface ComponentApplyReport {
  created: number;
  updated: number;
  unchanged: number;
  /** Variants flagged "[orphan]". */
  orphaned: number;
  page: string;
  /** Bindings or fonts that failed in Figma. */
  problems: string[];
  /** Set once when a brand font is missing in this Figma and Inter replaced it. */
  fontNote?: string | undefined;
  /** Component set ids, created or updated. */
  nodeIds: string[];
}

// ---------------------------------------------------------------------------------------------
// Loading

/** component-specs.json at a tree (read through the git API like the token files), or undefined when the repo has none. */
export async function loadComponentSpecs(
  client: Pick<GitHubClient, 'getTree' | 'getBlobText'>,
  treeSha: string,
  config: BridgeConfig | undefined,
): Promise<{ path: string; specs: ComponentSpecsFile } | undefined> {
  const path = config?.components?.specs ?? DEFAULT_COMPONENT_SPECS_FILE;
  const { entries } = await client.getTree(treeSha, true);
  const entry = entries.find((e) => e.type === 'blob' && e.path === path);
  if (!entry) return undefined;
  return { path, specs: parseComponentSpecs(await client.getBlobText(entry.sha)) };
}

// ---------------------------------------------------------------------------------------------
// Planning

const TEXT_ONLY: ReadonlySet<SpecField> = new Set(['textFill', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']);

function numberValue(set: TokenSet, path: string): number | undefined {
  const r = resolve(set.byPath, path, defaultContext(set));
  if (typeof r.value === 'number') return r.value;
  const d = parseDimension(r.value);
  return d ? d.value : undefined;
}

function familiesOf(set: TokenSet, path: string): string[] | undefined {
  const r = resolve(set.byPath, path, defaultContext(set));
  const v = r.value;
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : undefined;
  return list?.map((x) => String(x).trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** How one spec value is written in Figma, or the reason it cannot be. */
export function planValue(field: SpecField, value: string | 0 | null, head: TokenSet): PlannedValue | { problem: string } {
  if (value === null) return COLOR_FIELDS.has(field) ? { kind: 'none' } : { problem: 'no value' };
  if (value === 0) return { kind: 'number', value: 0 };
  const t = head.byPath.get(value);
  if (!t) return { problem: `${value} is not a token on this branch` };
  if (field === 'fontFamily') {
    const families = familiesOf(head, value);
    return families?.length ? { kind: 'font', families, path: value } : { problem: `${value} does not resolve to a font family` };
  }
  // Unitless line heights and em letter spacing: Figma variables for these are pixels, so set a percent, unbound.
  if ((field === 'lineHeight' || field === 'letterSpacing') && t.type === 'number') {
    const n = numberValue(head, value);
    return n === undefined ? { problem: `${value} does not resolve to a number` } : { kind: 'percent', value: Math.round(n * 10000) / 100, path: value };
  }
  const planned = tokenToPlanned(t, head);
  if (isUnmappable(planned)) return { problem: `${value}: ${planned.reason}` };
  const wants: FigmaResolvedType = COLOR_FIELDS.has(field) ? 'COLOR' : 'FLOAT';
  if (planned.resolvedType !== wants) return { problem: `${value} is a ${planned.resolvedType} variable, ${field} needs ${wants}` };
  let resolved: number | string | undefined;
  if (wants === 'FLOAT') resolved = numberValue(head, value);
  else {
    const r = resolve(head.byPath, value, defaultContext(head));
    const c = parseColor(r.value);
    resolved = c ? `${[c.r, c.g, c.b].map((x) => Math.round(x * 255)).join(',')},${Math.round(c.a * 255)}` : undefined;
  }
  return {
    kind: 'variable',
    path: value,
    tokenId: t.id,
    name: pathToName(value),
    collection: COLLECTIONS[t.tier],
    resolvedType: planned.resolvedType,
    ...(resolved !== undefined ? { value: resolved } : {}),
  };
}

export function describeSpec(spec: ComponentSpec): string {
  const dir = spec.source[0]?.replace(/\/[^/]+$/, '') ?? spec.name;
  return `Generated by DS Bridge from ${dir}. Code is the source of truth: change it in code, or send a request from Push.`;
}

/** The pull plan for components: status per spec, every field resolved to a variable (or a reason it is not). */
export function buildComponentPlan(specs: ComponentSpecsFile, source: string, generated: GeneratedSet[], head: TokenSet): ComponentPullPlan {
  const problems: ComponentProblem[] = [];
  const seen = new Set<string>();
  const problem = (p: ComponentProblem) => {
    const k = `${p.component}|${p.part}|${p.property}|${p.reason}`;
    if (seen.has(k)) return;
    seen.add(k);
    problems.push(p);
  };
  const components: PlannedComponent[] = [];
  for (const spec of specs.components) {
    for (const u of spec.unmapped) problem({ component: spec.name, part: u.part, property: u.property, reason: u.reason });
    const kinds = new Map(spec.parts.map((p) => [p.id, p.kind]));
    const variants: PlannedVariant[] = spec.variants.map((v) => {
      const parts: Record<string, PlannedField[]> = {};
      for (const [part, values] of Object.entries(v.values)) {
        const fields: PlannedField[] = [];
        for (const [field, value] of Object.entries(values) as [SpecField, string | 0 | null][]) {
          if (TEXT_ONLY.has(field) !== (kinds.get(part) === 'text')) continue;
          const pv = planValue(field, value, head);
          if ('problem' in pv) problem({ component: spec.name, part, property: field, reason: pv.problem });
          else fields.push({ field, value: pv });
        }
        parts[part] = fields;
      }
      return { key: variantKeyOf(v.props), name: variantName(v.props), props: v.props, parts };
    });
    const existing = generated.find((g) => g.componentId === spec.name);
    const keys = new Set(variants.map((v) => v.key));
    const have = new Set(existing?.variants ?? []);
    const addedVariants = existing ? variants.map((v) => v.key).filter((k) => !have.has(k)) : [];
    const removedVariants = existing ? existing.variants.filter((k) => !keys.has(k)) : [];
    const status: ComponentStatus = !existing ? 'new' : existing.specHash === spec.hash && !addedVariants.length && !removedVariants.length ? 'unchanged' : 'updated';
    components.push({
      componentId: spec.name,
      name: spec.name,
      hash: spec.hash,
      status,
      ...(existing ? { nodeId: existing.nodeId } : {}),
      description: describeSpec(spec),
      axes: spec.axes,
      properties: spec.properties,
      parts: spec.parts,
      variants,
      removedVariants,
      addedVariants,
    });
  }
  return { source, components, problems };
}

/** Components a pull would write (new or updated). */
export const pendingComponents = (plan: ComponentPullPlan | undefined) => plan?.components.filter((c) => c.status !== 'unchanged') ?? [];

/** The plan with only the components to write: unchanged ones are not sent to the main thread. */
export function writablePlan(plan: ComponentPullPlan): ComponentPullPlan {
  return { ...plan, components: pendingComponents(plan) };
}
