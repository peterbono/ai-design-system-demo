// The one place that turns data into HTML text. Every string that reaches innerHTML, insertAdjacentHTML,
// dangerouslySetInnerHTML or set:html and carries content Bridge did not write (repo files, token descriptions,
// changelog text, PR and issue titles and bodies, URLs) goes through these helpers first.
// No dependencies: imported by build-time pages and by browser scripts alike.

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text for an HTML text node or a quoted attribute value: escapes & < > " and '. */
export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]!);

/** Schemes a link from repo or user content may use. Anything else (javascript:, data:, vbscript:, file:) is dropped. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * A URL that is safe to put in href or src: http, https, mailto, or relative (/path, ./path, ?query, #hash, path).
 * Anything else returns `fallback` ('' by default, so the caller can drop the link). Control characters and
 * whitespace inside the scheme (`java\tscript:`) are stripped first, as browsers do.
 */
export function safeUrl(url: unknown, fallback = ''): string {
  if (typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  if (!trimmed) return fallback;
  // Browsers ignore ASCII tab and newline anywhere in a URL and leading C0 controls and spaces: so does this check.
  const probe = trimmed.replace(/[\u0000-\u001f\u007f\s]/g, '');
  if (probe.startsWith('//')) return /^\/\/[^/\\]/.test(probe) ? trimmed : fallback; // protocol-relative: https host
  if (probe.startsWith('\\')) return fallback;
  const scheme = probe.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!scheme) return trimmed; // relative: no scheme before the first colon
  return SAFE_SCHEMES.has(scheme[1]!.toLowerCase() + ':') ? trimmed : fallback;
}

/** safeUrl, escaped for a double-quoted attribute. */
export const attrUrl = (url: unknown, fallback = '#'): string => escapeHtml(safeUrl(url, fallback));

/**
 * A token value for an inline style declaration, escaped for a double-quoted attribute, or '' (the browser drops the
 * declaration) when it could load a resource or leave the declaration: url(, image-set(, image(, src(, expression,
 * backslash, ; @ { } < >.
 */
export const cssValue = (value: string | null | undefined): string => {
  const v = String(value ?? '');
  return /url\(|image-set\(|image\(|src\(|expression|[\\;@{}<>]/i.test(v) ? '' : escapeHtml(v);
};

/** HTML that is already safe (built by `html` or from constants). Interpolated as is by `html`. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

/** Marks a string of trusted HTML (constants, or the output of another escaping helper). */
export const trusted = (value: string) => new SafeHtml(value);

const part = (v: unknown): string => {
  if (v == null || v === false) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  return escapeHtml(v);
};

/**
 * Tagged template that escapes every interpolation, except SafeHtml values (and arrays of them).
 * `html\`<a href="${attrUrl(u)}">${name}</a>\`` . Assign with `el.innerHTML = String(html\`...\`)`.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += part(v) + strings[i + 1]!;
  });
  return new SafeHtml(out);
}

/**
 * JSON for a `<script type="application/json">` body: `<`, `>`, `&` and the two JS line separators are written as
 * \u escapes, so no value (`</script>`, `<!--`) can end the element. Takes a value or a JSON string already read
 * from disk (re-serialised, which also proves it is JSON).
 */
export function jsonForScript(value: unknown, { parse = false }: { parse?: boolean } = {}): string {
  const data = parse && typeof value === 'string' ? JSON.parse(value) : value;
  return (JSON.stringify(data) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
