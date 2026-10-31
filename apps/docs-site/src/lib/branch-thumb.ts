// The before/after thumbnail of a branch on the Studio home (Needs you rows, Your branches cards, the review queue).
// Pure: decides WHAT to draw from data already read (changed files, the token diff, the visual impact run); the
// drawing itself is components/ds/studio/BranchThumb.tsx. Unit tested in branch-thumb.test.ts.

export type ThumbIcon = 'component' | 'token' | 'guidance' | 'branch' | 'contrast' | 'person';

export type ThumbSpec =
  /** A colour token: swatch before | swatch after (resolved #rrggbb, null when added or removed). */
  | { kind: 'color'; token: string; before: string | null; after: string | null }
  /** A spacing token: bars of the before and after length (px). */
  | { kind: 'space'; token: string; before: number | null; after: number | null }
  /** A radius token: a shape with the before and after corner (px). */
  | { kind: 'radius'; token: string; before: number | null; after: number | null }
  /** A type token: "Aa" at the before and after size (px). */
  | { kind: 'type'; token: string; before: number | null; after: number | null }
  /** A component change the visual impact run captured: the before and after crops (absolute URLs). */
  | { kind: 'image'; before: string; after: string; label: string }
  /**
   * An explored screen (home-explorations): its capture, or, while there is none (src null), a plate naming the
   * changed screen and the product with a Field Guide drawing: honest, never a fake wireframe. `capturedAt`: when the
   * preview was captured (lib/preview-shots), said in small text on a card. `seed`: what picks the plate's drawing
   * (the exploration's key, "12" or "admin-app#2"), so a row of cards does not repeat one drawing and the
   * exploration page shows the drawing of its card.
   */
  | { kind: 'screen'; src: string | null; product?: string | null; screen?: string | null; capturedAt?: string | null; seed?: string | null }
  /** Usage guidance: lines of text. */
  | { kind: 'text' }
  /** Nothing to draw before/after: an icon, with what it stands for when known (a build request's component). */
  | { kind: 'icon'; icon: ThumbIcon; label?: string };

/** A changed token as lib/token-review TokenChangeRow gives it (only the fields read here). */
export interface ThumbToken {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  tier: string;
  context: string;
  before: { css: string | null; hex: string | null } | null;
  after: { css: string | null; hex: string | null } | null;
}

export interface ThumbInput {
  /** Changed file names, when read. */
  files?: string[] | null;
  /** The token diff, when read. */
  tokens?: ThumbToken[] | null;
  /** The biggest change of the visual impact run for the head commit, when it published one. */
  visual?: { before: string; after: string; label: string } | null;
  /** Only usage guidance changes. */
  guidance?: boolean;
  /** The theme the viewer sees: a token changed in several modes shows the matching one first. */
  theme?: 'light' | 'dark';
}

/** The Field Guide drawings a screen plate picks from: things being made, never a broken or empty screen. */
export const PLATE_DRAWINGS = ['paint', 'components', 'foundations', 'tokens', 'guide'] as const;
export type PlateDrawing = (typeof PLATE_DRAWINGS)[number];

/**
 * The drawing of a screen plate: one exploration always gets the same one (its card and its page), two explorations
 * most likely differ (a small string hash over the seed, else the screen's name, else the product).
 */
export function plateDrawing(spec: { screen?: string | null; seed?: string | null; product?: string | null }): PlateDrawing {
  const s = (spec.seed || spec.screen || spec.product || '').trim().toLowerCase();
  if (!s) return 'paint';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return PLATE_DRAWINGS[Math.abs(h) % PLATE_DRAWINGS.length]!;
}

const KIND_RANK: Record<ThumbToken['kind'], number> = { changed: 0, added: 1, removed: 2 };
const TIER_RANK: Record<string, number> = { semantic: 0, component: 1, primitive: 2 };

/** A CSS length in px: "16px" is 16, "1rem" and "1em" are 16 (root size), a bare number is px. Anything else is null. */
export function pxOf(css: string | null | undefined): number | null {
  if (css == null) return null;
  const m = /^\s*(-?\d*\.?\d+)\s*(px|rem|em)?\s*$/i.exec(css);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return (m[2] ?? 'px').toLowerCase() === 'px' ? n : n * 16;
}

/** A swatch colour from a shown value: the resolved hex, else a css value that is itself a hex. */
export function hexOf(v: { css: string | null; hex: string | null } | null | undefined): string | null {
  if (!v) return null;
  if (v.hex) return v.hex.toLowerCase();
  const css = v.css?.trim();
  return css && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(css) ? css.toLowerCase() : null;
}

export type TokenVisual = 'color' | 'space' | 'radius' | 'type' | null;

/** What a token draws as, from its path (a hex value makes it a colour whatever its name). Null: nothing to draw. */
export function tokenVisual(t: ThumbToken): TokenVisual {
  const parts = t.path.toLowerCase().split('.');
  const has = (re: RegExp) => parts.some((p) => re.test(p));
  if (has(/^colou?r$/) || hexOf(t.before) || hexOf(t.after)) return 'color';
  // Type before space: font.size and typography.*.size end in "size" too.
  if ((parts[0] === 'font' && parts[1] === 'size') || has(/^font-?size$/)) return 'type';
  if (parts[0] === 'typography') return parts[parts.length - 1] === 'size' ? 'type' : null;
  if (has(/radius$/)) return 'radius';
  if (
    parts[0] === 'space' ||
    parts[0] === 'size' ||
    has(/^(spacing|gap|inset|height|width)$/) ||
    has(/^(padding|margin)/) ||
    parts[parts.length - 1] === 'size'
  ) {
    return 'space';
  }
  return null;
}

/** The changed tokens in the order the thumbnail tries them: changed first, semantic tier first, the viewer's theme first. */
export function rankTokens(tokens: ThumbToken[], theme?: 'light' | 'dark'): ThumbToken[] {
  const ctx = (t: ThumbToken) => (!t.context || !theme || t.context === theme ? 0 : 1);
  return tokens
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        KIND_RANK[a.t.kind] - KIND_RANK[b.t.kind] ||
        (TIER_RANK[a.t.tier] ?? 3) - (TIER_RANK[b.t.tier] ?? 3) ||
        ctx(a.t) - ctx(b.t) ||
        a.i - b.i,
    )
    .map((x) => x.t);
}

function tokenSpec(t: ThumbToken): ThumbSpec | null {
  const visual = tokenVisual(t);
  if (visual === 'color') {
    const before = hexOf(t.before);
    const after = hexOf(t.after);
    return before || after ? { kind: 'color', token: t.path, before, after } : null;
  }
  if (visual) {
    const before = pxOf(t.before?.css);
    const after = pxOf(t.after?.css);
    return before != null || after != null ? { kind: visual, token: t.path, before, after } : null;
  }
  return null;
}

/** Scale that fits the larger of two sizes into `max` px, never enlarging, so both keep their ratio. */
export function fitScale(a: number | null, b: number | null, max: number): number {
  const big = Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0));
  return big > max ? max / big : 1;
}

const isChangeset = (f: string) => f.startsWith('.changeset/') && f.endsWith('.md');
const isGuidanceFile = (f: string) => f.endsWith('.docs.json') || isChangeset(f);

export function branchThumb(input: ThumbInput): ThumbSpec {
  const tokens = input.tokens ?? [];
  const files = input.files ?? [];
  if (tokens.length) {
    // The main token is the first candidate with something to draw; a token we cannot draw is still a token.
    for (const t of rankTokens(tokens, input.theme)) {
      const spec = tokenSpec(t);
      if (spec) return spec;
    }
    return { kind: 'icon', icon: 'token' };
  }
  if (input.visual) return { kind: 'image', before: input.visual.before, after: input.visual.after, label: input.visual.label };
  // Guidance before components: Name.docs.json lives in the component folder but changes words, not pixels.
  if (input.guidance || (files.length && files.every(isGuidanceFile) && files.some((f) => f.endsWith('.docs.json')))) {
    return { kind: 'text' };
  }
  if (files.some((f) => f.startsWith('packages/react/src/components/'))) return { kind: 'icon', icon: 'component' };
  // The changeset rides along with any change, so it does not stop a token-only branch from reading as one.
  const own = files.filter((f) => !isChangeset(f));
  if (own.length && own.every((f) => f.startsWith('packages/tokens/src/'))) return { kind: 'icon', icon: 'token' };
  return { kind: 'icon', icon: 'branch' };
}
