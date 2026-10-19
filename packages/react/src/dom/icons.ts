// The few Lucide glyphs the DOM renderers draw, as the same SVG markup `<Icon>` renders (lucide-react 1.x).
// The parity tests in dom.test.tsx compare every renderer with its React component, so a Lucide update that
// changes a glyph fails there instead of drifting silently.
import iconStyles from '../components/Icon/Icon.module.css';
import type { IconSize } from '../components/Icon';
import { attrs } from './html';

type Node = [tag: string, attributes: Record<string, string>];

const GLYPHS = {
  copy: {
    names: ['copy'],
    node: [
      ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }],
      ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }],
    ],
  },
  check: { names: ['check'], node: [['path', { d: 'M20 6 9 17l-5-5' }]] },
  x: {
    names: ['x'],
    node: [
      ['path', { d: 'M18 6 6 18' }],
      ['path', { d: 'm6 6 12 12' }],
    ],
  },
  eye: {
    names: ['eye'],
    node: [
      ['path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' }],
      ['circle', { cx: '12', cy: '12', r: '3' }],
    ],
  },
  'triangle-alert': {
    names: ['triangle-alert', 'alert-triangle'],
    node: [
      ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
      ['path', { d: 'M12 9v4' }],
      ['path', { d: 'M12 17h.01' }],
    ],
  },
} satisfies Record<string, { names: string[]; node: Node[] }>;

export type DomIconName = keyof typeof GLYPHS;

/** A decorative Lucide icon at a token size, the markup `<Icon icon={...} size={size} />` renders. */
export function iconHtml(name: DomIconName, size: IconSize = 'sm', className?: string): string {
  const g = GLYPHS[name];
  // lucide-react merges its own classes with ours and drops duplicates (mergeClasses): do the same.
  const cls = [...g.names.map((n) => `lucide-${n}`), iconStyles.icon, iconStyles[size], className]
    .reduce<string[]>((all, c) => (c && !all.includes(c) ? [...all, c] : all), ['lucide'])
    .join(' ');
  const body = (g.node as Node[]).map(([tag, a]) => `<${tag}${attrs(a)}></${tag}>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true" focusable="false">${body}</svg>`;
}
