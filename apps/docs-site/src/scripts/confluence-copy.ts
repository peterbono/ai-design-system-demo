// "Copy for Confluence" (components/ds/library/ConfluenceCopy.tsx) on every Library doc page: one click copies the
// page as HTML (text/html, which the Confluence editor pastes as headings, tables and code blocks) with its Markdown
// as the text/plain fallback, both read from the static /confluence/<page>.json the build wrote. The clipboard item
// takes promises, so the copy stays inside the click even while the file loads (Safari requires it). A DS toast says
// what happened; React only loads on the first click.
import type { UseToastReturn } from '@bridge-ds/react';

interface Copy {
  title: string;
  html: string;
  markdown: string;
}

let toasts: Promise<UseToastReturn> | null = null;

function toastApi(): Promise<UseToastReturn> {
  toasts ??= (async () => {
    const [{ createElement }, { createRoot }, { ConfluenceToasts }] = await Promise.all([import('react'), import('react-dom/client'), import('../components/ds/library/ConfluenceCopy')]);
    const host = document.createElement('div');
    host.dataset.confluenceToasts = '';
    document.body.append(host);
    return new Promise<UseToastReturn>((resolve) => createRoot(host).render(createElement(ConfluenceToasts, { onReady: resolve })));
  })();
  return toasts;
}

async function load(src: string): Promise<Copy> {
  const res = await fetch(src, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Copy;
}

/** Writes the page to the clipboard: HTML and Markdown together, or the Markdown alone where rich copy is missing. */
export async function copyForConfluence(src: string, clipboard: Clipboard = navigator.clipboard): Promise<'html' | 'text'> {
  const copy = load(src);
  if (typeof ClipboardItem !== 'undefined' && typeof clipboard.write === 'function') {
    try {
      const item = new ClipboardItem({
        'text/html': copy.then((c) => new Blob([c.html], { type: 'text/html' })),
        'text/plain': copy.then((c) => new Blob([c.markdown], { type: 'text/plain' })),
      });
      await clipboard.write([item]);
      return 'html';
    } catch {
      // A browser without promise clipboard items: fall through to the Markdown.
    }
  }
  await clipboard.writeText((await copy).markdown);
  return 'text';
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest<HTMLElement>('[data-confluence-copy]');
  const src = button?.dataset.confluenceSrc;
  if (!button || !src) return;
  event.preventDefault();
  button.setAttribute('aria-busy', 'true');
  copyForConfluence(src)
    .then(async (kind) => {
      const api = await toastApi();
      api.success('Copied for Confluence', { description: kind === 'html' ? 'Paste it in a Confluence page.' : 'Copied as Markdown. Paste it in a Confluence Markdown macro.' });
    })
    .catch(async () => {
      const api = await toastApi();
      api.error('Could not copy the page', { description: 'Check your connection and try again, or use Export the docs on the Library home.' });
    })
    .finally(() => button.removeAttribute('aria-busy'));
});
