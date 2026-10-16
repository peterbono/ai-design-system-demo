// Inline cell editing (mode="edit"): a small popover anchored to the cell with the alias picker (same $type, tier
// rules), a color picker or a dimension stepper for raw values, and live contrast. Every change goes through the
// existing token editor (scripts/token-editor.ts): same draft, guardrails, tray and pull request.
import { aliasTarget, contextLabel, hexToRgba, isAlias, parseColor, rgbaToDtcg, rgbaToHex, TIER_NAMES } from '@bridge-ds/core';
import { contrastMoves } from '../../lib/editor-model';
import { aliasLabel, colorHex } from '../../lib/explorer/format';
import { cellValue, modeKeyFor, tierAxis, type Column } from '../../lib/explorer/model';
import { aliasOptions, draftValue, editorSnapshot, editValue, undoToken } from '../token-editor';
import type { ExplorerData } from './types';
import { esc, icon } from './util';

let current: { pop: HTMLElement; cell: HTMLElement; dispose: () => void } | null = null;

export const inlineEditorOpen = () => current !== null;

export function closeInlineEditor(returnFocus = true) {
  if (!current) return;
  const { pop, cell, dispose } = current;
  current = null;
  dispose();
  pop.remove();
  if (returnFocus) cell.focus();
}

function rawEditor(type: string, value: unknown): string {
  if (type === 'color') {
    const c = isAlias(value) ? undefined : parseColor(value);
    const hex = c ? rgbaToHex(c).slice(0, 7) : '#000000';
    return `<div class="ed-raw-row"><input type="color" value="${hex}" data-xe-color aria-label="Pick a color" /><input class="ed-input mono" value="${hex}" data-xe-hex aria-label="Hex value" spellcheck="false" autocomplete="off" /></div>`;
  }
  if (type === 'dimension' || type === 'duration') {
    const d = !isAlias(value) && value && typeof value === 'object' ? (value as { value: number; unit: string }) : { value: 0, unit: type === 'duration' ? 'ms' : 'px' };
    const step = type === 'duration' ? 25 : 1;
    return `<div class="ed-raw-row"><button type="button" class="ed-step" data-xe-step="-1" aria-label="Decrease by ${step}">-</button><input class="ed-input num" type="number" value="${d.value}" step="${step}" data-xe-num aria-label="Value in ${esc(
      d.unit,
    )}" /><button type="button" class="ed-step" data-xe-step="1" aria-label="Increase by ${step}">+</button><span class="ed-unit mono" data-xe-unit>${esc(d.unit)}</span></div>`;
  }
  return `<input class="ed-input mono" value="${esc(isAlias(value) ? '' : JSON.stringify(value))}" data-xe-json aria-label="Raw value as JSON" spellcheck="false" />`;
}

function liveHtml(path: string): string {
  const snap = editorSnapshot();
  if (!snap) return '';
  const moves = contrastMoves({ contrastBefore: snap.contrastBefore, contrastAfter: snap.contrastAfter });
  const mine = moves.filter((m) => m.fg === path || m.bg === path);
  const shown = (mine.length ? mine : moves).sort((a, b) => Number(a.after >= a.min) - Number(b.after >= b.min)).slice(0, 6);
  const fails = shown.filter((m) => m.after < m.min).length;
  const blocking = snap.checks?.blocking.filter((i) => i.code !== 'contrast' && (!i.path || i.path === path)) ?? [];
  const rows = shown
    .map((m) => {
      const fail = m.after < m.min;
      return `<li class="xp-move${fail ? ' is-fail' : ''}"><span class="mono small">${esc(aliasLabel(m.fg))} on ${esc(aliasLabel(m.bg))}</span><span class="small muted">${esc(m.where)}</span><span class="num small">${
        m.before?.toFixed(2) ?? '?'
      } ${icon('arrowRight', 12)} <strong>${m.after.toFixed(2)}</strong></span><span class="xp-badge ${fail ? 'is-fail' : 'is-pass'}">${icon(fail ? 'x' : 'check', 12)}${fail ? `Fail, needs ${m.min}` : 'Pass'}</span></li>`;
    })
    .join('');
  const head = !snap.draft.edits.length
    ? '<p class="small muted">Contrast updates as you edit.</p>'
    : fails
      ? `<p class="xp-live-head is-fail" role="alert">${icon('alert', 16)} ${fails} contrast pair${fails > 1 ? 's' : ''} fail${fails > 1 ? '' : 's'}. Pick a value with more contrast before you propose.</p>`
      : shown.length
        ? `<p class="xp-live-head is-pass">${icon('check', 16)} Contrast still passes for the pairs this edit moves.</p>`
        : '<p class="small muted">No checked contrast pair moves with this edit.</p>';
  const block = blocking.length ? `<div class="ed-block"><strong>Proposing is blocked</strong><ul>${blocking.slice(0, 3).map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul></div>` : '';
  return `${head}${rows ? `<ul class="xp-moves">${rows}</ul>` : ''}${block}`;
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
  // Beside the cell when there is room (the edited value stays visible), else under it; always inside the pane.
  const right = r.right - c.left + 8;
  const left = right + width <= c.width - 8 ? right : Math.max(8, Math.min(r.left - c.left, c.width - width - 8));
  const beside = left === right;
  pop.style.left = `${left}px`;
  const place = () => {
    const h = pop.offsetHeight;
    const want = beside ? r.top - c.top - 8 : r.bottom - c.top + 6;
    const top = Math.max(8, Math.min(want, c.height - h - 8));
    pop.style.top = `${top}px`;
  };
  place();
  requestAnimationFrame(place);
}

/** Opens the inline editor on a mode cell. `onChange` runs after each draft recompute so the grid repaints. */
export function openInlineEditor(opts: { container: HTMLElement; cell: HTMLElement; d: ExplorerData; path: string; col: Column }) {
  closeInlineEditor(false);
  const { container, cell, d, path, col } = opts;
  const t = d.head.byPath.get(path);
  if (!t) return;
  const mode = modeKeyFor(t.tier, col);
  const single = !tierAxis(t.tier);
  const options = aliasOptions(path);
  const listId = `xe-${Math.random().toString(36).slice(2, 8)}`;
  const pop = document.createElement('div');
  pop.className = 'xp-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Edit ${path}, ${col.label}`);

  const draw = () => {
    const v = draftValue(path, mode);
    const alias = isAlias(v) ? aliasTarget(v) : '';
    const hex = t.type === 'color' ? cellValue(d.set, path, col.ctx).hex : undefined;
    const primitive = t.tier === 'primitive';
    const scope = single ? 'one value for every mode' : `${col.label.toLowerCase()} only`;
    const shadowed = cellValue(d.head, path, col.ctx).override
      ? `<p class="ed-note is-semantic">${esc(contextLabel({ brand: col.ctx.brand, theme: col.ctx.theme }))} reads a brand override, so this edit changes the other brands only. Edit the override file to change ${esc(
          contextLabel({ brand: col.ctx.brand, theme: col.ctx.theme }),
        )}.</p>`
      : '';
    pop.innerHTML = `
      <div class="xp-pop-head">
        <div><p class="xp-pop-title mono">${esc(path)}</p><p class="xp-pop-sub">${esc(TIER_NAMES[t.tier])}, ${esc(scope)}</p></div>
        <button type="button" class="icon-btn" data-xe-close aria-label="Close editor">${icon('close', 16)}</button>
      </div>
      ${shadowed}
      ${
        primitive
          ? `<label class="ed-label">Value</label>${rawEditor(t.type, v)}`
          : `<label class="ed-label" for="${listId}-in">Points to</label>
             <div class="ed-alias">${hex ? `<span class="ed-sw" style="background-color:${hex}"></span>` : ''}<input id="${listId}-in" class="ed-input mono" list="${listId}" value="${esc(alias)}" placeholder="${
               alias ? '' : 'Raw value below'
             }" data-xe-alias spellcheck="false" autocomplete="off" /></div>
             <datalist id="${listId}">${options.map((o) => `<option value="${esc(o)}" label="${esc(aliasLabel(o))}"></option>`).join('')}</datalist>
             <p class="ed-hint">${options.length} ${esc(t.type)} tokens you can point to from ${esc(TIER_NAMES[t.tier])}.</p>
             <details class="ed-rawbox"${alias ? '' : ' open'}><summary>Use a raw value${t.tier === 'semantic' || t.tier === 'component' ? ' (not recommended)' : ''}</summary>${rawEditor(t.type, v)}</details>`
      }
      <div class="xp-live" data-xe-live aria-live="polite">${liveHtml(path)}</div>
      <div class="xp-pop-foot">
        <button type="button" class="btn btn-secondary btn-sm" data-xe-undo>Undo edits on this token</button>
        <button type="button" class="btn btn-primary btn-sm" data-xe-done>Done</button>
      </div>`;
  };

  pop.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches('[data-xe-alias]')) {
      const p = el.value.trim();
      if (p && (d.head.byPath.has(p) || options.includes(p))) editValue(path, mode, `{${p}}`);
      el.setAttribute('aria-invalid', String(Boolean(p) && !d.head.byPath.has(p)));
    } else if (el.matches('[data-xe-color]')) {
      const hexIn = pop.querySelector<HTMLInputElement>('[data-xe-hex]');
      if (hexIn) hexIn.value = el.value;
      const c = hexToRgba(el.value);
      if (c) editValue(path, mode, rgbaToDtcg(c));
    } else if (el.matches('[data-xe-hex]')) {
      const ok = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(el.value.trim());
      el.setAttribute('aria-invalid', String(!ok));
      const c = ok ? hexToRgba(el.value.trim()) : undefined;
      if (c) {
        editValue(path, mode, rgbaToDtcg(c));
        const picker = pop.querySelector<HTMLInputElement>('[data-xe-color]');
        if (picker) picker.value = el.value.trim().slice(0, 7);
      }
    } else if (el.matches('[data-xe-num]')) {
      const unit = pop.querySelector('[data-xe-unit]')?.textContent ?? 'px';
      const n = Number(el.value);
      if (el.value !== '' && Number.isFinite(n)) editValue(path, mode, { value: n, unit });
    } else if (el.matches('[data-xe-json]')) {
      try {
        editValue(path, mode, JSON.parse(el.value));
        el.setAttribute('aria-invalid', 'false');
      } catch {
        el.setAttribute('aria-invalid', 'true');
      }
    }
  });
  pop.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.xeStep) {
      const input = pop.querySelector<HTMLInputElement>('[data-xe-num]');
      if (input) {
        input.value = String(Number(input.value) + Number(b.dataset.xeStep) * Number(input.step || 1));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else if (b.hasAttribute('data-xe-undo')) {
      undoToken(path);
      window.setTimeout(draw, 80);
    } else if (b.hasAttribute('data-xe-done') || b.hasAttribute('data-xe-close')) closeInlineEditor();
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeInlineEditor();
    } else if (e.key === 'Tab') {
      // Keep focus inside the popover while it is open.
      const f = [...pop.querySelectorAll<HTMLElement>('input, button, summary, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
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

  const onDraft = () => {
    const live = pop.querySelector<HTMLElement>('[data-xe-live]');
    if (live) live.innerHTML = liveHtml(path);
    const sw = pop.querySelector<HTMLElement>('.ed-alias .ed-sw');
    if (sw && t.type === 'color') {
      const snap = editorSnapshot();
      const hex = snap ? colorHex(cellValue(snap.proposed, path, col.ctx).resolved) : undefined;
      if (hex) sw.style.backgroundColor = hex;
    }
  };
  document.addEventListener('bridge:draft', onDraft);
  const outside = (e: PointerEvent) => {
    if (!pop.contains(e.target as Node) && !cell.contains(e.target as Node)) closeInlineEditor(false);
  };
  document.addEventListener('pointerdown', outside, true);

  draw();
  container.append(pop);
  position(pop, cell, container);
  current = {
    pop,
    cell,
    dispose: () => {
      document.removeEventListener('bridge:draft', onDraft);
      document.removeEventListener('pointerdown', outside, true);
    },
  };
  pop.querySelector<HTMLElement>('input:not([type="color"]), input')?.focus();
}
