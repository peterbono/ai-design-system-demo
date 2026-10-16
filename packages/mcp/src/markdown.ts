// Markdown sections by heading, so tools return the part of a long doc the model asked for.

export interface Section {
  level: number;
  title: string;
  slug: string;
  body: string;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function sections(md: string): Section[] {
  const lines = md.split('\n');
  const heads: { level: number; title: string; line: number }[] = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ level: m[1]!.length, title: m[2]!, line: i });
  });
  return heads.map((h, i) => {
    // A section runs to the next heading of the same or higher level (subsections included).
    const next = heads.slice(i + 1).find((x) => x.level <= h.level);
    return { level: h.level, title: h.title, slug: slug(h.title), body: lines.slice(h.line, next ? next.line : lines.length).join('\n').trim() };
  });
}

export function toc(md: string): { level: number; title: string; slug: string }[] {
  return sections(md).map(({ level, title, slug: s }) => ({ level, title, slug: s }));
}

/** Matches "4", "color", "Color", "contrast-commitments". Returns all matches, best first. */
export function findSection(md: string, query: string): Section[] {
  const q = query.trim().toLowerCase();
  const all = sections(md);
  const num = /^\d+$/.test(q) ? all.filter((s) => s.title.startsWith(`${q}.`)) : [];
  if (num.length) return num;
  const exact = all.filter((s) => s.slug === slug(q) || s.title.toLowerCase() === q);
  if (exact.length) return exact;
  return all.filter((s) => s.title.toLowerCase().includes(q) || s.slug.includes(slug(q)));
}

export function bullets(body: string): string[] {
  return body
    .split('\n')
    .filter((l) => /^\s*[-*]\s+/.test(l) || /^\s+\S/.test(l))
    .reduce<string[]>((acc, l) => {
      if (/^\s*[-*]\s+/.test(l)) acc.push(l.replace(/^\s*[-*]\s+/, '').trim());
      else if (acc.length) acc[acc.length - 1] += ` ${l.trim()}`;
      return acc;
    }, []);
}
