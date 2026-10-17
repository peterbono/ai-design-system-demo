// Library foundation pages: copy on token names and on each row's copy button (the CSS variable by default; the
// button's menu copies as JS or the Figma name, and the last choice is remembered per browser), a toast, arrow keys
// on the specimen brand and density switches, and opening a token row in the detail drawer
// (scripts/explorer/drawer.ts listens to [data-fd-open]). Plain DOM, no framework.
import { parseCopyFormat, type CopyFormat } from '../lib/library-rows';
import { copyText } from './explorer/util';

const KEY = 'bridge-copy-format';
const WHAT: Record<CopyFormat, string> = { css: 'CSS variable', js: 'JS reference', figma: 'Figma name' };
const valueOf = (el: HTMLElement, f: CopyFormat) => el.dataset[`copy${f.charAt(0).toUpperCase()}${f.slice(1)}`] ?? '';

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
  const toast = document.getElementById('fd-toast');
  let toastTimer = 0;

  function setFormat(next: CopyFormat, save = true) {
    format = next;
    document.querySelectorAll<HTMLElement>('[data-fd-copy]').forEach((b) => {
      const v = valueOf(b, next);
      if (b.hasAttribute('data-fd-copy-icon')) {
        b.title = `Copy ${WHAT[next]}`;
        b.setAttribute('aria-label', `Copy ${WHAT[next]} ${v}`);
      } else {
        b.title = `Copy ${WHAT[next]} ${v}`;
        b.setAttribute('aria-label', `${b.textContent?.trim() ?? ''}, copy ${WHAT[next]}`);
      }
    });
    document.querySelectorAll<HTMLElement>('[data-fd-copy-as]').forEach((m) => m.setAttribute('aria-checked', String(m.dataset.fdCopyAs === next)));
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
    const as = t.closest<HTMLElement>('[data-fd-copy-as]');
    if (as) {
      const src = as.closest('.fd-copy')?.querySelector<HTMLElement>('[data-fd-copy-icon]');
      const next = parseCopyFormat(as.dataset.fdCopyAs);
      setFormat(next);
      const menu = as.closest('details');
      if (menu) menu.open = false;
      if (src) {
        const value = valueOf(src, next);
        void copyText(value, src);
        showToast(`Copied ${value}`);
        src.focus();
      }
      return;
    }
    const name = t.closest<HTMLElement>('[data-fd-copy]');
    if (name) {
      const value = valueOf(name, format);
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

  // Specimen brand and density switches (radio groups): arrow keys move and pick.
  document.addEventListener('keydown', (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-fd-scope] [role="radio"]');
    if (!opt || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const all = [...opt.closest('[data-fd-scope]')!.querySelectorAll<HTMLElement>('[role="radio"]')];
    const i = all.indexOf(opt);
    const next = all[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? all.length - 1 : 1)) % all.length];
    e.preventDefault();
    next?.click();
    next?.focus();
  });
}
