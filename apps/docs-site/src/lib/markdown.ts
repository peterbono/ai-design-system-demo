// Tiny Markdown helpers: enough to lift tables, bullet lists and inline code out of the repo's .md files.
// Deliberately small: the docs read structure from Markdown, they do not render whole documents.

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline Markdown to HTML: `code`, **bold**, [links](url). Input is escaped first. */
export function inline(md: string): string {
  return escape(md)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

/** Lines of the section that starts at a heading with this exact text (any level), until the next heading of the same or higher level. */
export function section(md: string, heading: string): string[] {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim() === heading);
  if (start < 0) return [];
  const level = lines[start]!.match(/^#+/)![0].length;
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = l.match(/^(#+)\s/);
    if (m && m[1]!.length <= level) break;
    out.push(l);
  }
  return out;
}

/** First Markdown table in a block of lines. */
export function table(lines: string[]): { head: string[]; rows: string[][] } | null {
  const rows = lines.filter((l) => l.trim().startsWith('|'));
  if (rows.length < 2) return null;
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  const [head, , ...body] = rows;
  return { head: cells(head!), rows: body.map(cells) };
}

/** Top-level bullets, joining wrapped continuation lines. */
export function bullets(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (/^[-*]\s+/.test(l)) out.push(l.replace(/^[-*]\s+/, '').trim());
    else if (/^\s{2,}\S/.test(l) && out.length) out[out.length - 1] += ' ' + l.trim();
  }
  return out;
}

/** Plain paragraphs (non-list, non-table, non-heading) joined. */
export function paragraphs(lines: string[]): string[] {
  const out: string[] = [];
  let cur = '';
  for (const l of lines) {
    if (!l.trim() || /^([-*|#>]|```)/.test(l.trim())) {
      if (cur) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ' ' + l.trim();
  }
  if (cur) out.push(cur.trim());
  return out;
}

export const stripMd = (s: string) => s.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

// Titles: changeset summaries, commit subjects and PR titles are written in Markdown, but lists of changes show them
// as one line. These helpers keep the words and drop the syntax: links become their text, bold and italic markers go,
// inline code keeps its text (mdTitleText) or renders as <code> (mdTitleHtml, where rich text is allowed).

const LINK = /\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*\)/g;
const plainOutsideCode = (s: string) =>
  s
    .replace(LINK, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a: string | undefined, b: string | undefined) => a ?? b ?? '')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, '$1$2');

/** Splits on inline code spans: even indexes are prose, odd indexes are code. Links around code keep their text. */
function codeSplit(md: string): string[] {
  const oneLine = md.replace(/\s+/g, ' ').trim();
  // A link whose text is code, like [`Button`](url): keep the code, drop the link first.
  const unlinked = oneLine.replace(/\[(`[^`]+`)\]\((?:[^()\s]|\([^()]*\))*\)/g, '$1');
  return unlinked.split(/`([^`]+)`/);
}

/** One-line plain text of a Markdown title: no backticks, no ** or _, links reduced to their text. */
export function mdTitleText(md: string | null | undefined): string {
  if (!md) return '';
  return codeSplit(md)
    .map((part, i) => (i % 2 ? part : plainOutsideCode(part)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escaped HTML of a Markdown title: inline code as <code>, everything else as plain text. Safe for set:html. */
export function mdTitleHtml(md: string | null | undefined): string {
  if (!md) return '';
  const esc = (s: string) => escape(s).replace(/"/g, '&quot;');
  return codeSplit(md)
    .map((part, i) => (i % 2 ? `<code>${esc(part)}</code>` : esc(plainOutsideCode(part))))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
