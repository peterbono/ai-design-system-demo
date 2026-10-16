// Library foundation pages (Color, Typography, Spacing, Radius, Elevation): the words one token row shows, as pure
// functions. Alias summary ("neutral 50 · 950"), one-line role, usage chip and the "Copy as" formats. No file system,
// no DOM: unit tested in library-rows.test.ts. lib/foundations.ts feeds them from the token files at build time.
import { codeSyntax } from './explorer/format';
import type { ComponentLink } from './explorer/model';
import type { Tier } from '@bridge-ds/core';

/** Roots that carry no meaning in a short alias label: "palette.neutral.50" reads as "neutral 50". */
const QUIET_ROOTS = new Set(['palette', 'color']);

/** "palette.neutral.50" -> ["neutral", "50"], "border.width.2" -> ["border width", "2"]. */
function aliasParts(path: string): [string, string] {
  const segs = path.split('.');
  const rest = segs.length > 2 && QUIET_ROOTS.has(segs[0]!) ? segs.slice(1) : segs;
  if (rest.length === 1) return ['', rest[0]!];
  return [rest.slice(0, -1).join(' '), rest[rest.length - 1]!];
}

/**
 * Muted alias line of a row: the first hop of each mode, without arrows. Same role in both modes collapses to
 * "neutral 50 · 950", the same target to "neutral 0", different roles stay whole ("primary 900 · neutral 100").
 * Literal values (no alias) leave their side out.
 */
export function aliasSummary(light?: string | null, dark?: string | null): string {
  const a = light ?? undefined;
  const b = dark ?? undefined;
  if (!a && !b) return '';
  if (!a || !b || a === b) return aliasParts((a ?? b)!).filter(Boolean).join(' ');
  const [ra, sa] = aliasParts(a);
  const [rb, sb] = aliasParts(b);
  if (ra === rb) return `${[ra, sa].filter(Boolean).join(' ')} · ${sb}`;
  return `${[ra, sa].filter(Boolean).join(' ')} · ${[rb, sb].filter(Boolean).join(' ')}`;
}

const PART: Record<string, string> = {
  bg: 'fill',
  'bg-hover': 'fill on hover',
  'bg-active': 'fill when pressed',
  text: 'label',
  border: 'edge',
  fg: 'mark',
};

const FEEDBACK_PART: Record<string, string> = {
  bg: 'background',
  border: 'edge',
  text: 'text',
  icon: 'icon',
  solid: 'solid fill, for compact labels like badges',
};

/** Roles of tokens whose files carry no $description yet. A $description always wins. */
const KNOWN: Record<string, string> = {
  'color.text.default': 'Body text and icons.',
  'color.text.link': 'Links in running text.',
  'color.text.link-hover': 'Links on hover.',
  'color.control.thumb': 'Switch thumb and slider handle.',
  'focus.ring.width': 'Width of the focus ring.',
  'focus.ring.offset': 'Gap between a control and its focus ring.',
  'border-width.default': 'Hairline edges: cards, inputs, dividers.',
  'border-width.strong': 'Emphasis edges and selected states.',
  'border-width.indicator': 'Active indicators: the current tab, the current page.',
};

const sentence = (s: string) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}` : '');

/**
 * One-line role of a token: its $description, else a known role, else a phrase built from its path
 * ("color.action.primary.bg-hover" -> "Primary action fill on hover."). Empty when nothing reliable can be said.
 */
export function roleOf(path: string, description?: string): string {
  if (description?.trim()) return sentence(description.trim().split(/(?<=\.)\s/)[0]!);
  if (KNOWN[path]) return KNOWN[path]!;
  const s = path.split('.');
  if (s[0] === 'color' && s[1] === 'action' && s.length === 4) {
    const part = PART[s[3]!];
    if (part) return sentence(`${s[2]} action ${part}`);
  }
  if (s[0] === 'color' && s[1] === 'feedback' && s.length === 4) {
    const part = FEEDBACK_PART[s[3]!];
    if (part) return sentence(`${s[2]} message ${part}`);
  }
  if (s[0] === 'color' && s[1] === 'control' && s[2] === 'checked' && s[3]) {
    const part = PART[s[3]];
    if (part) return sentence(`checked control ${part}`);
  }
  return '';
}

export interface UsageInput {
  /** Components that read the token, directly or through a token that aliases it. */
  components: readonly ComponentLink[];
  /** Global stylesheets (base styles) that read it, directly or through an alias. */
  base: readonly string[];
  /** In use by the shared definition (@bridge-ds/core tokenUsage). */
  used: boolean;
}

export interface UsageChip {
  kind: 'components' | 'base' | 'unused';
  label: string;
}

/**
 * The neutral usage chip of a row. Components win ("3 components"); a token only the base styles read (the page
 * background) says "Base styles" instead of claiming nobody uses it; "Unused" only when tokenUsage agrees.
 */
export function usageChip(u: UsageInput): UsageChip {
  const n = u.components.length;
  if (n) return { kind: 'components', label: `${n} component${n === 1 ? '' : 's'}` };
  if (u.base.length || u.used) return { kind: 'base', label: 'Base styles' };
  return { kind: 'unused', label: 'Unused' };
}

export type CopyFormat = 'css' | 'js' | 'figma';
export const COPY_FORMATS: CopyFormat[] = ['css', 'js', 'figma'];
export const COPY_LABEL: Record<CopyFormat, string> = { css: 'CSS', js: 'JS', figma: 'Figma' };

/** What clicking a token name copies, per format: the CSS variable, the @bridge-ds/tokens reference, the Figma variable. */
export function copyValue(path: string, tier: Tier, format: CopyFormat): string {
  if (format === 'figma') return path.split('.').join('/');
  return codeSyntax(path, tier, format);
}

/** Reads a stored format, falling back to CSS for anything unknown. */
export const parseCopyFormat = (v: string | null | undefined): CopyFormat => (COPY_FORMATS.includes(v as CopyFormat) ? (v as CopyFormat) : 'css');

const GROUP_TITLE: Record<string, string> = {
  'color.bg': 'Background',
  'color.surface': 'Surface',
  'color.text': 'Text',
  'color.border': 'Border',
  'color.action': 'Action',
  'color.control': 'Controls',
  'color.signal': 'Signal',
  'color.overlay': 'Overlay',
  'color.feedback': 'Feedback',
  'color.selection': 'Selection',
  focus: 'Focus',
  'focus.ring': 'Focus',
};

/** Human title of a token group: "color.bg" -> "Background". Unknown groups use their last segment. */
export function groupTitle(group: string): string {
  if (GROUP_TITLE[group]) return GROUP_TITLE[group]!;
  const last = group.split('.').pop() ?? group;
  return sentence(last.replace(/-/g, ' ')).replace(/\.$/, '');
}
