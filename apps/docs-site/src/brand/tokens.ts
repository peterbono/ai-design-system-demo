// Bridge chrome brand tokens. The ONLY place in the docs app where raw color and shadow values live.
// Two tiers, like the design system we document: primitives (raw values) and semantic aliases per theme.
// brandCss() emits them as --br-* custom properties; every stylesheet uses var(--br-*) and stays lint-clean.
// These tokens style the Bridge app itself, never the design system shown inside preview surfaces.

export const primitives = {
  fog: { 0: '#ffffff', 50: '#f7f8f6', 100: '#f2f3f1', 150: '#eaece8', 200: '#dfe2de', 300: '#c9cdd0', 500: '#8b93a0' },
  steel: { 400: '#9aa4b2', 500: '#5a6372', 600: '#454e5d', 700: '#2c3442', 800: '#1d2633', 850: '#161d28', 900: '#18202e', 950: '#0f141c', ink: '#edeff2' },
  orange: { 100: '#fde6dd', 300: '#ff8a63', 400: '#ff6b3d', 500: '#e2451f', 600: '#c93a17', 700: '#b5331a', 900: '#3a1a10' },
  cable: { 100: '#dcebf3', 400: '#6cb4da', 600: '#2f7396', 700: '#255f7d', 900: '#132a37' },
  teal: { 100: '#d6efe9', 400: '#4fc2ad', 600: '#1f8a78', 700: '#15705f', 900: '#0f2e29' },
  ochre: { 100: '#f8ecc8', 400: '#e2b443', 600: '#c28a12', 700: '#8a5f06', 900: '#33270a' },
  plum: { 400: '#b48fd3', 600: '#7b4f9e' },
  red: { 100: '#fbe1dc', 400: '#ff7b6b', 700: '#b3261e', 900: '#3d1512' },
} as const;

type Theme = Record<string, string>;
const p = primitives;

/** Semantic aliases. Names describe the job, values point to primitives (or composite values built from them). */
export const semantic: { light: Theme; dark: Theme } = {
  light: {
    bg: p.fog[100],
    'bg-sunken': p.fog[150],
    surface: p.fog[0],
    'surface-2': p.fog[50],
    'surface-inverse': p.steel[900],
    text: p.steel[900],
    'text-muted': p.steel[500],
    'text-faint': p.steel[600],
    'text-inverse': p.fog[0],
    border: p.fog[200],
    'border-strong': p.fog[300],
    accent: p.orange[500],
    'accent-strong': p.orange[600],
    'accent-text': p.orange[700],
    'on-accent': p.fog[0],
    'accent-soft': p.orange[100],
    primary: p.steel[900],
    'primary-hover': p.steel[700],
    'on-primary': p.fog[0],
    focus: p.orange[600],
    'data-1': p.orange[500],
    'data-2': p.cable[600],
    'data-3': p.teal[600],
    'data-4': p.ochre[600],
    'data-5': p.plum[600],
    'data-6': p.steel[500],
    'data-track': p.fog[150],
    pass: p.teal[700],
    'pass-soft': p.teal[100],
    fail: p.red[700],
    'fail-soft': p.red[100],
    warn: p.ochre[700],
    'warn-soft': p.ochre[100],
    info: p.cable[700],
    'info-soft': p.cable[100],
    selection: p.orange[100],
    grain: 'rgb(24 32 46 / 0.05)',
    glow: 'rgb(226 69 31 / 0.16)',
    'glow-2': 'rgb(47 115 150 / 0.14)',
    scrim: 'rgb(15 20 28 / 0.42)',
    'checker-a': p.fog[50],
    'checker-b': p.fog[150],
    'shadow-1': '0 1px 2px rgb(24 32 46 / 0.06), 0 1px 1px rgb(24 32 46 / 0.04)',
    'shadow-2': '0 1px 2px rgb(24 32 46 / 0.05), 0 4px 12px -2px rgb(24 32 46 / 0.08), 0 12px 24px -12px rgb(24 32 46 / 0.10)',
    'shadow-3': '0 2px 4px rgb(24 32 46 / 0.06), 0 12px 32px -8px rgb(24 32 46 / 0.18), 0 32px 64px -24px rgb(24 32 46 / 0.22)',
    'shadow-press': 'inset 0 1px 2px rgb(24 32 46 / 0.12)',
  },
  dark: {
    bg: p.steel[950],
    'bg-sunken': '#0b0f15',
    surface: p.steel[850],
    'surface-2': p.steel[800],
    'surface-inverse': p.steel.ink,
    text: p.steel.ink,
    'text-muted': p.steel[400],
    'text-faint': '#b7bfca',
    'text-inverse': p.steel[950],
    border: p.steel[700],
    'border-strong': '#3b4554',
    accent: p.orange[400],
    'accent-strong': p.orange[400],
    'accent-text': p.orange[300],
    'on-accent': p.steel[950],
    'accent-soft': p.orange[900],
    primary: p.steel.ink,
    'primary-hover': '#ffffff',
    'on-primary': p.steel[950],
    focus: p.orange[300],
    'data-1': p.orange[400],
    'data-2': p.cable[400],
    'data-3': p.teal[400],
    'data-4': p.ochre[400],
    'data-5': p.plum[400],
    'data-6': p.steel[400],
    'data-track': p.steel[800],
    pass: p.teal[400],
    'pass-soft': p.teal[900],
    fail: p.red[400],
    'fail-soft': p.red[900],
    warn: p.ochre[400],
    'warn-soft': p.ochre[900],
    info: p.cable[400],
    'info-soft': p.cable[900],
    selection: p.orange[900],
    grain: 'rgb(237 239 242 / 0.035)',
    glow: 'rgb(255 107 61 / 0.14)',
    'glow-2': 'rgb(108 180 218 / 0.10)',
    scrim: 'rgb(0 0 0 / 0.6)',
    'checker-a': p.steel[850],
    'checker-b': p.steel[800],
    'shadow-1': '0 1px 2px rgb(0 0 0 / 0.4)',
    'shadow-2': '0 1px 2px rgb(0 0 0 / 0.4), 0 8px 24px -8px rgb(0 0 0 / 0.5)',
    'shadow-3': '0 2px 4px rgb(0 0 0 / 0.4), 0 16px 40px -8px rgb(0 0 0 / 0.6)',
    'shadow-press': 'inset 0 1px 2px rgb(0 0 0 / 0.5)',
  },
};

/** Non-color tokens: type, radius, motion. Same in both themes. */
export const scales: Theme = {
  'font-display': '"Space Grotesk Variable", "Space Grotesk", ui-sans-serif, system-ui, sans-serif',
  'font-ui': '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  'font-mono': '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  'text-xs': '0.75rem',
  'text-sm': '0.8125rem',
  'text-md': '0.9375rem',
  'text-lg': '1.125rem',
  'text-xl': '1.375rem',
  'text-2xl': '1.75rem',
  'text-3xl': '2.25rem',
  'text-4xl': '3rem',
  'text-5xl': '4rem',
  'radius-sm': '6px',
  'radius-control': '10px',
  'radius-card': '14px',
  'radius-stage': '20px',
  'radius-pill': '999px',
  'rail-width': '264px',
  'topbar-height': '60px',
  'content-max': '1180px',
  'ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
};

const block = (sel: string, vars: Theme) =>
  `${sel}{${Object.entries(vars)
    .map(([k, v]) => `--br-${k}:${v};`)
    .join('')}}`;

/** The CSS emitted into every page head. Light is the default; dark follows data-theme on <html>. */
export function brandCss(): string {
  return [
    block(':root', { ...scales, ...semantic.light }),
    block(':root[data-theme="dark"]', semantic.dark),
    ':root[data-theme="dark"]{color-scheme:dark}',
  ].join('\n');
}
