// Regenerates src/primitives/color.tokens.json: every ramp is built in OKLCH on one shared lightness ladder,
// so the same step has the same perceived lightness in every hue (see docs/DESIGN-LANGUAGE.md, section 4).
// Usage: node scripts/ramps.mjs   (then npm run tokens:build). Edit RAMPS below, never the JSON by hand.
import { writeFile } from 'node:fs/promises';

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const LIGHTNESS = { 50: 0.975, 100: 0.952, 200: 0.912, 300: 0.85, 400: 0.735, 500: 0.63, 600: 0.53, 700: 0.445, 800: 0.36, 900: 0.27, 950: 0.205 };
const BELL = { 50: 0.12, 100: 0.22, 200: 0.4, 300: 0.62, 400: 0.85, 500: 1, 600: 1, 700: 0.92, 800: 0.8, 900: 0.62, 950: 0.5 };

// name: [hue, chroma(step) , lightness offset(step), description]
const RAMPS = {
  steel: [255, (s) => (s <= 100 ? 0.005 : 0.008 + 0.024 * (s / 950)), () => 0, 'Former bridge neutral (before Field Guide). Kept for products that alias it.'],
  orange: [36, (s) => 0.205 * BELL[s], (s) => (s === 500 ? -0.01 : 0), 'Orange. Categorical chart hue in both brands.'],
  crimson: [12, (s) => 0.2 * BELL[s], () => 0, 'Danger. A raspberry red, kept apart from the orange chart hue.'],
  teal: [176, (s) => 0.11 * BELL[s], () => 0, 'Success.'],
  ochre: [78, (s) => 0.15 * BELL[s], (s) => ({ 300: 0.03, 400: 0.06, 500: 0.06 })[s] ?? 0, 'Warning.'],
  cable: [236, (s) => 0.1 * BELL[s], () => 0, 'Former bridge link and info blue (before Field Guide). Kept for products that alias it.'],
  slate: [248, (s) => (s <= 100 ? 0.006 : 0.012 + 0.03 * (s / 950)), () => 0, 'Ocean brand neutral.'],
  sea: [228, (s) => 0.15 * BELL[s], () => 0, 'Ocean brand primary and signal.'],
  plum: [305, (s) => 0.14 * BELL[s], () => 0, 'Info tone (both brands) and the ocean categorical hue.'],
  ink: [250, (s) => (s <= 100 ? 0.004 : 0.01 + 0.022 * (s / 950)), () => 0, 'Bridge neutral (Field Guide). Ink navy text, quiet blue-grey lines, deep navy at the dark end.'],
  harbor: [251, (s) => 0.14 * BELL[s], () => 0, 'Bridge primary (Field Guide). Harbor 200 is the zone blue, Harbor 700 (Deep Harbor) the one strong color.'],
};

// Brand anchors: steps pinned to the exact brand hex, so the named brand colors survive the generator.
// Every pin sits within 0.04 OKLCH lightness of its ladder step, so the ramp stays monotonic.
const PINS = {
  ink: { 200: '#E3E8EE', 600: '#5B6672', 900: '#15202B' },
  harbor: { 200: '#CFE8FF', 700: '#0B4A8B' },
};

function oklchToLinear(L, C, h) {
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
// Gamut-map by lowering chroma until the color fits in sRGB.
function oklch(L, C, h) {
  let c = C;
  let lin = oklchToLinear(L, c, h);
  for (let i = 0; i < 60 && !lin.every((x) => x >= -0.0005 && x <= 1.0005); i++) {
    c *= 0.95;
    lin = oklchToLinear(L, c, h);
  }
  return lin.map(encode);
}
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const round = (x) => Math.round(x * 1000) / 1000;
const toHex = (rgb) => '#' + rgb.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
const color = (rgb, alpha) => {
  const v = { colorSpace: 'srgb', components: rgb.map(round), hex: toHex(rgb) };
  if (alpha !== undefined) v.alpha = alpha;
  return { $value: v };
};

const out = {
  color: {
    $type: 'color',
    $description: 'Primitive color ramps. Never used by components directly: brands map them to palette roles.',
    white: color([1, 1, 1]),
    black: color([0, 0, 0]),
  },
};
for (const [name, [hue, chroma, offset, description]] of Object.entries(RAMPS)) {
  out.color[name] = { $description: description };
  for (const s of STEPS) {
    const pin = PINS[name]?.[s];
    out.color[name][s] = color(pin ? fromHex(pin) : oklch(LIGHTNESS[s] + offset(s), chroma(s), hue));
  }
}
// Translucent primitives for scrims and shadows (steel 950 and black).
const steel950 = out.color.steel[950].$value.components;
out.color.alpha = {
  $description: 'Translucent colors for scrims and shadows.',
  'steel-8': color(steel950, 0.08),
  'steel-12': color(steel950, 0.12),
  'steel-16': color(steel950, 0.16),
  'steel-48': color(steel950, 0.48),
  'black-24': color([0, 0, 0], 0.24),
  'black-40': color([0, 0, 0], 0.4),
  'black-56': color([0, 0, 0], 0.56),
  'black-64': color([0, 0, 0], 0.64),
};

await writeFile(new URL('../src/primitives/color.tokens.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log('ramps: wrote src/primitives/color.tokens.json');
