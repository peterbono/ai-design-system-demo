// The Bridge ramp engine: OKLCH color ramps on one shared lightness ladder (docs/DESIGN-LANGUAGE.md, section 4).
// Pure and dependency-free, written as plain JavaScript so two very different callers run the same code:
//   packages/tokens/scripts/ramps.mjs   regenerates src/primitives/color.tokens.json (plain Node, no build)
//   @bridge-ds/core planNewBrand        generates the palette of a new brand (plugin, docs site, CLI, MCP)
// Types live next to it in ramps.d.ts. Change the algorithm here and both stay in step.

/** Ramp steps, lightest first. */
export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** OKLCH lightness of every step: the same step has the same perceived lightness whatever the hue. */
export const LIGHTNESS = { 50: 0.975, 100: 0.952, 200: 0.912, 300: 0.85, 400: 0.735, 500: 0.63, 600: 0.53, 700: 0.445, 800: 0.36, 900: 0.27, 950: 0.205 };

/** Chroma bell: share of the peak chroma per step, peaking around 500 and 600. */
export const BELL = { 50: 0.12, 100: 0.22, 200: 0.4, 300: 0.62, 400: 0.85, 500: 1, 600: 1, 700: 0.92, 800: 0.8, 900: 0.62, 950: 0.5 };

/** Bridge's ink anchors (Line, Ink secondary, Ink): pinned in the bridge neutral by scripts/ramps.mjs. */
export const NEUTRAL_ANCHORS = { 200: '#E3E8EE', 600: '#5B6672', 900: '#15202B' };

/** How far a pinned brand hex may sit from its ladder step before the ramp stops reading as one family. */
export const PIN_TOLERANCE = 0.04;

/** Chroma curve of a colored ramp (primary, status, accents). */
export const bellChroma = (peak) => (s) => peak * BELL[s];

/** Chroma curve of a neutral ramp (ink, slate): nearly grey at the light end, a visible hue at the dark end. */
export const neutralChroma =
  (scale = 1, low = 0.004, base = 0.01, slope = 0.022) =>
  (s) =>
    (s <= 100 ? low : base + slope * (s / 950)) * scale;

export function oklchToLinear(L, C, h) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const encode = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
};
const decode = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

/** sRGB (0..1 components) of an OKLCH color, gamut-mapped by lowering chroma until it fits. */
export function oklch(L, C, h) {
  let c = C;
  let lin = oklchToLinear(L, c, h);
  for (let i = 0; i < 60 && !lin.every((x) => x >= -0.0005 && x <= 1.0005); i++) {
    c *= 0.95;
    lin = oklchToLinear(L, c, h);
  }
  return lin.map(encode);
}

/** OKLCH of an sRGB color (0..1 components). Hue is 0 for greys. */
export function toOklch(rgb) {
  const [r, g, b] = rgb.map(decode);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + B * B);
  const h = C < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { L, C, h };
}

export const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s.trim());
export const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const round3 = (x) => Math.round(x * 1000) / 1000;
export const toHex = (rgb) => '#' + rgb.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');

/** DTCG 2025.10 color value in the house form: { colorSpace, components, hex, alpha? }. */
export function dtcgColor(rgb, alpha) {
  const v = { colorSpace: 'srgb', components: rgb.map(round3), hex: toHex(rgb) };
  if (alpha !== undefined) v.alpha = alpha;
  return v;
}

/**
 * One ramp: step -> sRGB. `chroma(step)` and `offset(step)` shape it; `pins` replace steps with exact brand hexes,
 * so named brand colors survive regeneration.
 */
export function generateRamp({ hue, chroma, offset = () => 0, pins = {} }) {
  const out = {};
  for (const s of STEPS) {
    const pin = pins[s];
    out[s] = pin ? fromHex(pin) : oklch(LIGHTNESS[s] + offset(s), chroma(s), hue);
  }
  return out;
}

/** Ladder step whose lightness is closest to an sRGB color. */
export function nearestStep(rgb) {
  const { L } = toOklch(rgb);
  let best = STEPS[0];
  for (const s of STEPS) if (Math.abs(LIGHTNESS[s] - L) < Math.abs(LIGHTNESS[best] - L)) best = s;
  return best;
}

/**
 * A colored ramp anchored on a brand hex: hue from the hex, peak chroma so the curve passes through it, and the
 * hex pinned at `pinStep` (or at its nearest step). `distance` is how far the hex sits from the ladder lightness
 * of the pinned step; above PIN_TOLERANCE the ramp is no longer monotonic around the pin.
 */
export function anchoredRamp(hex, pinStep) {
  const rgb = fromHex(hex);
  const { L, C, h } = toOklch(rgb);
  const step = pinStep ?? nearestStep(rgb);
  const peak = Math.min(0.24, Math.max(0.02, C / BELL[step]));
  return { hue: h, peak, step, distance: Math.abs(L - LIGHTNESS[step]), ramp: generateRamp({ hue: h, chroma: bellChroma(peak), pins: { [step]: hex.toUpperCase() } }) };
}

/**
 * Lightness offsets of a generated neutral: the steps text and lines use sit exactly where Bridge's ink anchors
 * sit, so muted text (600) keeps its contrast on zones and subtle backgrounds in every new brand.
 */
export function neutralOffset() {
  const off = {};
  for (const [s, hex] of Object.entries(NEUTRAL_ANCHORS)) off[s] = toOklch(fromHex(hex)).L - LIGHTNESS[s];
  return (s) => off[s] ?? 0;
}

/** A neutral ramp tinted by a hex: hue from the hex, chroma scaled by how tinted it is (0 for a pure grey). */
export function tintedNeutral(hex) {
  const rgb = fromHex(hex);
  const { C, h } = toOklch(rgb);
  const ref = neutralChroma()(nearestStep(rgb));
  const scale = C < 0.004 ? 0 : Math.min(2.5, C / ref);
  return { hue: h, scale, ramp: generateRamp({ hue: h, chroma: neutralChroma(scale), offset: neutralOffset() }) };
}
