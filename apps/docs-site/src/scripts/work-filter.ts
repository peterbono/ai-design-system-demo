// Changes: the Developer tag on rows and the "All, Design, Developer" filter of the In review, Requests and
// Explorations lists. Developer work (code only, lib/work-nature) stays findable here, tagged, while the Overview keeps
// it off the designer surfaces. Rows carry data-nature; the page root carries data-work (the filter) and CSS hides what
// it leaves out, so a list repaint keeps the filter. One filter for the three lists, in the address as ?work=.
import { badgeHtml, tooltipAttributes } from '@bridge-ds/react/dom';
import { workFilterParam, type WorkFilter, type WorkNature } from '../lib/work-nature';
import { esc } from './github-session';
import { selectSegment } from './shell';

/** The quiet tag after a row title, developer work only. */
export function devTag(nature: WorkNature): string {
  return nature === 'developer' ? badgeHtml('Developer', { size: 'sm', className: 'cg-dev-tag', attributes: tooltipAttributes('Code only, no design decision', { focusable: true }) }) : '';
}

/** `data-nature` on a row. */
export const natureAttr = (nature: WorkNature) => `data-nature="${esc(nature)}"`;

const root = () => document.querySelector<HTMLElement>('.cg');
const current = (): WorkFilter => (root()?.dataset.work as WorkFilter | undefined) ?? 'all';

/**
 * After a list paints: its filter shows only when the list holds developer work (or a filter is already on), and a
 * quiet line says when the filter leaves nothing.
 */
export function markWork(list: HTMLElement | null) {
  if (!list) return;
  const panel = list.closest('.cg-panel');
  const bar = panel?.querySelector<HTMLElement>('[data-work-bar]');
  const none = panel?.querySelector<HTMLElement>('[data-work-none]');
  const rows = [...list.querySelectorAll<HTMLElement>('[data-nature]')];
  const dev = rows.filter((r) => r.dataset.nature === 'developer').length;
  const f = current();
  if (bar) bar.hidden = dev === 0 && f === 'all';
  if (none) {
    const shown = rows.filter((r) => f === 'all' || r.dataset.nature === f).length;
    none.hidden = !rows.length || shown > 0;
    none.textContent = f === 'developer' ? 'No developer work here.' : 'Only developer work here.';
  }
}

function apply(f: WorkFilter) {
  const r = root();
  if (!r) return;
  if (f === 'all') delete r.dataset.work;
  else r.dataset.work = f;
  document.querySelectorAll<HTMLElement>('[data-work-filter]').forEach((c) => selectSegment(c, f));
  ['rv-list', 'rq-list', 'ex-list'].forEach((id) => markWork(document.getElementById(id)));
}

/** Reads ?work= and follows the filter controls. */
export function initWorkFilter() {
  apply(workFilterParam(location.search));
  document.addEventListener('bridge:segment', (e) => {
    const ctl = (e.target as HTMLElement).closest('[data-work-filter]');
    if (!ctl) return;
    const f = workFilterParam(`?work=${(e as CustomEvent<{ value: string }>).detail.value}`);
    apply(f);
    const url = new URL(location.href);
    if (f === 'all') url.searchParams.delete('work');
    else url.searchParams.set('work', f);
    history.replaceState(history.state, '', url);
  });
}
