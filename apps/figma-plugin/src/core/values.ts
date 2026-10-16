// Value helpers: aliases, colors, equality with tolerance, display formatting.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const ALIAS_RE = /^\{([^{}]+)\}$/;

export const isAlias = (v: unknown): v is string => typeof v === 'string' && ALIAS_RE.test(v);
export const aliasTarget = (v: string): string => ALIAS_RE.exec(v)?.[1] ?? v;
export const toAlias = (path: string): string => `{${path}}`;

/** All alias references inside a value, including nested ones in composite values. */
export function collectRefs(value: unknown, out: string[] = []): string[] {
  if (isAlias(value)) out.push(aliasTarget(value));
  else if (Array.isArray(value)) value.forEach((v) => collectRefs(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectRefs(v, out));
  return out;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export function hexToRgba(hex: string): Rgba | undefined {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return undefined;
  let h = m[1]!;
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return undefined;
  const n = (idx: number) => parseInt(h.slice(idx, idx + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

const to255 = (n: number) => Math.round(clamp01(n) * 255);
export const rgbaToHex = (c: Rgba): string =>
  '#' + [c.r, c.g, c.b].map((x) => to255(x).toString(16).padStart(2, '0')).join('');

/** Parse a DTCG color value (2025.10 object form or legacy hex string). Undefined for unsupported color spaces. */
export function parseColor(value: unknown): Rgba | undefined {
  if (typeof value === 'string') return isAlias(value) ? undefined : hexToRgba(value);
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { colorSpace?: unknown; components?: unknown; alpha?: unknown; hex?: unknown };
  const alpha = typeof v.alpha === 'number' ? v.alpha : 1;
  if (v.colorSpace === 'srgb' && Array.isArray(v.components) && v.components.length === 3) {
    const [r, g, b] = v.components as unknown[];
    if ([r, g, b].every((x) => typeof x === 'number')) return { r: r as number, g: g as number, b: b as number, a: alpha };
  }
  if (typeof v.hex === 'string') {
    const c = hexToRgba(v.hex);
    if (c) return { ...c, a: alpha };
  }
  return undefined;
}

/** DTCG 2025.10 color object from RGBA floats. Components are rounded to 3 decimals like the repo files. */
export function rgbaToDtcg(c: Rgba): Record<string, unknown> {
  const out: Record<string, unknown> = {
    colorSpace: 'srgb',
    components: [round(clamp01(c.r), 3), round(clamp01(c.g), 3), round(clamp01(c.b), 3)],
  };
  if (c.a < 0.9995) out.alpha = round(clamp01(c.a), 3);
  out.hex = rgbaToHex(c);
  return out;
}

export function colorsEqual(a: Rgba, b: Rgba): boolean {
  return rgbaToHex(a) === rgbaToHex(b) && Math.abs(a.a - b.a) < 0.002;
}

export interface Dimension {
  value: number;
  unit: string;
}

export function parseDimension(value: unknown): Dimension | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as { value?: unknown; unit?: unknown };
    if (typeof v.value === 'number' && typeof v.unit === 'string') return { value: v.value, unit: v.unit };
  }
  if (typeof value === 'string') {
    const m = /^(-?\d+(?:\.\d+)?)(px|rem)$/.exec(value.trim());
    if (m) return { value: Number(m[1]), unit: m[2]! };
  }
  if (typeof value === 'number') return { value, unit: 'px' };
  return undefined;
}

const numbersEqual = (a: number, b: number) => Math.abs(a - b) < 1e-4;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return numbersEqual(a, b);
  if (typeof a !== typeof b || !a || !b || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, idx) => deepEqual(v, b[idx]));
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Semantic equality of two DTCG values of the same type. Tolerant to float noise coming back
 * from Figma (colors compare by 8-bit hex + alpha, numbers to 1e-4).
 */
export function valuesEqual(type: string, a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (isAlias(a) || isAlias(b)) return isAlias(a) && isAlias(b) && aliasTarget(a) === aliasTarget(b);
  if (type === 'color') {
    const ca = parseColor(a);
    const cb = parseColor(b);
    if (ca && cb) return colorsEqual(ca, cb);
  }
  if (type === 'dimension') {
    const da = parseDimension(a);
    const db = parseDimension(b);
    if (da && db) return da.unit === db.unit && numbersEqual(da.value, db.value);
  }
  return deepEqual(a, b);
}

/** Short human-readable form of a value for the UI and PR body. */
export function formatValue(type: string, value: unknown): string {
  if (value === undefined) return 'none';
  if (isAlias(value)) return aliasTarget(value);
  if (type === 'color') {
    const c = parseColor(value);
    if (c) return c.a < 0.9995 ? `${rgbaToHex(c)} @ ${Math.round(c.a * 100)}%` : rgbaToHex(c);
  }
  if (type === 'dimension') {
    const d = parseDimension(value);
    if (d) return `${d.value}${d.unit}`;
  }
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object' && value) return JSON.stringify(value);
  return String(value);
}
