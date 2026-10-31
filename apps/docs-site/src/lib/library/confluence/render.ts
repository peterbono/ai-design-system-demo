// One Library doc page as a plain document model, and its two renderings for Confluence: HTML that pastes well into
// the Confluence editor ("Copy for Confluence" on every Library page) and Markdown (the "Export the docs" zip, which
// Confluence imports through its Markdown macro or importer). Both renderings come from the same model, so a page
// reads the same either way: headings, paragraphs, lists, tables, code blocks, absolute links and images, and a
// footer that names Bridge as the source of truth. No interactive parts: a live example is its code plus a link.
// Pure and browser-safe: no Node API (pages.ts builds the models, the endpoints in pages/ serve them).
import { escapeHtml, safeUrl } from '../../html';

/** A piece of inline text: plain, code, strong, or a link (root-relative links become absolute when rendered). */
export type Inline = string | { text: string; code?: boolean; strong?: boolean; href?: string };
/** A run of inline pieces. A plain string is one piece. */
export type Rich = string | Inline[];

/** One table cell: rich text, and for a color an optional swatch (a hex the cell is painted with). */
export interface Cell {
  text: Rich;
  /** "#rrggbb" or "#rrggbbaa": the cell background, when Confluence keeps it. The hex is always in another column. */
  swatch?: string;
}

export type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: Rich }
  | { kind: 'list'; items: Rich[]; ordered?: boolean }
  | { kind: 'table'; head: string[]; rows: (Rich | Cell)[][] }
  | { kind: 'code'; code: string; lang?: string }
  | { kind: 'image'; src: string; alt: string };

export interface DocPage {
  /** The page route on the Library, root-relative with a trailing slash ("/components/button/"). */
  route: string;
  title: string;
  /** One-line lead under the title. */
  summary?: string;
  blocks: Block[];
}

export interface RenderOptions {
  /** The site origin links are made absolute against ("https://bridge.floriangouloubi.com"). */
  origin: string;
  /** The day the copy was generated, "2026-10-31". */
  date: string;
}

/** Where a page model is served for the copy button: one JSON file per page, { html, markdown }. */
export const confluenceKey = (route: string): string => route.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'home';
export const confluenceSrc = (route: string): string => `/confluence/${confluenceKey(route)}.json`;
/** The export zip, built with the site (pages/library-export.zip.ts). */
export const EXPORT_ZIP = '/library-export.zip';

/**
 * Text without the em dash (an AI tell the site never prints): a spaced dash becomes a comma, a bare one a hyphen.
 * Every string either renderer writes goes through it, whatever the repo content says.
 */
export const noEmDash = (s: string): string => s.replace(/\s+\u2014\s+/g, ', ').replace(/\u2014/g, '-');

/** A root-relative or relative link made absolute against the origin; unsafe schemes are dropped (''). */
export function absoluteUrl(href: string, origin: string): string {
  const safe = safeUrl(href);
  if (!safe) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(safe) || safe.startsWith('//')) return safe;
  try {
    return new URL(safe, `${origin.replace(/\/$/, '')}/`).toString();
  } catch {
    return '';
  }
}

const pageUrl = (page: DocPage, origin: string) => absoluteUrl(page.route, origin);
const pieces = (r: Rich): Inline[] => (typeof r === 'string' ? [r] : r);
const isCell = (c: Rich | Cell): c is Cell => typeof c === 'object' && !Array.isArray(c) && 'text' in c;
const cellOf = (c: Rich | Cell): Cell => (isCell(c) ? c : { text: c });
const HEX = /^#[0-9a-f]{3,8}$/i;

/** The footer both renderings end with: when the copy was made and where the page lives. */
export const footerText = (page: DocPage, o: RenderOptions) => `Generated from Bridge on ${o.date}. Edit it in Bridge: ${pageUrl(page, o.origin)}`;

// ---------------------------------------------------------------------------------------------------------------- HTML

function inlineHtml(r: Rich, origin: string): string {
  return pieces(r)
    .map((p) => {
      if (typeof p === 'string') return escapeHtml(noEmDash(p));
      let s = escapeHtml(noEmDash(p.text));
      if (p.code) s = `<code>${s}</code>`;
      if (p.strong) s = `<strong>${s}</strong>`;
      const href = p.href ? absoluteUrl(p.href, origin) : '';
      return href ? `<a href="${escapeHtml(href)}">${s}</a>` : s;
    })
    .join('');
}

// Confluence keeps a table cell's color through data-highlight-colour (its own storage attribute) and, on paste, the
// inline background-color. Only a checked hex reaches either.
function cellHtml(c: Cell, origin: string, tag: 'td' | 'th'): string {
  const swatch = c.swatch && HEX.test(c.swatch) ? c.swatch.toLowerCase() : '';
  const attrs = swatch ? ` data-highlight-colour="${swatch}" style="background-color: ${swatch}"` : '';
  const body = inlineHtml(c.text, origin);
  return `<${tag}${attrs}>${body || (swatch ? '&nbsp;' : '')}</${tag}>`;
}

function blockHtml(b: Block, origin: string): string {
  switch (b.kind) {
    case 'heading':
      return `<h${b.level}>${escapeHtml(noEmDash(b.text))}</h${b.level}>`;
    case 'paragraph':
      return `<p>${inlineHtml(b.text, origin)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map((i) => `<li>${inlineHtml(i, origin)}</li>`).join('')}</${tag}>`;
    }
    case 'table': {
      const head = `<thead><tr>${b.head.map((h) => `<th>${escapeHtml(noEmDash(h))}</th>`).join('')}</tr></thead>`;
      const rows = b.rows.map((r) => `<tr>${r.map((c) => cellHtml(cellOf(c), origin, 'td')).join('')}</tr>`).join('');
      return `<table>${head}<tbody>${rows}</tbody></table>`;
    }
    case 'code': {
      const lang = b.lang ? ` class="language-${escapeHtml(b.lang)}" data-language="${escapeHtml(b.lang)}"` : '';
      return `<pre><code${lang}>${escapeHtml(noEmDash(b.code))}</code></pre>`;
    }
    case 'image': {
      const src = absoluteUrl(b.src, origin);
      return src ? `<p><img src="${escapeHtml(src)}" alt="${escapeHtml(noEmDash(b.alt))}" /></p>` : '';
    }
  }
}

/** The page as HTML for the Confluence editor: one fragment, no styles beyond swatch cells, no scripts. */
export function toConfluenceHtml(page: DocPage, o: RenderOptions): string {
  const url = pageUrl(page, o.origin);
  const parts = [
    `<h1>${escapeHtml(noEmDash(page.title))}</h1>`,
    page.summary ? `<p>${escapeHtml(noEmDash(page.summary))}</p>` : '',
    ...page.blocks.map((b) => blockHtml(b, o.origin)),
    '<hr />',
    `<p><em>Generated from Bridge on ${escapeHtml(o.date)}. Edit it in Bridge: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></em></p>`,
  ];
  return parts.filter(Boolean).join('\n');
}

// ------------------------------------------------------------------------------------------------------------ Markdown

const mdEscape = (s: string) => s.replace(/([\\`*_[\]<>])/g, '\\$1');
const mdCode = (s: string) => {
  const ticks = s.includes('`') ? '``' : '`';
  return ticks === '``' ? `\`\` ${s} \`\`` : `\`${s}\``;
};

function inlineMd(r: Rich, origin: string): string {
  return pieces(r)
    .map((p) => {
      if (typeof p === 'string') return mdEscape(noEmDash(p));
      const text = noEmDash(p.text);
      let s = p.code ? mdCode(text) : mdEscape(text);
      if (p.strong) s = `**${s}**`;
      const href = p.href ? absoluteUrl(p.href, origin) : '';
      return href ? `[${s}](${href.replace(/[()\s]/g, encodeURIComponent)})` : s;
    })
    .join('');
}

/** A table cell on one Markdown line: pipes escaped, line breaks as spaces. */
const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function blockMd(b: Block, origin: string): string {
  switch (b.kind) {
    case 'heading':
      return `${'#'.repeat(b.level)} ${mdEscape(noEmDash(b.text))}`;
    case 'paragraph':
      return inlineMd(b.text, origin);
    case 'list':
      return b.items.map((i, n) => `${b.ordered ? `${n + 1}.` : '-'} ${inlineMd(i, origin)}`).join('\n');
    case 'table': {
      const head = `| ${b.head.map((h) => mdCell(mdEscape(noEmDash(h)))).join(' | ')} |`;
      const rule = `| ${b.head.map(() => '---').join(' | ')} |`;
      const rows = b.rows.map((r) => `| ${r.map((c) => mdCell(inlineMd(cellOf(c).text, origin)) || ' ').join(' | ')} |`);
      return [head, rule, ...rows].join('\n');
    }
    case 'code': {
      const code = noEmDash(b.code);
      const fence = code.includes('```') ? '````' : '```';
      return `${fence}${b.lang ?? ''}\n${code}\n${fence}`;
    }
    case 'image': {
      const src = absoluteUrl(b.src, origin);
      return src ? `![${mdEscape(noEmDash(b.alt))}](${src})` : '';
    }
  }
}

/** The page as Markdown (CommonMark with GFM tables), ending with the same footer as the HTML. */
export function toMarkdown(page: DocPage, o: RenderOptions): string {
  const parts = [
    `# ${mdEscape(noEmDash(page.title))}`,
    page.summary ? mdEscape(noEmDash(page.summary)) : '',
    ...page.blocks.map((b) => blockMd(b, o.origin)),
    '---',
    `*${mdEscape(`Generated from Bridge on ${o.date}. Edit it in Bridge:`)} ${pageUrl(page, o.origin)}*`,
  ];
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}
