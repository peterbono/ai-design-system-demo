// Words of the "Create branch" dialog in Studio Tokens, as pure functions (tested in propose-copy.test.ts):
// a plain title drafted from the edit ("Darker primary action fill") and the sentence that says who approves it,
// from the configured rights. No DOM.
import type { OwnerGroup, Rights } from '@bridge-ds/core';

/** One draft edit, reduced to what the title needs. Values are resolved in the edited mode. */
export interface TitleEdit {
  kind: 'value' | 'description' | 'rename' | 'delete' | 'add';
  path: string;
  /** DTCG $type of the token ("color", "dimension", "duration"...). */
  type?: string | undefined;
  /** Resolved before and after: a hex for colors, a number for dimensions and durations. */
  before?: string | number | undefined;
  after?: string | number | undefined;
}

const ROLE_FIRST: Record<string, string> = { bg: 'background', surface: 'surface', text: 'text', border: 'border' };
const PART: Record<string, string> = { bg: 'fill', text: 'text', border: 'border', icon: 'icon', solid: 'solid fill', fg: 'mark', track: 'track', thumb: 'thumb' };
const KEEP_LAST = new Set(['width', 'height', 'color', 'size', 'offset', 'max-width', 'stroke']);
const words = (s: string) => s.split('-').filter(Boolean);

/**
 * What a token paints, in words: "color.action.primary.bg" -> "primary action fill", "color.bg.subtle" -> "subtle
 * background", "radius.control" -> "control radius", "motion.duration.fast" -> "fast motion duration".
 */
export function tokenNoun(path: string): string {
  const segs = path.split('.').filter(Boolean);
  const [cat, ...rest] = segs;
  if (!cat) return path;
  if (cat === 'palette') return [...rest.flatMap(words), 'palette color'].join(' ');
  if (cat === 'color' && rest.length) {
    if (ROLE_FIRST[rest[0]!]) return [...rest.slice(1).flatMap(words), ROLE_FIRST[rest[0]!]].join(' ');
    const last = rest[rest.length - 1]!;
    const [part, ...state] = words(last);
    const partWord = part ? PART[part] : undefined;
    if (partWord && rest.length >= 2) return [...rest.slice(1, -1).flatMap(words), ...words(rest[0]!), ...state, partWord].join(' ');
    return [...rest.flatMap(words), 'color'].join(' ');
  }
  if (!rest.length) return words(cat).join(' ');
  const last = rest[rest.length - 1]!;
  if (/^\d/.test(last) || KEEP_LAST.has(last)) return segs.flatMap(words).join(' ');
  return [...words(last), ...segs.slice(0, -1).flatMap(words)].join(' ');
}

/** Relative luminance of a #rrggbb color (WCAG), or undefined. */
function luminance(hex: string): number | undefined {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** "Darker", "Lighter", "Larger", "Shorter"... or "New" when the direction is unknown or mixed. */
function direction(e: TitleEdit): string {
  const { before, after } = e;
  if (typeof before === 'string' && typeof after === 'string') {
    const a = luminance(before);
    const b = luminance(after);
    if (a === undefined || b === undefined || Math.abs(a - b) < 0.002) return 'New';
    return b < a ? 'Darker' : 'Lighter';
  }
  if (typeof before === 'number' && typeof after === 'number' && before !== after) {
    if (e.type === 'duration') return after > before ? 'Longer' : 'Shorter';
    return after > before ? 'Larger' : 'Smaller';
  }
  return 'New';
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Title of one token's edits (several modes of one token count as one change). */
function titleOf(path: string, edits: TitleEdit[]): string {
  const noun = tokenNoun(path);
  const kinds = new Set(edits.map((e) => e.kind));
  if (kinds.has('add')) return `New ${noun} token`;
  if (kinds.has('delete')) return `Remove the ${noun} token`;
  if (kinds.has('rename')) return `Rename the ${noun} token`;
  const values = edits.filter((e) => e.kind === 'value');
  if (!values.length) return `New description for the ${noun}`;
  const dirs = [...new Set(values.map(direction))];
  return `${dirs.length === 1 ? dirs[0] : 'New'} ${noun}`;
}

/**
 * A plain title for the change: "Darker primary action fill", "Larger control radius", or with several tokens
 * "Darker primary action fill and 2 more changes". Empty when there is no edit.
 */
export function proposalTitle(edits: TitleEdit[]): string {
  const byPath = new Map<string, TitleEdit[]>();
  for (const e of edits) (byPath.get(e.path) ?? byPath.set(e.path, []).get(e.path)!).push(e);
  const paths = [...byPath.keys()];
  if (!paths.length) return '';
  const first = cap(titleOf(paths[0]!, byPath.get(paths[0]!)!));
  const more = paths.length - 1;
  return more ? `${first} and ${more} more change${more === 1 ? '' : 's'}` : first;
}

/** The pull request title: the plain title behind the repo's conventional "tokens:" prefix. */
export function prTitleFrom(title: string): string {
  const t = title.trim();
  if (!t) return '';
  if (/^[a-z]+(\([^)]*\))?!?:\s/i.test(t)) return t;
  return `tokens: ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

const WHO: Record<OwnerGroup, string> = { design: 'a design owner', tech: 'a tech owner' };

/** "a design owner", "a tech owner", "a design owner or a tech owner". */
function who(groups: readonly OwnerGroup[]): string {
  const list = groups.length ? groups : (['design'] as OwnerGroup[]);
  return list.map((g) => WHO[g]).join(' or ');
}

/**
 * Who approves a change sent from Studio, from its risk tier and `governance.rights`. Tier 3 (every token value,
 * add, rename or delete): a design and a tech approval, "A design owner and a tech owner approve it before it
 * reaches the library." Tier 2 (new component, variant or prop) too. Tier 1 (a description only): one approval.
 * In suggest mode the end says who applies it: "..., then a developer applies it to the code." A token value change
 * (`valuesOnly`: values changed or tokens added, nothing renamed or removed, decision TV-1) needs the design approval
 * only: "A design owner approves it, then it reaches the library once the automatic checks pass."
 */
export function reviewSentence(tier: 1 | 2 | 3, rights?: Rights | null, mode: 'suggest' | 'direct' = 'direct', valuesOnly = false): string {
  const end = mode === 'suggest' ? ', then a developer applies it to the code.' : ' before it reaches the library.';
  if (tier === 1) return `One reviewer approves it${end}`;
  const designGroups = rights?.approveDesign ?? ['design'];
  if (valuesOnly) return `${cap(who(designGroups))} approves it${mode === 'suggest' ? end : ', then it reaches the library once the automatic checks pass.'}`;
  const techGroups = rights?.approveTech ?? ['tech'];
  const design = who(designGroups);
  const tech = who(techGroups);
  if (design === tech) return `${cap(design)} approves the design and the code${end}`;
  if (designGroups.length > 1 || techGroups.length > 1) return `${cap(design)} approves the design and ${tech} the code${end}`;
  return `${cap(design)} and ${tech} approve it${end}`;
}

/** The suggestion title: the plain title as the designer wrote it, without a conventional "tokens:" prefix. */
export function suggestionTitleFrom(title: string): string {
  const t = title.trim().replace(/^[a-z]+(\([^)]*\))?!?:\s+/i, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
