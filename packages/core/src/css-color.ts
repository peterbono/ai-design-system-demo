// CSS colors in the wide-gamut and perceptual spaces a browser keeps in computed values (Tailwind v4 themes are
// oklch(), color-mix() resolves to oklab() or color(srgb ...)) turned into the sRGB rgb()/rgba() Figma paints and the
// token writer read. CSS Color 4 math (D65 sRGB, D50 Lab with Bradford adaptation), clipped to the sRGB gamut.
// Pure: the measure runs it on what the page returns.

type Vec = [number, number, number];

const mul = (m: number[][], v: Vec): Vec => [0, 1, 2].map((i) => m[i]![0]! * v[0] + m[i]![1]! * v[1] + m[i]![2]! * v[2]) as Vec;

const XYZ_D65_TO_LINEAR_SRGB = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const D50_TO_D65 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];
const LINEAR_P3_TO_XYZ_D65 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const D50_WHITE: Vec = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

const toLinear = (c: number) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (Math.abs(c) <= 0.0031308 ? 12.92 * c : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055));

function oklabToLinearSrgb(L: number, a: number, b: number): Vec {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

function labToXyzD50(L: number, a: number, b: number): Vec {
  const e = 216 / 24389;
  const k = 24389 / 27;
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const x = fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k;
  const y = L > k * e ? fy ** 3 : L / k;
  const z = fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k;
  return [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]];
}

/** A component: a number, a percentage of `full`, or `none` (0). */
function num(s: string | undefined, full = 1): number {
  if (s === undefined || s === 'none') return 0;
  if (s.endsWith('%')) return (parseFloat(s) / 100) * full;
  if (/deg$/.test(s)) return parseFloat(s);
  if (/turn$/.test(s)) return parseFloat(s) * 360;
  if (/rad$/.test(s)) return (parseFloat(s) * 180) / Math.PI;
  return parseFloat(s);
}

/** Linear sRGB of one color function's arguments, or undefined for a space this does not know. */
function linearSrgb(fn: string, args: string[]): Vec | undefined {
  switch (fn) {
    case 'oklab':
      return oklabToLinearSrgb(num(args[0]), num(args[1], 0.4), num(args[2], 0.4));
    case 'oklch': {
      const c = num(args[1], 0.4);
      const h = (num(args[2]) * Math.PI) / 180;
      return oklabToLinearSrgb(num(args[0]), c * Math.cos(h), c * Math.sin(h));
    }
    case 'lab':
      return mul(XYZ_D65_TO_LINEAR_SRGB, mul(D50_TO_D65, labToXyzD50(num(args[0], 100), num(args[1], 125), num(args[2], 125))));
    case 'lch': {
      const c = num(args[1], 150);
      const h = (num(args[2]) * Math.PI) / 180;
      return mul(XYZ_D65_TO_LINEAR_SRGB, mul(D50_TO_D65, labToXyzD50(num(args[0], 100), c * Math.cos(h), c * Math.sin(h))));
    }
    case 'color': {
      const [space, ...c] = args;
      const v = [num(c[0]), num(c[1]), num(c[2])] as Vec;
      if (space === 'srgb') return v.map(toLinear) as Vec;
      if (space === 'srgb-linear') return v;
      if (space === 'display-p3') return mul(XYZ_D65_TO_LINEAR_SRGB, mul(LINEAR_P3_TO_XYZ_D65, v.map(toLinear) as Vec));
      if (space === 'xyz' || space === 'xyz-d65') return mul(XYZ_D65_TO_LINEAR_SRGB, v);
      if (space === 'xyz-d50') return mul(XYZ_D65_TO_LINEAR_SRGB, mul(D50_TO_D65, v));
      return undefined;
    }
  }
  return undefined;
}

const COLOR_FN = /\b(oklch|oklab|lab|lch|color)\(([^()]*)\)/gi;

/** One CSS color function (`oklch(0.205 0 0)`, `color(display-p3 1 0 0 / 0.5)`) as `rgb(r, g, b)` / `rgba(...)`. */
export function cssColorToRgb(fn: string, inner: string): string | undefined {
  const [main, alpha] = inner.split('/');
  const args = main!.trim().split(/[\s,]+/).filter(Boolean);
  const lin = linearSrgb(fn.toLowerCase(), args);
  if (!lin || lin.some((x) => !Number.isFinite(x))) return undefined;
  const [r, g, b] = lin.map((x) => Math.round(Math.min(1, Math.max(0, toGamma(x))) * 255));
  const a = alpha === undefined ? 1 : Math.min(1, Math.max(0, num(alpha.trim())));
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

/** Every oklch/oklab/lab/lch/color() in a CSS value (a color, a shadow, SVG markup) as sRGB; the rest unchanged. */
export function cssColorsToRgb(text: string): string {
  if (!/(oklch|oklab|lab|lch|color)\(/i.test(text)) return text;
  return text.replace(COLOR_FN, (whole, fn: string, inner: string) => cssColorToRgb(fn, inner) ?? whole);
}

/** The same on every string inside a value (a measure result, a token harvest). */
export function withSrgbColors<T>(value: T): T {
  if (typeof value === 'string') return cssColorsToRgb(value) as T;
  if (Array.isArray(value)) return value.map((v) => withSrgbColors(v)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withSrgbColors(v)])) as T;
  return value;
}

export interface CssShadow {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  /** 0..1 sRGB and alpha. */
  color: { r: number; g: number; b: number; a: number };
}

/**
 * A computed `box-shadow` (`rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, inset ...`) as shadows, transparent ones left out (the
 * zero rings utility CSS stacks under every shadow). Colors in any notation the page kept are read as sRGB.
 */
export function parseBoxShadow(css: string | undefined): CssShadow[] {
  if (!css || css.trim() === 'none') return [];
  const out: CssShadow[] = [];
  for (const one of cssColorsToRgb(css).split(/,(?![^(]*\))/)) {
    const color = /rgba?\(([^)]*)\)/i.exec(one);
    const c = color ? color[1]!.split(/[\s,/]+/).filter(Boolean).map(Number) : [0, 0, 0, 1];
    const a = c[3] ?? 1;
    const lengths = one.replace(/rgba?\([^)]*\)/i, '').replace(/inset/i, '').trim().split(/\s+/).filter(Boolean).map((x) => Number.parseFloat(x));
    if (lengths.length < 2 || lengths.some((x) => !Number.isFinite(x)) || !(a > 0)) continue;
    out.push({ inset: /\binset\b/i.test(one), x: lengths[0]!, y: lengths[1]!, blur: lengths[2] ?? 0, spread: lengths[3] ?? 0, color: { r: c[0]! / 255, g: c[1]! / 255, b: c[2]! / 255, a } });
  }
  return out;
}
