// Tiny HTML string helpers for the DOM renderers. No dependency, no DOM access: they also run on a server.

/** Escapes text and attribute values for HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Extra attributes a caller adds to a rendered root: `data-*`, `id`, `title`, `aria-*`. */
export type HtmlAttributes = Record<string, string | number | boolean | null | undefined>;

/** ` name="value"` pairs in insertion order; `true` writes an empty value, `false`/null/undefined are skipped. */
export function attrs(map: HtmlAttributes = {}): string {
  let out = '';
  for (const [name, v] of Object.entries(map)) {
    if (v === false || v === null || v === undefined) continue;
    out += v === true ? ` ${name}=""` : ` ${name}="${escapeHtml(v)}"`;
  }
  return out;
}

/** Joins truthy class names, like `cx` in the components. */
export function classNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

/** Text or markup the caller already escaped, passed through as is. */
export interface TrustedHtml {
  html: string;
}

/** Marks a string as markup the caller built and escaped (another renderer's output, for example). */
export const trusted = (html: string): TrustedHtml => ({ html });

/** Escapes a plain string; passes `trusted()` markup through. */
export const content = (value: string | number | TrustedHtml | null | undefined): string =>
  value && typeof value === 'object' ? value.html : escapeHtml(value);
