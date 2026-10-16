// Library foundation pages: the page-level "Copy as" switch (CSS, JS, Figma; remembered per browser), copy on token
// names with a toast, and opening a token row in the detail drawer (scripts/explorer/drawer.ts listens to
// [data-fd-open]). Plain DOM, no framework.
import { parseCopyFormat, type CopyFormat } from '../lib/library-rows';
import { copyText } from './explorer/util';
import { selectSegment } from './shell';

const KEY = 'bridge-copy-format';
const WHAT: Record<CopyFormat, string> = { css: 'CSS variable', js: 'JS reference', figma: 'Figma variable' };

function stored(): CopyFormat {
  try {
    return parseCopyFormat(localStorage.getItem(KEY));
  } catch {
    return 'css';
  }
}

export function initFoundations() {
  const page = document.querySelector<HTMLElement>('[data-fd-page]');
  if (!page || page.dataset.ready) return;
  page.dataset.ready = '';
  let format = stored();
  const formats = document.querySelector<HTMLElement>('[data-fd-formats]');
  const toast = document.getElementById('fd-toast');
  let toastTimer = 0;

  function setFormat(next: CopyFormat, save = true) {
    format = next;
    if (formats) selectSegment(formats, next);
    document.querySelectorAll<HTMLElement>('[data-fd-copy]').forEach((b) => {
      const v = b.dataset[`copy${next.charAt(0).toUpperCase()}${next.slice(1)}`] ?? '';
      b.title = `Copy ${WHAT[next]} ${v}`;
      b.setAttribute('aria-label', `${b.textContent?.trim() ?? ''}, copy ${WHAT[next]}`);
    });
    if (!save) return;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice lasts for this page */
    }
  }
  setFormat(format, false);

  function showToast(text: string) {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    toast.dataset.show = '';
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      delete toast.dataset.show;
      toastTimer = window.setTimeout(() => (toast.hidden = true), 200);
    }, 1600);
  }

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const name = t.closest<HTMLElement>('[data-fd-copy]');
    if (name) {
      const value = name.dataset[`copy${format.charAt(0).toUpperCase()}${format.slice(1)}`] ?? '';
      void copyText(value, name);
      showToast(`Copied ${value}`);
      return;
    }
    // A click anywhere else on a row opens its details; links, menus and buttons keep their own job.
    const row = t.closest<HTMLElement>('[data-fd-row]');
    if (row && !t.closest('a, button, summary, details, input, select, textarea')) {
      row.querySelector<HTMLButtonElement>('[data-fd-open]')?.click();
    }
  });

  // The "Copy as" SegmentedControl: shell.ts handles clicks and arrow keys and reports the new value.
  formats?.addEventListener('bridge:segment', (e) => setFormat(parseCopyFormat((e as CustomEvent<{ value: string }>).detail.value)));
}
