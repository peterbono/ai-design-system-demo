// The Studio cell editor: ONE popover anchored to the value cell (a bottom sheet on phones). It decides from the
// swatches: palette families as tabs, one ramp with the current step ringed, one contrast line for the pending value,
// and More options (raw value, the other mode, the description) on demand. Nothing changes until Apply, which adds
// the edit to the local draft (scripts/token-editor.ts: same draft, guardrails and pull request as before). Under the
// contrast line, a mini preview of the real components that use the token, light and dark, repaints on every pick.
import { aliasTarget, hexToRgba, isAlias, parseColor, rgbaToDtcg, rgbaToHex, type ContrastResult } from '@bridge-ds/core';
import { contrastSummary, shortName, summarizePairs, type ContrastSummary } from '../../lib/explorer/contrast-summary';
import { componentsUsing, transitiveDependents } from '../../lib/explorer/flow';
import { isStageToken, previewSamples } from '../../lib/preview-fit';
import { fitFrames, sampleFrame, sampleNames, sampleTemplate } from './preview-frames';
import { cssText } from '../../lib/explorer/format';
import { cellValue, modeKeyFor, tierAxis, type Column } from '../../lib/explorer/model';
import { familyTabs, locateSwatch, rampFamilies, rampTicks, swatchLabel, type RampFamily, type Swatch } from '../../lib/explorer/swatch-ramp';
import { aliasOptions, applyValues, draftDescription, draftValue, editDescription, pendingOverrides, previewContrast } from '../token-editor';
import type { ExplorerData } from './types';
import { esc, icon } from './util';

interface Open {
  pop: HTMLElement;
  cell: HTMLElement;
  dispose: () => void;
}
let current: Open | null = null;

export const inlineEditorOpen = () => current !== null;

/** Closes the editor without applying. Focus goes back to the cell unless the caller moves it elsewhere. */
export function closeInlineEditor(returnFocus = true) {
  if (!current) return;
  const { pop, cell, dispose } = current;
  current = null;
  dispose();
  pop.remove();
  cell.removeAttribute('data-open');
  cell.setAttribute('aria-expanded', 'false');
  if (returnFocus) cell.focus({ preventScroll: true });
}

const colorOf = (value: unknown): string | undefined => {
  const c = isAlias(value) ? undefined : parseColor(value);
  return c ? rgbaToHex(c).slice(0, 7) : undefined;
};

/** Raw value field of More options, by type. */
function rawField(type: string, value: unknown, id: string): string {
  if (type === 'color') {
    const hex = colorOf(value) ?? '';
    return `<div class="xe-raw"><input type="color" value="${hex || '#000000'}" data-xe-color aria-label="Pick any color" /><input id="${id}" class="xe-input mono" value="${esc(hex)}" placeholder="#rrggbb" data-xe-hex spellcheck="false" autocomplete="off" /></div>`;
  }
  if (type === 'dimension' || type === 'duration') {
    const d = !isAlias(value) && value && typeof value === 'object' ? (value as { value: number; unit: string }) : { value: '', unit: type === 'duration' ? 'ms' : 'px' };
    return `<div class="xe-raw"><input id="${id}" class="xe-input num" type="number" value="${esc(String(d.value))}" step="${type === 'duration' ? 25 : 1}" data-xe-num data-unit="${esc(d.unit)}" /><span class="xe-unit mono">${esc(d.unit)}</span></div>`;
  }
  return `<input id="${id}" class="xe-input mono" value="${esc(isAlias(value) ? '' : JSON.stringify(value))}" data-xe-json spellcheck="false" autocomplete="off" />`;
}

/** Text of a value in the pick row: the alias as a short name, or the literal. */
function valueText(type: string, value: unknown): string {
  if (isAlias(value)) return swatchLabel(aliasTarget(value));
  if (type === 'color') return colorOf(value) ?? 'Raw value';
  return cssText(type, value) || 'Raw value';
}

function position(pop: HTMLElement, cell: HTMLElement, container: HTMLElement) {
  if (window.matchMedia('(max-width: 640px)').matches) {
    pop.classList.add('is-sheet');
    return;
  }
  const c = container.getBoundingClientRect();
  const r = cell.getBoundingClientRect();
  const width = Math.min(360, c.width - 16);
  pop.style.width = `${width}px`;
  const left = Math.max(8, Math.min(r.left - c.left, c.width - width - 8));
  pop.style.left = `${left}px`;
  pop.style.setProperty('--xe-arrow', `${Math.max(16, Math.min(r.left - c.left - left + 24, width - 24))}px`);
  const place = () => {
    const h = pop.offsetHeight;
    const below = r.bottom - c.top + 8;
    // Under the cell when it fits in the viewport, else above it: the edited value stays visible either way.
    const fitsBelow = r.bottom + 8 + h <= window.innerHeight - 8 || r.top - h - 8 < 64;
    pop.classList.toggle('is-above', !fitsBelow);
    pop.style.top = `${fitsBelow ? below : r.top - c.top - h - 8}px`;
  };
  place();
  requestAnimationFrame(place);
}

/** Opens the editor on a value cell. */
export function openInlineEditor(opts: { container: HTMLElement; cell: HTMLElement; d: ExplorerData; path: string; col: Column; columns: Column[] }) {
  closeInlineEditor(false);
  const { container, cell, d, path, col, columns } = opts;
  const t = d.head.byPath.get(path);
  if (!t) return;
  const mode = modeKeyFor(t.tier, col);
  const axis = tierAxis(t.tier);
  // The other mode of this token (Dark when editing Light), for "Edit dark too".
  const other = columns.map((c) => ({ col: c, mode: modeKeyFor(t.tier, c) })).find((x) => x.mode !== mode);
  const isColor = t.type === 'color';
  const options = aliasOptions(path);
  const candidates = options.map((p) => {
    const v = cellValue(d.head, p, col.ctx);
    return { path: p, hex: isColor ? v.hex : undefined, value: isColor ? v.hex : v.line };
  });
  const families: RampFamily[] = rampFamilies(candidates);
  const start = draftValue(path, mode);
  const startOther = other ? draftValue(path, other.mode) : undefined;
  const startDesc = draftDescription(path);
  const state = {
    value: start,
    otherValue: startOther,
    otherOn: false,
    desc: startDesc,
    family: Math.max(0, locateSwatch(families, isAlias(start) ? aliasTarget(start) : undefined)?.family ?? 0),
    moreOpen: false,
    showPairs: false,
    familyMenu: false,
  };
  const id = `xe-${Math.random().toString(36).slice(2, 8)}`;
  // Pairs in scope: the edited token and every token that aliases it, in the cell's brand and in the edited mode.
  const affected = new Set([path, ...transitiveDependents(d.head, path)]);
  const inScope = (r: ContrastResult, m: string) =>
    (affected.has(r.pair.foreground) || affected.has(r.pair.background)) &&
    (axis === 'brand' ? r.brand === m : r.brand === col.ctx.brand) &&
    (axis === 'theme' ? r.theme === m : true);

  // The real components that paint with this token, for the mini preview (at most three, light and dark).
  const tpl = sampleTemplate();
  const using = componentsUsing(path, [...affected].filter((p) => p !== path), d.usage).map((c) => c.name);
  const shown = previewSamples(using, sampleNames(tpl), { max: 3 });
  const isBg = isColor && isStageToken(path);
  const themes = d.modes.themes.length ? d.modes.themes : ['light'];

  const pop = document.createElement('div');
  pop.className = 'xe-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-labelledby', `${id}-title`);
  pop.dataset.theme = document.documentElement.dataset.theme ?? 'light';

  let summary: ContrastSummary | null = null;
  let failing: { fg: string; bg: string; ratio?: number; min: number }[] = [];
  const computeContrast = () => {
    if (!isColor) return;
    const pending = [{ path, mode, value: state.value }];
    if (state.otherOn && other) pending.push({ path, mode: other.mode, value: state.otherValue });
    const results = previewContrast(pending).filter((r) => inScope(r, mode) || (state.otherOn && other ? inScope(r, other.mode) : false));
    const checks = results.map((r) => ({ fg: r.pair.foreground, bg: r.pair.background, ratio: r.ratio, min: r.pair.min }));
    summary = contrastSummary(checks, path);
    failing = summarizePairs(checks).filter((p) => !p.passes);
  };

  const swatchBtn = (s: Swatch, i: number, selected: boolean, was: boolean, tab: boolean) =>
    isColor
      ? `<button type="button" role="radio" class="xe-sw${was ? ' is-was' : ''}" aria-checked="${selected}" tabindex="${tab ? 0 : -1}" data-xe-pick="${esc(s.path)}" data-i="${i}" aria-label="${esc(s.label)}, ${esc(s.hex ?? '')}"><i style="background-color:${esc(s.hex ?? 'transparent')}"></i><span class="xe-tip" aria-hidden="true">${esc(s.label)} · ${esc(s.hex ?? '')}</span></button>`
      : `<button type="button" role="radio" class="xe-step${was ? ' is-was' : ''}" aria-checked="${selected}" tabindex="${tab ? 0 : -1}" data-xe-pick="${esc(s.path)}" data-i="${i}"><span class="mono">${esc(s.step)}</span><span class="xe-step-v">${esc(s.value ?? '')}</span></button>`;

  const draw = () => {
    drawPop();
    paintPreview();
  };
  const drawPop = () => {
    const target = isAlias(state.value) ? aliasTarget(state.value) : undefined;
    const startTarget = isAlias(start) ? aliasTarget(start) : undefined;
    const fam = families[state.family];
    const tabs = familyTabs(families, state.family);
    const hex = isColor ? (target ? cellValue(d.head, target, col.ctx).hex : colorOf(state.value)) : undefined;
    const changed = JSON.stringify(state.value) !== JSON.stringify(start);
    const sub = isColor ? `${esc(hex ?? '')}${changed ? ` <span class="xe-was">· was ${esc(valueText(t.type, start))}</span>` : ''}` : changed ? `<span class="xe-was">was ${esc(valueText(t.type, start))}</span>` : '';
    const picker = fam
      ? `<div class="xe-tabs" role="tablist" aria-label="Families">${tabs.tabs
          .map((f) => `<button type="button" role="tab" aria-selected="${f === state.family}" tabindex="${f === state.family ? 0 : -1}" data-xe-family="${f}">${esc(families[f]!.label)}</button>`)
          .join('')}${
          tabs.more.length
            ? `<div class="xe-more-fam"><button type="button" class="xe-tab-more" aria-haspopup="true" aria-expanded="${state.familyMenu}" data-xe-family-menu>More ${icon('chevronDown', 14)}</button>${
                state.familyMenu ? `<div class="xe-fam-menu" role="menu">${tabs.more.map((f) => `<button type="button" role="menuitem" data-xe-family="${f}">${esc(families[f]!.label)}</button>`).join('')}</div>` : ''
              }</div>`
            : ''
        }</div>
        <div class="${isColor ? 'xe-ramp' : 'xe-steps'}" role="radiogroup" aria-label="${esc(fam.label)}" style="--xe-n:${fam.swatches.length}">${fam.swatches
          .map((s, i, all) => swatchBtn(s, i, s.path === target, s.path === startTarget && s.path !== target, s.path === target || (i === 0 && !all.some((x) => x.path === target))))
          .join('')}</div>
        ${isColor ? `<div class="xe-ticks" aria-hidden="true" style="--xe-n:${fam.swatches.length}">${rampTicks(fam.swatches).map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}`
      : '';
    const status = !isColor || !summary
      ? ''
      : summary.tone === 'pass'
        ? `<div class="xe-status is-pass" role="status">${icon('check', 16)}<span>${esc(summary.text.replace(/(\d+ pairs?)/, '§$1§')).replace(/§(.+?)§/, '<strong>$1</strong>')}</span></div>`
        : summary.tone === 'fail'
          ? `<div class="xe-status is-warn" role="status">${icon('alert', 16)}<span>${esc(summary.text)}</span><button type="button" class="xe-link" aria-expanded="${state.showPairs}" data-xe-pairs>${state.showPairs ? 'Hide pairs' : 'See pairs'}</button></div>${
              state.showPairs
                ? `<ul class="xe-pairs">${failing
                    .map((p) => `<li><span class="mono">${esc(shortName(p.fg))} on ${esc(shortName(p.bg))}</span><span class="num">${p.ratio === undefined ? 'n/a' : `${p.ratio.toFixed(2)}:1`}, needs ${p.min}</span></li>`)
                    .join('')}</ul>`
                : ''
            }`
          : `<div class="xe-status" role="status">${icon('info', 16)}<span>${esc(summary.text)}</span></div>`;
    const otherLabel = other ? other.col.label : '';
    const more = `<div class="xe-more" id="${id}-more" ${state.moreOpen || !fam ? '' : 'hidden'}>
        <label class="xe-label" for="${id}-raw">${fam ? 'Raw value' : 'Value'}</label>${rawField(t.type, state.value, `${id}-raw`)}
        ${
          other
            ? `<label class="xe-check"><input type="checkbox" data-xe-other-on ${state.otherOn ? 'checked' : ''} /> Edit ${esc(otherLabel.toLowerCase())} too</label>
               ${
                 state.otherOn
                   ? `<label class="xe-label" for="${id}-other">${esc(otherLabel)} points to</label><input id="${id}-other" class="xe-input mono" list="${id}-list" value="${esc(isAlias(state.otherValue) ? aliasTarget(state.otherValue) : '')}" data-xe-other spellcheck="false" autocomplete="off" /><datalist id="${id}-list">${options
                       .map((o) => `<option value="${esc(o)}"></option>`)
                       .join('')}</datalist>`
                   : ''
               }`
            : ''
        }
        <label class="xe-label" for="${id}-desc">Description</label><textarea id="${id}-desc" class="xe-input" rows="2" data-xe-desc>${esc(state.desc)}</textarea>
      </div>`;
    pop.innerHTML = `
      <p class="xe-title" id="${id}-title"><span class="mono">${esc(path)}</span> <span class="xe-mode">· ${esc(col.label)}</span></p>
      <div class="xe-pick">${isColor ? `<span class="xe-big" style="background-color:${esc(hex ?? 'transparent')}" aria-hidden="true"></span>` : ''}<span><span class="xe-pick-name mono">${esc(valueText(t.type, state.value))}</span><span class="xe-pick-sub mono">${sub}</span></span></div>
      ${picker}
      ${status}
      ${shown.usesToken ? `<div class="xe-pop-pv" data-xe-pop-pv><p class="xe-pop-pv-label">${esc(shown.names.join(', '))}, as they will look</p><div class="xe-pop-pv-grid" data-xe-pop-pv-grid></div></div>` : ''}
      ${more}
      <div class="xe-foot">
        ${fam ? `<button type="button" class="xe-more-btn" aria-expanded="${state.moreOpen}" aria-controls="${id}-more" data-xe-more>${icon('chevron', 14)}More options</button>` : ''}
        <span class="xe-grow"></span>
        <button type="button" class="btn btn-secondary btn-sm" data-xe-cancel>Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" data-xe-apply>Apply</button>
      </div>`;
  };

  /** Light and dark frames of the components, with the pending value painted on top of the draft. */
  const paintPreview = () => {
    const grid = pop.querySelector<HTMLElement>('[data-xe-pop-pv-grid]');
    if (!grid || !tpl || !shown.usesToken) return;
    const pending = [{ path, mode, value: state.value }];
    if (state.otherOn && other && state.otherValue !== undefined) pending.push({ path, mode: other.mode, value: state.otherValue });
    const stage = isBg ? `var(--${path.replace(/\./g, '-')})` : 'var(--color-bg-default)';
    for (const theme of themes) {
      const ctx = { brand: axis === 'brand' ? mode : col.ctx.brand, theme, density: col.ctx.density };
      const edited = axis !== 'theme' || theme === mode || (state.otherOn && other?.mode === theme);
      const cell = document.createElement('div');
      cell.className = 'xe-pv-col';
      cell.innerHTML = `<p class="xe-pv-label">${esc(theme.charAt(0).toUpperCase() + theme.slice(1))}${edited ? '' : ', unchanged'}</p>`;
      cell.append(sampleFrame(tpl, shown.names, ctx, pendingOverrides(pending, ctx), stage));
      grid.append(cell);
    }
    requestAnimationFrame(() => fitFrames(grid));
  };

  let timer = 0;
  const refresh = (focusSel?: string) => {
    draw();
    if (focusSel) pop.querySelector<HTMLElement>(focusSel)?.focus();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      computeContrast();
      const active = document.activeElement;
      const sel = active instanceof HTMLElement && pop.contains(active) ? selectorOf(active) : null;
      draw();
      if (sel) pop.querySelector<HTMLElement>(sel)?.focus();
    }, 40);
  };
  const selectorOf = (el: HTMLElement) => {
    if (el.dataset.xePick) return `[data-xe-pick="${CSS.escape(el.dataset.xePick)}"]`;
    if (el.dataset.xeFamily) return `[role="tab"][data-xe-family="${el.dataset.xeFamily}"]`;
    for (const a of ['data-xe-hex', 'data-xe-num', 'data-xe-json', 'data-xe-other', 'data-xe-desc', 'data-xe-more', 'data-xe-pairs', 'data-xe-apply', 'data-xe-cancel', 'data-xe-other-on', 'data-xe-color'])
      if (el.hasAttribute(a)) return `[${a}]`;
    return null;
  };

  const apply = () => {
    const values = [{ path, mode, value: state.value }];
    if (state.otherOn && other && state.otherValue !== undefined) values.push({ path, mode: other.mode, value: state.otherValue });
    applyValues(values);
    if (state.desc.trim() !== startDesc.trim()) editDescription(path, state.desc);
    closeInlineEditor();
  };

  pop.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.xePick) {
      state.value = `{${b.dataset.xePick}}`;
      refresh(`[data-xe-pick="${CSS.escape(b.dataset.xePick)}"]`);
    } else if (b.dataset.xeFamily !== undefined) {
      state.family = Number(b.dataset.xeFamily);
      state.familyMenu = false;
      refresh(`[role="tab"][data-xe-family="${state.family}"]`);
    } else if (b.hasAttribute('data-xe-family-menu')) {
      state.familyMenu = !state.familyMenu;
      draw();
      pop.querySelector<HTMLElement>(state.familyMenu ? '.xe-fam-menu button' : '[data-xe-family-menu]')?.focus();
    } else if (b.hasAttribute('data-xe-pairs')) {
      state.showPairs = !state.showPairs;
      draw();
      pop.querySelector<HTMLElement>('[data-xe-pairs]')?.focus();
    } else if (b.hasAttribute('data-xe-more')) {
      state.moreOpen = !state.moreOpen;
      draw();
      pop.querySelector<HTMLElement>(state.moreOpen ? '[data-xe-hex], [data-xe-num], [data-xe-json]' : '[data-xe-more]')?.focus();
    } else if (b.hasAttribute('data-xe-cancel')) closeInlineEditor();
    else if (b.hasAttribute('data-xe-apply')) apply();
  });
  pop.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches('[data-xe-color]')) {
      const c = hexToRgba(el.value);
      if (c) state.value = rgbaToDtcg(c);
      refresh('[data-xe-color]');
    } else if (el.matches('[data-xe-hex]')) {
      const v = el.value.trim();
      const ok = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v);
      el.setAttribute('aria-invalid', String(!ok && v !== ''));
      const c = ok ? hexToRgba(v) : undefined;
      if (!c) return;
      state.value = rgbaToDtcg(c);
      refreshKeepCaret(el, '[data-xe-hex]');
    } else if (el.matches('[data-xe-num]')) {
      const n = Number(el.value);
      if (el.value === '' || !Number.isFinite(n)) return;
      state.value = { value: n, unit: el.dataset.unit ?? 'px' };
      refreshKeepCaret(el, '[data-xe-num]');
    } else if (el.matches('[data-xe-json]')) {
      try {
        state.value = JSON.parse(el.value);
        el.setAttribute('aria-invalid', 'false');
        refreshKeepCaret(el, '[data-xe-json]');
      } catch {
        el.setAttribute('aria-invalid', 'true');
      }
    } else if (el.matches('[data-xe-other]')) {
      const p = el.value.trim();
      const ok = options.includes(p);
      el.setAttribute('aria-invalid', String(Boolean(p) && !ok));
      if (ok) {
        state.otherValue = `{${p}}`;
        computeContrast();
        refreshKeepCaret(el, '[data-xe-other]');
      }
    } else if (el.matches('[data-xe-desc]')) state.desc = el.value;
  });
  pop.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches('[data-xe-other-on]')) {
      state.otherOn = el.checked;
      refresh('[data-xe-other-on]');
    }
  });
  // Re-render without losing the caret in a text field.
  const refreshKeepCaret = (el: HTMLInputElement | HTMLTextAreaElement, sel: string) => {
    const pos = el.selectionStart;
    const val = el.value;
    refresh(sel);
    const again = pop.querySelector<HTMLInputElement>(sel);
    if (again && again.value !== val) again.value = val;
    try {
      if (again && pos !== null) again.setSelectionRange(pos, pos);
    } catch {
      /* number inputs have no selection */
    }
  };

  pop.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (state.familyMenu) {
        state.familyMenu = false;
        draw();
        pop.querySelector<HTMLElement>('[data-xe-family-menu]')?.focus();
        return;
      }
      closeInlineEditor();
      return;
    }
    // Arrow keys move inside the ramp (and select, like a radio group) and across the family tabs.
    const group = el.closest('[role="radiogroup"], [role="tablist"]');
    if (group && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      const items = [...group.querySelectorAll<HTMLElement>('[role="radio"], [role="tab"]')];
      const i = items.indexOf(el);
      if (i !== -1) {
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(items.length - 1, i + 1);
        items[next]?.click();
      }
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      apply();
    } else if (e.key === 'Tab') {
      const f = [...pop.querySelectorAll<HTMLElement>('input, textarea, button:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1]!.focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0]!.focus();
      }
    }
    e.stopPropagation();
  });

  const outside = (e: PointerEvent) => {
    if (!pop.contains(e.target as Node) && !cell.contains(e.target as Node)) closeInlineEditor(false);
  };
  document.addEventListener('pointerdown', outside, true);

  computeContrast();
  draw();
  container.append(pop);
  cell.dataset.open = '';
  cell.setAttribute('aria-expanded', 'true');
  position(pop, cell, container);
  current = {
    pop,
    cell,
    dispose: () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', outside, true);
    },
  };
  (pop.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ?? pop.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? pop.querySelector<HTMLElement>('input, textarea, button'))?.focus();
}
