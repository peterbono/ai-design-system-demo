// Pure parsing and grouping of a design system's releases, for the Library Changelog and the team snapshot. No fs,
// no git: the caller reads the files and passes the text in. Sources, all already in a repository:
//   - each package's CHANGELOG.md, written by the changesets release action ("## 1.1.0", "### Minor Changes",
//     "- abc1234: text"),
//   - .changeset/*.md, the entries waiting for the next release,
//   - release dates from the release tags (@bridge-ds/react@1.1.0) or from git, passed in by the caller.
// Bridge's docs site re-exports it under its former names (apps/docs-site/src/lib/changelog-model.ts).

export type ChangelogBump = 'major' | 'minor' | 'patch';

export interface ChangelogEntry {
  source: 'changeset' | 'release';
  /** First sentence of the note, the row title. */
  title: string;
  /** Rest of the note's first paragraph, may be empty. */
  detail: string;
  kind: string; // human label: Breaking, New, Fix, Internal
  bump: ChangelogBump | null;
  packages: string[];
  forYou: string;
  /** The author wrote the "For you:" line (forYou is not the default for the bump). */
  forYouAuthored?: boolean;
  date?: string;
  /** Changeset id: the commit sha prefix in a CHANGELOG.md, or the .changeset file path for pending ones. */
  ref?: string;
}

export interface ChangelogReleasePackage {
  name: string;
  version: string;
  /** Published to npm (not a private app). */
  published: boolean;
}

export interface ChangelogRelease {
  /** "v1.1.0" (the Library version, from @bridge-ds/react) or "core 0.3.1" when react is not in the release. */
  name: string;
  date?: string;
  pending: boolean;
  packages: ChangelogReleasePackage[];
  entries: ChangelogEntry[];
  announcement: string;
}

/** One "## x.y.z" section of a package CHANGELOG.md. */
export interface ChangelogSection {
  pkg: string;
  version: string;
  published: boolean;
  notes: { id: string; bump: ChangelogBump; text: string }[];
}

const FOR_YOU: Record<string, string> = {
  major: 'Action needed: something you use was renamed, removed or changed visibly. Check the notes before updating.',
  minor: 'New option available. Nothing breaks; use it when it helps.',
  patch: 'No action needed. A fix or a detail now matches the spec.',
  internal: 'Nothing changes in Figma or in the product. Internal tooling only.',
};

const BUMP_RANK: Record<ChangelogBump, number> = { patch: 0, minor: 1, major: 2 };
const HEAD_BUMP: Record<string, ChangelogBump> = { 'Major Changes': 'major', 'Minor Changes': 'minor', 'Patch Changes': 'patch' };

export const shortPackage = (name: string) => name.replace(/^@bridge-ds\//, '');

const kindOfBump = (b: ChangelogBump | null, packages: string[]) =>
  packages.length === 0 ? 'Internal' : b === 'major' ? 'Breaking' : b === 'minor' ? 'New' : 'Fix';

/** Splits a paragraph into sentences: ". ", "! " or "? " before a capital, a quote or a backtick, never inside `code`. */
export function noteSentences(para: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inCode = false;
  for (let i = 0; i < para.length - 2; i++) {
    const ch = para[i]!;
    if (ch === '`') inCode = !inCode;
    if (!inCode && /[.!?]/.test(ch) && para[i + 1] === ' ' && /[A-Z"`(]/.test(para[i + 2]!)) {
      out.push(para.slice(start, i + 1).trim());
      start = i + 2;
    }
  }
  const rest = para.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Longest second sentence shown under a title; a longer one stays in the full notes rather than being cut. */
export const CHANGELOG_DETAIL_MAX = 240;

/**
 * A note as a row: its first sentence is the title (no trailing period), the second one the description when it is
 * short enough to read in a list, and the author's "For you:" line when there is one.
 */
export function splitNote(text: string): { title: string; detail: string; forYou?: string } {
  const forYou = text.match(/^\s*For you:\s*(.+)$/im)?.[1]?.trim();
  const para = text
    .replace(/^\s*For you:.*$/gim, '')
    .trim()
    .split(/\n\s*\n/)[0]!
    .replace(/\s+/g, ' ')
    .trim();
  const [first = '', second = ''] = noteSentences(para);
  return { title: first.replace(/\.$/, ''), detail: second.length <= CHANGELOG_DETAIL_MAX ? second : '', forYou };
}

/** Parses a package CHANGELOG.md into its version sections. "Updated dependencies" lines are not changes. */
export function parseChangelogSections(md: string, pkg: string, published: boolean): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  let bump: ChangelogBump = 'patch';
  let note: { id: string; bump: ChangelogBump; lines: string[] } | null = null;
  const flush = () => {
    if (note && current) current.notes.push({ id: note.id, bump: note.bump, text: note.lines.join('\n').trim() });
    note = null;
  };
  for (const line of md.split('\n')) {
    const v = line.match(/^## (\d+\.\d+\.\d+\S*)\s*$/);
    if (v) {
      flush();
      current = { pkg, version: v[1]!, published, notes: [] };
      sections.push(current);
      continue;
    }
    const h = line.match(/^### (.+?)\s*$/);
    if (h) {
      flush();
      bump = HEAD_BUMP[h[1]!] ?? 'patch';
      continue;
    }
    const item = line.match(/^- ([0-9a-f]{7,40}): (.*)$/);
    if (item && current) {
      flush();
      note = { id: item[1]!.slice(0, 7), bump, lines: [item[2]!] };
      continue;
    }
    if (/^- /.test(line)) {
      flush(); // "- Updated dependencies [...]" and other lines without a changeset id
      continue;
    }
    if (note) (note as { lines: string[] }).lines.push(line.replace(/^ {2}/, ''));
  }
  flush();
  return sections;
}

/** One pending .changeset/*.md file, or null when it is not a changeset. */
export function parseChangeset(src: string, ref: string): ChangelogEntry | null {
  const m = src.match(/^---\n([\s\S]*?)\n?---\n([\s\S]*)$/);
  if (!m) return null;
  const bumps = [...m[1]!.matchAll(/"([^"]+)":\s*(major|minor|patch)/g)].map((x) => ({ pkg: x[1]!, bump: x[2] as ChangelogBump }));
  const top = bumps.reduce<ChangelogBump | null>((b, x) => (b === null || BUMP_RANK[x.bump] > BUMP_RANK[b] ? x.bump : b), null);
  const { title, detail, forYou } = splitNote(m[2]!);
  if (!title) return null;
  const packages = bumps.map((x) => x.pkg);
  return {
    source: 'changeset',
    title,
    detail,
    kind: kindOfBump(top, packages),
    bump: top,
    packages,
    forYou: forYou ?? (packages.length ? FOR_YOU[top ?? 'patch']! : FOR_YOU.internal!),
    forYouAuthored: Boolean(forYou),
    ref,
  };
}

const semverDesc = (a: string, b: string) => {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i]! - pa[i]!;
  return 0;
};

/**
 * Groups version sections into releases. Sections released together share a date, or, when no date is known
 * (shallow clone, no tags), share a changeset: the release action writes one changeset into every package it
 * bumps. Each changeset shows once per release, with every package it touched. Newest first.
 * `dateOf(pkg, version)` returns the release date (YYYY-MM-DD) or undefined; it never guesses.
 */
export function groupReleases(sections: ChangelogSection[], dateOf: (pkg: string, version: string) => string | undefined, libraryPackage = '@bridge-ds/react'): Omit<ChangelogRelease, 'announcement'>[] {
  const all = sections;
  const parent = all.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const dates = all.map((s) => dateOf(s.pkg, s.version));
  const byKey = new Map<string, number>();
  all.forEach((s, i) => {
    const keys = [...(dates[i] ? [`d:${dates[i]}`] : []), ...s.notes.map((n) => `n:${n.id}`)];
    for (const k of keys) {
      const j = byKey.get(k);
      if (j === undefined) byKey.set(k, i);
      else union(i, j);
    }
  });
  const groups = new Map<number, number[]>();
  all.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));

  const out: Omit<ChangelogRelease, 'announcement'>[] = [];
  for (const members of groups.values()) {
    const secs = members.map((i) => all[i]!);
    const known = members.map((i) => dates[i]).filter((d): d is string => Boolean(d)).sort();
    const date = known.length ? known[known.length - 1] : undefined;
    const entries = new Map<string, ChangelogEntry & { rank: number }>();
    for (const s of secs) {
      for (const n of s.notes) {
        // One commit can add several changesets: the id alone is not unique, the id and the text are.
        const key = `${n.id}:${n.text.slice(0, 80)}`;
        const prev = entries.get(key);
        if (prev) {
          if (!prev.packages.includes(s.pkg)) prev.packages.push(s.pkg);
          if (BUMP_RANK[n.bump] > prev.rank) {
            prev.rank = BUMP_RANK[n.bump];
            prev.bump = n.bump;
          }
          continue;
        }
        const { title, detail, forYou } = splitNote(n.text);
        entries.set(key, { source: 'release', title, detail, kind: '', bump: n.bump, packages: [s.pkg], forYou: forYou ?? '', forYouAuthored: Boolean(forYou), date, ref: n.id, rank: BUMP_RANK[n.bump] });
      }
    }
    const list = sortChangelogEntries(
      [...entries.values()].map(({ rank: _rank, ...e }) => ({
        ...e,
        kind: kindOfBump(e.bump, e.packages),
        forYou: e.forYou || FOR_YOU[e.bump ?? 'patch']!,
      })),
    );
    if (list.length === 0) continue; // only dependency bumps and no date to place them with
    const packages = secs
      .map((s) => ({ name: s.pkg, version: s.version, published: s.published }))
      .sort((a, b) => Number(b.published) - Number(a.published) || (a.name === libraryPackage ? -1 : b.name === libraryPackage ? 1 : a.name.localeCompare(b.name)));
    const lib = packages.find((p) => p.name === libraryPackage);
    const lead = lib ?? packages.find((p) => p.published) ?? packages[0]!;
    out.push({ name: lib ? `v${lib.version}` : `${shortPackage(lead.name)} ${lead.version}`, date, pending: false, packages, entries: list });
  }
  return out.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (Boolean(a.date) !== Boolean(b.date)) return a.date ? -1 : 1;
    return semverDesc(a.packages[0]?.version ?? '0.0.0', b.packages[0]?.version ?? '0.0.0');
  });
}

const KIND_ORDER = ['Breaking', 'New', 'Fix', 'Internal'];

/** Breaking first, then New, Fix, Internal; the notes' own order inside a kind. */
export function sortChangelogEntries<T extends { kind: string }>(entries: T[]): T[] {
  const rank = (k: string) => (KIND_ORDER.indexOf(k) < 0 ? KIND_ORDER.length : KIND_ORDER.indexOf(k));
  return entries.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e.kind) - rank(b.e.kind) || a.i - b.i).map((x) => x.e);
}

export function releaseAnnouncement(r: Omit<ChangelogRelease, 'announcement'>): string {
  const visible = r.entries.filter((e) => e.kind !== 'Internal');
  const action = r.entries.some((e) => e.kind === 'Breaking');
  const lines = [
    r.pending
      ? `Design system update coming in the next release${action ? ' (action needed)' : ''}:`
      : `Design system ${r.name} is out${action ? ' (action needed)' : ''}:`,
    ...(visible.length ? visible : r.entries).slice(0, 8).map((e) => `- ${e.kind}: ${e.title.replace(/`/g, '')}`),
    '',
    action
      ? 'Some changes need action: check the changelog before you update your files.'
      : 'Nothing breaks. Figma variables and the docs update automatically after merge.',
    'Full changelog: /changelog/',
  ];
  return lines.join('\n');
}

/** Meta line of an entry: the bump in words, then the packages (short names). Over `max`, only a count. */
export function releasePackagesLabel(packages: string[], max = 3): { tags: string[]; count: string | null } {
  const tags = packages.map(shortPackage);
  if (tags.length <= max) return { tags, count: null };
  return { tags, count: `${tags.length} packages` };
}

/** A release as the snapshot carries it: the announcement is left out (releaseAnnouncement(r) rebuilds it). */
export type ChangelogReleaseRow = Omit<ChangelogRelease, 'announcement'>;

export interface CollectReleasesInput {
  /** Each package's CHANGELOG.md text, with its npm name and whether it is published (not private). */
  changelogs: { pkg: string; published: boolean; text: string }[];
  /** Pending .changeset/*.md files: `ref` is the file path. README.md is not a changeset and is skipped by the caller. */
  changesets?: { ref: string; text: string }[];
  /** Release date (YYYY-MM-DD) of a package version, or undefined; never guessed. */
  dateOf?: (pkg: string, version: string) => string | undefined;
  /** Package whose version names a release ("v1.1.0"). */
  libraryPackage?: string;
}

/**
 * Every release of a repository, newest first: the pending changesets as "Coming in the next release" when there are
 * any, then the published versions grouped by groupReleases. What the Changelog shows and the team snapshot carries.
 */
export function collectReleases(input: CollectReleasesInput): ChangelogReleaseRow[] {
  const sections = input.changelogs.flatMap((c) => parseChangelogSections(c.text, c.pkg, c.published));
  const released = groupReleases(sections, input.dateOf ?? (() => undefined), input.libraryPackage);
  const pending = (input.changesets ?? []).map((c) => parseChangeset(c.text, c.ref)).filter((e): e is ChangelogEntry => e !== null);
  const next: ChangelogReleaseRow[] = pending.length ? [{ name: 'Coming in the next release', pending: true, packages: [], entries: sortChangelogEntries(pending), date: undefined }] : [];
  return [...next, ...released];
}
