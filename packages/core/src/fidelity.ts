// Fidelity check: does a component built in Figma look like the code? Compares a Figma export of one variant with
// an image of the same variant rendered from code (the Storybook reference images, see fidelity-references.ts).
// Pure and dependency free: images are plain RGBA buffers, decoded by the caller (a canvas in the plugin, pngjs in
// Node). The result shapes are JSON so a report can be stored and shown later (Studio Quality, follow-up).

/** An RGBA image, 4 bytes per pixel, row by row (ImageData, pngjs and canvas all use this layout). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface Size {
  width: number;
  height: number;
}

export interface CompareOptions {
  /** Export scale of both images (device pixels per CSS pixel). Sizes are reported in CSS pixels. Default 2. */
  scale?: number;
  /**
   * Color distance under which two pixels are the same, 0 to 1 (YIQ, as pixelmatch). Default 0.1: absorbs gamma
   * and antialiasing ramps, catches a token swap (a gray one step away is about 0.12).
   */
  threshold?: number;
  /**
   * Neighborhood, in device pixels, searched for a matching pixel before one counts as different. Figma and Chrome
   * rasterize text and curves differently (glyph hinting, subpixel positions, corner antialiasing): a pixel that has
   * its twin within this distance is the same shape drawn half a pixel away. Default: one CSS pixel (= scale).
   */
  radius?: number;
  /** Largest share of different pixels, in percent, that still matches. Default 3. */
  maxPercent?: number;
  /** Largest size difference per side, in CSS pixels, that still matches. Default 1. */
  sizeTolerance?: number;
  /** Also return the diff overlay. Default true. */
  diffImage?: boolean;
}

export interface ImageCompareResult {
  matches: boolean;
  /** Different pixels in percent of the larger canvas, two decimals. */
  percent: number;
  differentPixels: number;
  totalPixels: number;
  /** CSS pixel sizes (image size divided by the scale, rounded). */
  size: { figma: Size; code: Size };
  sizeMatches: boolean;
  /** The code image faded to gray with different pixels in red, on the larger canvas. */
  diff?: RgbaImage | undefined;
}

export const FIDELITY_DEFAULTS = { scale: 2, threshold: 0.1, maxPercent: 3, sizeTolerance: 1 } as const;

// Largest YIQ squared distance (black vs white), as in pixelmatch.
const MAX_DELTA = 35215;
// Outside the overlap of two sizes: only near-white (transparent) pixels are the same.
const STRICT_THRESHOLD = 0.02;

/** Pixel `i` of an image composited over white, or white outside the image. */
function rgbAt(img: RgbaImage, x: number, y: number): [number, number, number] {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [255, 255, 255];
  const i = (y * img.width + x) * 4;
  const a = img.data[i + 3]! / 255;
  return [255 + (img.data[i]! - 255) * a, 255 + (img.data[i + 1]! - 255) * a, 255 + (img.data[i + 2]! - 255) * a];
}

/** YIQ squared distance between two opaque colors (pixelmatch's perceptual metric). */
export function colorDelta(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
  const i = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
  const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;
  return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
}

/** Whether color `c` appears in `img` within `radius` pixels of (x, y). */
function foundNear(img: RgbaImage, x: number, y: number, c: [number, number, number], radius: number, max: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (colorDelta(c, rgbAt(img, x + dx, y + dy)) <= max) return true;
  return false;
}

/**
 * Compares a Figma export with the code reference of the same variant. A pixel differs when its color is not found
 * near the same place in the other image, in either direction: a shape drawn half a pixel away, or text rasterized
 * a little differently, matches; a missing border, another color, other padding or a different size does not.
 * Pixels outside the smaller image count as transparent: there, any visible color differs (a missing footer is a
 * difference even when its gray is light).
 */
export function compareImages(figma: RgbaImage, code: RgbaImage, options: CompareOptions = {}): ImageCompareResult {
  const scale = options.scale ?? FIDELITY_DEFAULTS.scale;
  const radius = Math.max(0, Math.round(options.radius ?? scale));
  const max = MAX_DELTA * (options.threshold ?? FIDELITY_DEFAULTS.threshold) ** 2;
  const strict = MAX_DELTA * STRICT_THRESHOLD ** 2;
  const width = Math.max(figma.width, code.width);
  const height = Math.max(figma.height, code.height);
  const total = width * height;
  const wantDiff = options.diffImage !== false;
  const out = wantDiff ? new Uint8ClampedArray(total * 4) : undefined;
  let different = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = rgbAt(figma, x, y);
      const b = rgbAt(code, x, y);
      // Where only one image has pixels (a size difference), any visible color counts: a light surface on white is
      // a missing part, not antialiasing.
      const m = x < Math.min(figma.width, code.width) && y < Math.min(figma.height, code.height) ? max : strict;
      const same = colorDelta(a, b) <= m || (foundNear(code, x, y, a, radius, m) && foundNear(figma, x, y, b, radius, m));
      if (!same) different++;
      if (out) {
        const o = (y * width + x) * 4;
        if (same) {
          // The code image, faded: light gray context for the red marks.
          const gray = 255 + ((b[0] * 0.299 + b[1] * 0.587 + b[2] * 0.114) - 255) * 0.1;
          out[o] = out[o + 1] = out[o + 2] = gray;
        } else {
          out[o] = 220;
          out[o + 1] = 38;
          out[o + 2] = 38;
        }
        out[o + 3] = 255;
      }
    }
  }
  const css = (img: RgbaImage): Size => ({ width: Math.round(img.width / scale), height: Math.round(img.height / scale) });
  const size = { figma: css(figma), code: css(code) };
  const tol = options.sizeTolerance ?? FIDELITY_DEFAULTS.sizeTolerance;
  const sizeMatches = Math.abs(size.figma.width - size.code.width) <= tol && Math.abs(size.figma.height - size.code.height) <= tol;
  const percent = total ? Math.round((different / total) * 10000) / 100 : 0;
  return {
    matches: sizeMatches && percent <= (options.maxPercent ?? FIDELITY_DEFAULTS.maxPercent),
    percent,
    differentPixels: different,
    totalPixels: total,
    size,
    sizeMatches,
    ...(out ? { diff: { width, height, data: out } } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Report: what a check found, per component and variant. JSON, storable as is.

export type FidelityVariantStatus = 'matches' | 'differs' | 'skipped';

export interface FidelityVariantResult {
  /** Variant key, as the plugin stores it ("Size=md, State=Default, Variant=primary"). */
  key: string;
  status: FidelityVariantStatus;
  percent?: number | undefined;
  size?: { figma: Size; code: Size } | undefined;
  /** Skipped variants: why there is nothing to compare, in designer words. */
  reason?: string | undefined;
}

export type FidelityComponentStatus = 'matches' | 'differs' | 'not-checked';

export interface FidelityComponentResult {
  component: string;
  status: FidelityComponentStatus;
  checked: number;
  differing: number;
  skipped: number;
  /** The variant that differs most (or matches least well). */
  worst?: { key: string; percent: number; size: { figma: Size; code: Size } } | undefined;
  /** Not checked at all: why. */
  reason?: string | undefined;
  variants: FidelityVariantResult[];
}

export interface FidelityReport {
  version: 1;
  checkedAt: string;
  /** Figma file the sets were exported from. */
  file?: string | undefined;
  /** Commit the code images were made from. */
  reference: { sha: string; createdAt: string };
  options: { scale: number; threshold: number; radius: number; maxPercent: number; sizeTolerance: number };
  components: FidelityComponentResult[];
  summary: { components: number; matches: number; differs: number; notChecked: number; variantsChecked: number; variantsSkipped: number };
}

/** Rolls variant results up into one component result. */
export function summarizeComponent(component: string, variants: FidelityVariantResult[], reason?: string): FidelityComponentResult {
  const compared = variants.filter((v) => v.status !== 'skipped');
  const differing = compared.filter((v) => v.status === 'differs');
  const rank = (v: FidelityVariantResult) => (v.status === 'differs' ? 1000 : 0) + (v.percent ?? 0) + (v.size && !sameSize(v.size) ? 500 : 0);
  const worst = [...compared].sort((a, b) => rank(b) - rank(a))[0];
  return {
    component,
    status: compared.length === 0 ? 'not-checked' : differing.length ? 'differs' : 'matches',
    checked: compared.length,
    differing: differing.length,
    skipped: variants.length - compared.length,
    ...(worst && worst.size ? { worst: { key: worst.key, percent: worst.percent ?? 0, size: worst.size } } : {}),
    ...(compared.length === 0 ? { reason: reason ?? variants.find((v) => v.reason)?.reason } : {}),
    variants,
  };
}

const sameSize = (s: { figma: Size; code: Size }) => s.figma.width === s.code.width && s.figma.height === s.code.height;

export function buildFidelityReport(input: {
  components: FidelityComponentResult[];
  reference: { sha: string; createdAt: string };
  options?: CompareOptions;
  file?: string;
  now?: Date;
}): FidelityReport {
  const o = input.options ?? {};
  const scale = o.scale ?? FIDELITY_DEFAULTS.scale;
  const c = input.components;
  return {
    version: 1,
    checkedAt: (input.now ?? new Date()).toISOString(),
    ...(input.file ? { file: input.file } : {}),
    reference: input.reference,
    options: {
      scale,
      threshold: o.threshold ?? FIDELITY_DEFAULTS.threshold,
      radius: Math.round(o.radius ?? scale),
      maxPercent: o.maxPercent ?? FIDELITY_DEFAULTS.maxPercent,
      sizeTolerance: o.sizeTolerance ?? FIDELITY_DEFAULTS.sizeTolerance,
    },
    components: c,
    summary: {
      components: c.length,
      matches: c.filter((x) => x.status === 'matches').length,
      differs: c.filter((x) => x.status === 'differs').length,
      notChecked: c.filter((x) => x.status === 'not-checked').length,
      variantsChecked: c.reduce((n, x) => n + x.checked, 0),
      variantsSkipped: c.reduce((n, x) => n + x.skipped, 0),
    },
  };
}

const fmtPercent = (p: number) => (p >= 10 ? `${Math.round(p)}%` : p >= 1 ? `${Math.round(p * 10) / 10}%` : p > 0 ? 'under 1%' : '0%');
const fmtSize = (s: Size) => `${s.width}x${s.height}`;

/**
 * A size difference past the tolerance, in designer words: "height 89 in Figma vs 48 in code". It says more than the
 * share of pixels when the two images do not have the same size (a 1% pixel score can hide a set twice as tall).
 */
export function sizeGap(s: { figma: Size; code: Size }, tolerance: number = FIDELITY_DEFAULTS.sizeTolerance): string | undefined {
  const r = (n: number) => Math.round(n);
  const parts: string[] = [];
  if (Math.abs(s.figma.width - s.code.width) > tolerance) parts.push(`width ${r(s.figma.width)} in Figma vs ${r(s.code.width)} in code`);
  if (Math.abs(s.figma.height - s.code.height) > tolerance) parts.push(`height ${r(s.figma.height)} in Figma vs ${r(s.code.height)} in code`);
  return parts.length ? parts.join(', ') : undefined;
}

/**
 * One variant's verdict: "Matches the code", "Differs from the code: 12% of pixels", or the size first when the size
 * differs: "Differs from the code: height 89 in Figma vs 48 in code, 1.4% of pixels".
 */
export function fidelityVerdict(v: Pick<FidelityVariantResult, 'status' | 'percent' | 'size' | 'reason'>): string {
  if (v.status === 'skipped') return `Not compared: ${v.reason ?? 'no image of the code'}`;
  if (v.status === 'matches') return 'Matches the code';
  const pixels = `${fmtPercent(v.percent ?? 0)} of pixels`;
  const gap = v.size ? sizeGap(v.size) : undefined;
  if (gap) return `Differs from the code: ${gap}, ${pixels}`;
  const parts = [pixels];
  if (v.size && !sameSize(v.size)) parts.push(`size ${fmtSize(v.size.figma)} vs ${fmtSize(v.size.code)}`);
  return `Differs from the code: ${parts.join(', ')}`;
}

/** One component's line, from its worst variant. */
export function fidelityComponentLine(c: FidelityComponentResult): string {
  if (c.status === 'not-checked') return `Not compared: ${c.reason ?? 'no image of the code'}`;
  if (c.status === 'matches') return c.checked === 1 ? 'Matches the code' : `Matches the code (${c.checked} variants)`;
  const w = c.worst!;
  const head = fidelityVerdict({ status: 'differs', percent: w.percent, size: w.size });
  return c.checked > 1 ? `${head} (${c.differing} of ${c.checked} variants)` : head;
}
