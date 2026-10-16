// Small DOM helpers shared by the token explorer modules.
import { iconSvg, type IconName } from '../../brand/icons';
import { announce } from '../shell';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const icon = (name: IconName, size = 16) => iconSvg(name, size);

/** Copies text, with a live-region announcement and a short "Copied" state on the button. */
export async function copyText(text: string, button?: HTMLElement | null) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      ta.remove();
    }
  }
  announce(`Copied ${text}`);
  if (button) {
    button.dataset.copied = '';
    window.setTimeout(() => delete button.dataset.copied, 1200);
  }
}

/** Copy button markup: copies `value`, labeled for screen readers. */
export const copyButton = (value: string, what: string, extra = '') =>
  `<button type="button" class="xp-copy${extra ? ` ${extra}` : ''}" data-copy="${esc(value)}" tabindex="-1" aria-label="Copy ${esc(what)}" title="Copy ${esc(what)}">${icon('copy', 14)}<span class="xp-copy-done" aria-hidden="true">${icon('check', 14)}</span></button>`;

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Which ink reads on a hex background: "dark" ink on light colors, "light" ink on dark ones. */
export function inkOn(hex: string | undefined): 'dark' | 'light' {
  if (!hex || !/^#[0-9a-f]{6}/i.test(hex)) return 'dark';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4 ? 'dark' : 'light';
}
