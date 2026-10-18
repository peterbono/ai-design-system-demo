// After Apply: a slim bar "N changes · Review" at the bottom of Studio Tokens, and the review side sheet it opens.
// The sheet shows each change as before and after per mode, then the impact collapsed with counts (contrast, the
// components using it, a visual preview of those real components on that background), and one primary action:
// Propose change (Connect GitHub to propose without a token). Proposing still goes through scripts/token-editor.ts.
import type { ContrastResult } from '@bridge-ds/core';
import { contrastCountLine, shortName, summarizePairs } from '../../lib/explorer/contrast-summary';
import { componentsUsing, stylesUsing, transitiveDependents, usedByLine } from '../../lib/explorer/flow';
import { cellValue, tierAxis } from '../../lib/explorer/model';
import { swatchLabel } from '../../lib/explorer/swatch-ramp';
import { isAlias, aliasTarget } from '@bridge-ds/core';
import type { DraftEdit } from '../../lib/editor-model';
import { initGitHubConnect, setButtonLabel } from '../github-session';
import { currentScope } from '../shell';
import { discardDraft, draftOverrides, editorSnapshot, undoEdit } from '../token-editor';
import type { ExplorerData } from './types';
import { esc, icon } from './util';
import { previewSamples } from '../../lib/preview-fit';
import { fitFrames, sampleFrame, sampleNames } from './preview-frames';

const FALLBACK_SAMPLES = ['Card', 'Table', 'Button'];
const MODE_NAME: Record<string, string> = { light: 'Light', dark: 'Dark', bridge: 'Bridge', ocean: 'Ocean', comfortable: 'Comfortable', compact: 'Compact', value: 'Value' };
const modeLabel = (m: string) => MODE_NAME[m] ?? m.charAt(0).toUpperCase() + m.slice(1);

type ValueEdit = Extract<DraftEdit, { kind: 'value' }>;

export function initReview(d: ExplorerData) {
  const bar = document.querySelector<HTMLElement>('[data-xe-bar]');
  const sheet = document.querySelector<HTMLElement>('[data-xe-sheet]');
  const scrim = document.querySelector<HTMLElement>('[data-xe-scrim]');
  const body = document.querySelector<HTMLElement>('[data-xe-sheet-body]');
  const title = document.querySelector<HTMLElement>('[data-xe-sheet-title]');
  const propose = document.getElementById('ed-propose') as HTMLButtonElement | null;
  const note = document.querySelector<HTMLElement>('[data-xe-note]');
  const samples = document.querySelector<HTMLTemplateElement>('template[data-xe-samples]');
  if (!bar || !sheet || !scrim || !body || !title) return;
  // The visual preview is what a designer reviews first: open by default, the other sections on demand.
  const open = new Set<string>(['preview']);
  let returnTo: HTMLElement | null = null;

  initGitHubConnect((viewer) => {
    // Without GitHub the primary action connects first (the shared dialog), then proposes: the draft is kept.
    if (propose) {
      setButtonLabel(propose, viewer ? 'Send for review' : 'Connect GitHub to send');
      propose.toggleAttribute('data-gh-open', !viewer);
    }
    if (note) note.hidden = Boolean(viewer);
  });

  // Docs edits share the draft but are proposed from the docs editor: this sheet reviews token edits only.
  const tokenOnly = (es: DraftEdit[]) => es.filter((e) => e.kind !== 'docs');
  const count = () => {
    const snap = editorSnapshot();
    return snap ? new Set(tokenOnly(snap.draft.edits).map((e) => (e.kind === 'value' ? `${e.path}|${e.mode}` : `${e.kind}|${e.path}`))).size : 0;
  };

  const paintBar = () => {
    const n = count();
    bar.hidden = n === 0 || !sheet.hidden;
    const label = bar.querySelector('[data-xe-bar-count]');
    if (label) label.textContent = `${n} change${n === 1 ? '' : 's'}`;
  };

  const swatch = (hex?: string) => (hex ? `<span class="xe-ms" style="background-color:${esc(hex)}" aria-hidden="true"></span>` : '');

  function changeCards(edits: DraftEdit[]): string {
    const snap = editorSnapshot()!;
    const brand = currentScope().brand;
    const paths = [...new Set(edits.map((e) => e.path))];
    return paths
      .map((path) => {
        const mine = edits.map((e, index) => ({ e, index })).filter((x) => x.e.path === path);
        const t = snap.head.byPath.get(path) ?? snap.proposed.byPath.get(path);
        const axis = t ? tierAxis(t.tier) : undefined;
        const modes = t ? Object.keys(t.values) : [];
        const valueEdits = mine.filter((x): x is { e: ValueEdit; index: number } => x.e.kind === 'value');
        const ctxFor = (m: string) => ({ brand: axis === 'brand' ? m : brand, theme: axis === 'theme' ? m : 'light', density: axis === 'density' ? m : 'comfortable' });
        const rows = modes.length
          ? modes
              .map((m) => {
                const ed = valueEdits.find((x) => x.e.mode === m);
                if (!ed) return valueEdits.length ? `<div class="xe-mode"><span>${esc(modeLabel(m))}</span><span class="xe-same">Unchanged</span></div>` : '';
                const ctx = ctxFor(m);
                const before = cellValue(snap.head, path, ctx);
                const after = cellValue(snap.proposed, path, ctx);
                const txt = (raw: unknown, line: string) => (isAlias(raw) ? swatchLabel(aliasTarget(raw)) : line);
                return `<div class="xe-mode"><span>${esc(modeLabel(m))}</span><span class="xe-ba mono">${swatch(before.hex)}${esc(txt(ed.e.before, before.line))}<span class="xe-arr">${icon('arrowRight', 14)}</span>${swatch(after.hex)}${esc(
                  txt(ed.e.after, after.line),
                )}</span></div>`;
              })
              .join('')
          : '';
        const others = mine
          .filter((x) => x.e.kind !== 'value')
          .map(({ e }) => {
            if (e.kind === 'description') return `<div class="xe-mode"><span>Description</span><span class="xe-desc">${esc(e.after || 'Removed')}</span></div>`;
            if (e.kind === 'rename') return `<div class="xe-mode"><span>Rename</span><span class="mono">${esc(e.to)}</span></div>`;
            if (e.kind === 'delete') return `<div class="xe-mode"><span>Delete</span><span class="xe-same">Removed from the token files</span></div>`;
            return `<div class="xe-mode"><span>New</span><span class="xe-same">New semantic token</span></div>`;
          })
          .join('');
        const idx = mine.map((x) => x.index).join(',');
        return `<div class="xe-chg"><div class="xe-chg-head"><span class="mono">${esc(path)}</span><button type="button" class="icon-btn" data-xe-undo="${idx}" aria-label="Undo the changes to ${esc(path)}" title="Undo">${icon('undo', 16)}</button></div>${rows}${others}</div>`;
      })
      .join('');
  }

  function impact(edits: DraftEdit[]): string {
    const snap = editorSnapshot()!;
    const brand = currentScope().brand;
    const paths = [...new Set(edits.map((e) => e.path))].filter((p) => snap.head.byPath.has(p) || snap.proposed.byPath.has(p));
    const affected = new Set(paths.flatMap((p) => [p, ...transitiveDependents(snap.proposed, p)]));
    const editedModes = new Map<string, Set<string>>();
    for (const e of edits) if (e.kind === 'value') (editedModes.get(e.path) ?? editedModes.set(e.path, new Set()).get(e.path)!).add(e.mode);
    const themeTouched = (r: ContrastResult) =>
      paths.some((p) => {
        const t = snap.head.byPath.get(p);
        const modes = editedModes.get(p);
        if (!t || !modes) return true;
        const axis = tierAxis(t.tier);
        return axis === 'theme' ? modes.has(r.theme ?? '') : axis === 'brand' ? modes.has(r.brand ?? '') : true;
      });
    const results = snap.contrastAfter.filter((r) => r.brand === brand && (affected.has(r.pair.foreground) || affected.has(r.pair.background)) && themeTouched(r));
    const before = new Map(snap.contrastBefore.map((r) => [`${r.brand}/${r.theme}:${r.pair.foreground}|${r.pair.background}`, r.ratio]));
    const rows = summarizePairs(results.map((r) => ({ fg: r.pair.foreground, bg: r.pair.background, ratio: r.ratio, min: r.pair.min })));
    const failing = rows.filter((r) => !r.passes).length;
    const contrastMeta = contrastCountLine({ pairs: rows.length, failing });
    const pairList = results
      .sort((a, b) => Number((a.ratio ?? 0) >= a.pair.min) - Number((b.ratio ?? 0) >= b.pair.min))
      .slice(0, 24)
      .map((r) => {
        const fail = (r.ratio ?? 0) < r.pair.min;
        const was = before.get(`${r.brand}/${r.theme}:${r.pair.foreground}|${r.pair.background}`);
        return `<li class="${fail ? 'is-fail' : ''}"><span class="mono">${esc(shortName(r.pair.foreground))} on ${esc(shortName(r.pair.background))}</span><span class="xe-ctx">${esc(modeLabel(r.theme))}</span><span class="num">${
          was !== undefined && was !== r.ratio ? `${was.toFixed(2)} ${icon('arrowRight', 12)} ` : ''
        }${r.ratio === undefined ? 'n/a' : `${r.ratio.toFixed(2)}:1`}</span><span class="xe-badge ${fail ? 'is-fail' : 'is-pass'}">${icon(fail ? 'x' : 'check', 12)}${fail ? `Needs ${r.pair.min}` : 'Pass'}</span></li>`;
      })
      .join('');

    const comps = [...new Map(paths.flatMap((p) => componentsUsing(p, transitiveDependents(snap.proposed, p), d.usage)).map((c) => [c.name, c])).values()];
    const styles = [...new Set(paths.flatMap((p) => stylesUsing(p, transitiveDependents(snap.proposed, p), d.usage)))].sort();
    const usedMeta = usedByLine(comps.length, styles);
    const compBody = comps.length ? `<ul class="xe-comps">${comps.map((c) => `<li><a href="${esc(c.href)}">${esc(c.name)}</a></li>`).join('')}</ul>` : '';
    const styleBody = styles.length ? `<p class="xe-sublab">Global styles</p><ul class="xe-comps">${styles.map((f) => `<li><span class="mono">${esc(f)}</span></li>`).join('')}</ul>` : '';
    const usedBody =
      compBody || styleBody
        ? `${compBody}${styleBody}`
        : '<p class="xe-empty">No component or global stylesheet reads it. It can still be used by product code.</p>';

    const shown = previewSamples(
      comps.map((c) => c.name),
      sampleNames(samples),
      { max: 4, fallback: FALLBACK_SAMPLES },
    ).names;
    const previewMeta = shown.join(', ');

    const sec = (key: string, ic: 'contrast' | 'box' | 'eye', label: string, meta: string, content: string, tone = '') =>
      `<details class="xe-acc" data-xe-sec="${key}" ${open.has(key) ? 'open' : ''}><summary>${icon(ic, 18)}<span class="xe-acc-label">${esc(label)}</span><span class="xe-acc-meta ${tone}">${
        tone === 'is-pass' ? icon('check', 14) : tone === 'is-fail' ? icon('alert', 14) : ''
      }${esc(meta)}</span><span class="xe-acc-chev">${icon('chevron', 16)}</span></summary><div class="xe-acc-body">${content}</div></details>`;
    return `<p class="xe-lab">Impact</p>
      ${sec('preview', 'eye', 'Visual preview', previewMeta, `<div data-xe-preview data-samples="${esc(shown.join(','))}"></div>`)}
      ${sec('contrast', 'contrast', 'Contrast', contrastMeta, rows.length ? `<ul class="xe-pairlist">${pairList}</ul>` : '<p class="xe-empty">No checked contrast pair moves with this change.</p>', rows.length ? (failing ? 'is-fail' : 'is-pass') : '')}
      ${sec('used', 'box', 'Used by', usedMeta, usedBody)}`;
  }

  /**
   * Light and dark side by side, before above after, each frame filled with the real components that use the edited
   * token (scaled to fit). A theme the draft does not touch shows one frame, labeled unchanged.
   */
  function paintPreview(host: HTMLElement, edits: DraftEdit[]) {
    const snap = editorSnapshot();
    if (!snap || !samples) return;
    const names = (host.dataset.samples ?? '').split(',').filter(Boolean);
    const value = edits.find((e): e is ValueEdit => e.kind === 'value');
    const t = value ? snap.head.byPath.get(value.path) : undefined;
    const scope = currentScope();
    const axis = t ? tierAxis(t.tier) : undefined;
    const touched = new Set(edits.filter((e): e is ValueEdit => e.kind === 'value' && e.path === value?.path).map((e) => e.mode));
    const isBg = value && /\.(bg|surface)(\.|$)/.test(value.path) && t?.type === 'color';
    const stage = isBg ? `var(--${value!.path.replace(/\./g, '-')})` : 'var(--color-bg-default)';
    const brand = axis === 'brand' && value ? value.mode : scope.brand;
    const themes = d.modes.themes.length ? d.modes.themes : ['light'];
    const label = (text: string) => {
      const p = document.createElement('p');
      p.className = 'xe-pv-label';
      p.textContent = text;
      return p;
    };
    host.replaceChildren();
    const grid = document.createElement('div');
    grid.className = 'xe-pv';
    for (const theme of themes) {
      const ctx = { brand, theme, density: axis === 'density' && value ? value.mode : scope.density };
      // Theme tokens change only in the edited themes; brand, base and density edits show in every theme.
      const changed = !value || axis !== 'theme' || touched.has(theme);
      const col = document.createElement('div');
      col.className = 'xe-pv-col';
      const name = modeLabel(theme);
      if (changed) col.append(label(`${name}, before`), sampleFrame(samples, names, ctx, {}, stage), label(`${name}, after`), sampleFrame(samples, names, ctx, draftOverrides(ctx), stage));
      else {
        col.classList.add('is-unchanged');
        col.append(label(`${name}, unchanged`), sampleFrame(samples, names, ctx, draftOverrides(ctx), stage));
      }
      grid.append(col);
    }
    host.append(grid);
    host.insertAdjacentHTML('beforeend', `<p class="xe-legend">${esc(names.join(', '))} as they render ${isBg ? 'on this background' : 'on the page canvas'}.</p>`);
    requestAnimationFrame(() => fitFrames(grid));
  }

  const paintSheet = () => {
    const snap = editorSnapshot();
    if (!snap) return;
    const n = count();
    title.textContent = `Review ${n} change${n === 1 ? '' : 's'}`;
    if (!n) {
      body.innerHTML = '<p class="xe-empty">No change in your draft. Click a value in the table to change it.</p>';
      return;
    }
    const scroller = body.closest<HTMLElement>('[data-xe-sheet-scroll]') ?? body;
    const scroll = scroller.scrollTop;
    body.innerHTML = `${changeCards(tokenOnly(snap.draft.edits))}${impact(tokenOnly(snap.draft.edits))}`;
    const pv = body.querySelector<HTMLElement>('[data-xe-preview]');
    if (pv && open.has('preview')) paintPreview(pv, tokenOnly(snap.draft.edits));
    scroller.scrollTop = scroll;
  };

  const setOpen = (on: boolean) => {
    sheet.hidden = !on;
    scrim.hidden = !on;
    document.body.classList.toggle('no-scroll', on);
    if (on) {
      returnTo = document.activeElement as HTMLElement | null;
      paintSheet();
      sheet.querySelector<HTMLElement>('[data-xe-sheet-title]')?.focus();
    } else {
      (returnTo && document.contains(returnTo) ? returnTo : bar.querySelector<HTMLElement>('[data-xe-review]'))?.focus();
      returnTo = null;
    }
    paintBar();
  };

  bar.querySelector('[data-xe-review]')?.addEventListener('click', () => setOpen(true));
  sheet.querySelector('[data-xe-close]')?.addEventListener('click', () => setOpen(false));
  scrim.addEventListener('click', () => setOpen(false));
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
      e.stopPropagation();
      setOpen(false);
    }
  });
  sheet.addEventListener(
    'toggle',
    (e) => {
      const det = e.target as HTMLDetailsElement;
      const key = det.dataset?.xeSec;
      if (!key) return;
      if (det.open) open.add(key);
      else open.delete(key);
      const pv = det.querySelector<HTMLElement>('[data-xe-preview]');
      const snap = editorSnapshot();
      if (pv && det.open && snap && !pv.childElementCount) paintPreview(pv, tokenOnly(snap.draft.edits));
    },
    true,
  );
  body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-xe-undo]');
    if (!b) return;
    // Undo from the highest index so the remaining indexes stay valid.
    b.dataset.xeUndo!.split(',').map(Number).sort((x, y) => y - x).forEach((i) => undoEdit(i));
  });
  sheet.querySelector('[data-xe-discard]')?.addEventListener('click', () => {
    const n = count();
    if (!n || !window.confirm(`Discard ${n} change${n === 1 ? '' : 's'}? Your draft is emptied in this browser.`)) return;
    discardDraft();
  });
  // Proposing replaces the sheet with the propose dialog; the sheet stays behind it.
  document.addEventListener('bridge:draft', () => {
    paintBar();
    if (!sheet.hidden) {
      if (!count()) setOpen(false);
      else paintSheet();
    }
  });
  document.addEventListener('bridge:scope', () => {
    if (!sheet.hidden) paintSheet();
  });
  paintBar();
  return { open: () => setOpen(true) };
}
