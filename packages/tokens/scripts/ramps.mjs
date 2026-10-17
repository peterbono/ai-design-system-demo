// Regenerates src/primitives/color.tokens.json: every ramp is built in OKLCH on one shared lightness ladder,
// so the same step has the same perceived lightness in every hue (see docs/DESIGN-LANGUAGE.md, section 4).
// Usage: node scripts/ramps.mjs   (then npm run tokens:build). Edit RAMPS below, never the JSON by hand.
import { writeFile } from 'node:fs/promises';
// The math (ladder, chroma bell, OKLCH -> sRGB, gamut mapping) lives in the shared ramp engine, so a brand
// created with Bridge (@bridge-ds/core planNewBrand) gets its ramps from exactly the same code.
import { BELL, NEUTRAL_ANCHORS, dtcgColor, generateRamp, neutralChroma } from '../../core/src/ramps.js';

// name: [hue, chroma(step) , lightness offset(step), description]
const RAMPS = {
  steel: [255, neutralChroma(1, 0.005, 0.008, 0.024), () => 0, 'Former bridge neutral (before Field Guide). Kept for products that alias it.'],
  orange: [36, (s) => 0.205 * BELL[s], (s) => (s === 500 ? -0.01 : 0), 'Orange. Categorical chart hue in both brands.'],
  crimson: [12, (s) => 0.2 * BELL[s], () => 0, 'Danger. A raspberry red, kept apart from the orange chart hue.'],
  teal: [176, (s) => 0.11 * BELL[s], () => 0, 'Success.'],
  ochre: [78, (s) => 0.15 * BELL[s], (s) => ({ 300: 0.03, 400: 0.06, 500: 0.06 })[s] ?? 0, 'Warning.'],
  cable: [236, (s) => 0.1 * BELL[s], () => 0, 'Former bridge link and info blue (before Field Guide). Kept for products that alias it.'],
  slate: [248, neutralChroma(1, 0.006, 0.012, 0.03), () => 0, 'Ocean brand neutral.'],
  sea: [228, (s) => 0.15 * BELL[s], () => 0, 'Ocean brand primary and signal.'],
  plum: [305, (s) => 0.14 * BELL[s], () => 0, 'Info tone (both brands) and the ocean categorical hue.'],
  ink: [250, neutralChroma(), () => 0, 'Bridge neutral (Field Guide). Ink navy text, quiet blue-grey lines, deep navy at the dark end.'],
  harbor: [251, (s) => 0.14 * BELL[s], () => 0, 'Bridge primary (Field Guide). Harbor 200 is the zone blue, Harbor 700 (Deep Harbor) the one strong color.'],
};

// Brand anchors: steps pinned to the exact brand hex, so the named brand colors survive the generator.
// Every pin sits within 0.04 OKLCH lightness of its ladder step, so the ramp stays monotonic.
const PINS = {
  ink: NEUTRAL_ANCHORS,
  harbor: { 200: '#CFE8FF', 700: '#0B4A8B' },
};

const color = (rgb, alpha) => ({ $value: dtcgColor(rgb, alpha) });

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
  const ramp = generateRamp({ hue, chroma, offset, pins: PINS[name] });
  for (const [s, rgb] of Object.entries(ramp)) out.color[name][s] = color(rgb);
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
