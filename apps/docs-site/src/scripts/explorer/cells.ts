// Cell anatomy of the token explorer: a preview drawn on the mode's own background (fg colors show "Aa" on their
// paired background), a human alias chip that jumps to the target, the resolved value as a secondary line, and copy
// buttons. Non-color types get a preview to scale: dimension bar, radius corner, easing curve, duration track,
// typography sample, shadow on a mini card.
import { aliasLabel, bezierPath, colorAlpha, cssText, isForeground, numericValue } from '../../lib/explorer/format';
import { cellValue, pairedBackground, type CellValue, type Column } from '../../lib/explorer/model';
import type { ExplorerData } from './types';
import { swatchLabel } from '../../lib/explorer/swatch-ramp';
import { copyButton, cssValue, esc, icon, inkOn } from './util';

const CANVAS = 'color.bg.default';
const SURFACE = 'color.surface.default';

/** Hex of a color token resolved in a column's context (for stage backgrounds). */
function hexIn(d: ExplorerData, path: string, col: Column): string | undefined {
  return d.set.byPath.has(path) ? cellValue(d.set, path, col.ctx).hex : undefined;
}

function stageBg(d: ExplorerData, col: Column, path?: string): string {
  if (path) {
    const bg = pairedBackground(path, (p) => d.set.byPath.has(p), d.pairs);
    const hex = hexIn(d, bg, col);
    if (hex) return hex;
  }
  return hexIn(d, CANVAS, col) ?? hexIn(d, SURFACE, col) ?? 'transparent';
}

/** The preview square of a cell. */
export function preview(d: ExplorerData, type: string, path: string, v: CellValue, col: Column, size: 'sm' | 'lg' = 'sm'): string {
  const cls = `xp-stage is-${size}`;
  if (v.resolved === undefined) return `<span class="${cls} is-broken" aria-hidden="true"></span>`;
  const bg = cssValue(stageBg(d, col, type === 'color' && isForeground(path) ? path : undefined));
  const css = cssValue(v.css);
  switch (type) {
    case 'color': {
      if (isForeground(path)) return `<span class="${cls} is-aa" style="background-color:${bg};color:${css}" aria-hidden="true">Aa</span>`;
      const checker = colorAlpha(v.resolved) < 0.9995 ? ' has-alpha' : '';
      return `<span class="${cls}" style="background-color:${bg}" aria-hidden="true"><span class="xp-sw${checker}"><i style="background-color:${css}"></i></span></span>`;
    }
    case 'shadow':
      return `<span class="${cls}" style="background-color:${bg}" aria-hidden="true"><span class="xp-card" style="box-shadow:${css}"></span></span>`;
    case 'cubicBezier': {
      const p = bezierPath(v.resolved, 20);
      return `<span class="${cls} is-plain" aria-hidden="true">${p ? `<svg viewBox="-2 -2 24 24" width="24" height="24"><path d="M0 20 L20 0" class="xp-curve-ref" fill="none"/><path d="${p}" class="xp-curve" fill="none"/></svg>` : ''}</span>`;
    }
    case 'duration': {
      const ms = numericValue(v.resolved) ?? 0;
      return `<span class="${cls} is-plain is-track" aria-hidden="true"><i class="xp-dot" style="animation-duration:${Math.max(ms, 1)}ms"></i></span>`;
    }
    case 'fontFamily':
      return `<span class="${cls} is-plain is-type" style="font-family:${css}" aria-hidden="true">Ag</span>`;
    case 'fontWeight':
      return `<span class="${cls} is-plain is-type" style="font-weight:${css}" aria-hidden="true">Ag</span>`;
    case 'dimension': {
      const px = numericValue(v.resolved) ?? 0;
      if (/(^|\.)radius(\.|$)/.test(path)) return `<span class="${cls} is-plain" aria-hidden="true"><span class="xp-corner" style="border-top-left-radius:${Math.min(px, 24)}px"></span></span>`;
      if (/font\.size/.test(path)) return `<span class="${cls} is-plain is-type" style="font-size:${Math.min(px, 28)}px" aria-hidden="true">Ag</span>`;
      if (/(border|stroke|ring)/.test(path) && px <= 8) return `<span class="${cls} is-plain" aria-hidden="true"><span class="xp-stroke" style="border-top-width:${px}px"></span></span>`;
      return '';
    }
    case 'number':
      if (/line-height/.test(path)) return `<span class="${cls} is-plain is-leading" style="line-height:${css}" aria-hidden="true"><i></i><i></i></span>`;
      return '';
    default:
      return '';
  }
}

/** Dimension bar to scale (capped, with a break mark past the cap), shown under the value. */
function bar(type: string, path: string, v: CellValue): string {
  if (type !== 'dimension' || /(radius|font\.size)/.test(path)) return '';
  const px = numericValue(v.resolved);
  if (px === undefined) return '';
  const cap = 120;
  return `<span class="xp-bar${px > cap ? ' is-capped' : ''}" style="width:${Math.max(Math.min(px, cap), 1)}px" aria-hidden="true"></span>`;
}

/** Inner HTML of a mode cell. */
export function cellHtml(d: ExplorerData, path: string, col: Column, editable: boolean): string {
  const t = d.set.byPath.get(path);
  const type = t?.type ?? '';
  const v = cellValue(d.set, path, col.ctx);
  const chip = v.alias
    ? `<button type="button" class="xp-chip" data-goto="${esc(v.alias)}" tabindex="-1" title="Go to ${esc(v.alias)}">${v.override ? '<span class="xp-chip-flag" title="Brand override">B</span>' : ''}${esc(aliasLabel(v.alias))}</button>`
    : '';
  const main = chip || `<span class="xp-literal mono">${esc(v.line || cssText(type, v.raw))}</span>`;
  const line = v.alias ? `<span class="xp-line mono">${esc(v.line)}</span>` : '';
  const err = v.error ? `<span class="xp-line is-error">${esc(v.line)}</span>` : '';
  const copyValue = type === 'color' ? (v.hex ?? v.css) : v.css;
  // Studio rows hide the resolved line; the value stays one hover away (and in the detail panel).
  const tip = editable && v.line ? ` title="${esc(v.alias ? `${aliasLabel(v.alias)}: ${v.line}` : v.line)}"` : '';
  return `<span class="xp-cv"${tip}>${preview(d, type, path, v, col)}<span class="xp-cv-text">${main}${err || line}${bar(type, path, v)}</span>${
    copyValue ? copyButton(copyValue, `value ${copyValue}`) : ''
  }${editable ? '<span class="xp-edit-hint" aria-hidden="true">Enter to edit</span>' : ''}</span>`;
}

/**
 * Studio value cell: a field you click to edit. Swatch (or a small preview to scale), the alias as a short name, an
 * edited dot when the draft changes this mode, the resolved value on the end side and a chevron that shows on hover
 * and focus. No copy button: C copies, and so do the row menu and the detail panel.
 */
export function studioCellHtml(d: ExplorerData, path: string, col: Column, edited: boolean): string {
  const t = d.set.byPath.get(path);
  const type = t?.type ?? '';
  const v = cellValue(d.set, path, col.ctx);
  const lead =
    type === 'color'
      ? `<span class="xp-ms${v.hex ? '' : ' is-broken'}${colorAlpha(v.resolved) < 0.9995 ? ' has-alpha' : ''}" aria-hidden="true"><i style="background-color:${cssValue(v.css)}"></i></span>`
      : preview(d, type, path, v, col);
  const main = v.alias ? swatchLabel(v.alias) : v.line || cssText(type, v.raw);
  const end = v.error ? 'Unresolved' : type === 'color' ? (v.hex ?? v.css) : v.alias ? v.line : '';
  const dot = edited ? '<span class="xp-edot" aria-hidden="true"></span><span class="sr-only">, edited in your draft</span>' : '';
  return `<span class="xp-field${v.error ? ' is-error' : ''}"${v.override ? ' data-override=""' : ''}>${lead}<span class="xp-field-main mono">${esc(main)}</span>${dot}<span class="xp-field-end mono">${esc(end)}</span><span class="xp-field-chev" aria-hidden="true">${icon('chevronDown', 16)}</span></span>`;
}

/** Accessible text of a cell for screen readers (the visual chip and line are aria-hidden duplicates otherwise). */
export function cellLabel(d: ExplorerData, path: string, col: Column, studio = false): string {
  const v = cellValue(d.set, path, col.ctx);
  const type = d.set.byPath.get(path)?.type ?? '';
  // The visible text first, in the order the cell shows it (voice control finds the cell by what it shows), then the
  // column and the full alias path.
  const shown = studio
    ? [v.alias ? swatchLabel(v.alias) : v.line || cssText(type, v.raw), v.error ? 'Unresolved' : type === 'color' ? (v.hex ?? v.css) : v.alias ? v.line : '']
    : [v.alias ? aliasLabel(v.alias) : v.line || cssText(type, v.raw), v.alias || v.error ? v.line : ''];
  const visible = shown.filter(Boolean).join(' ');
  return `${visible || (v.error ? 'Unresolved' : '')}, ${col.label}${v.alias ? `, points to ${v.alias}` : ''}`;
}

export const inkClass = (hex?: string) => `ink-${inkOn(hex)}`;
