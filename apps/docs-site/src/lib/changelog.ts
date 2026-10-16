// Human changelog built from two sources that already exist:
//   1. .changeset/*.md: pending entries, written by the PR author (person or agent), with the semver bump.
//   2. git log: conventional commits, grouped by release tag (v1.2.0 or @bridge-ds/react@1.2.0).
// Each entry gets a one-line "what changes for you" and each release a ready-to-post announcement.
import { git, listDir, readJson, readText } from './repo';

export type Bump = 'major' | 'minor' | 'patch';

export interface Entry {
  source: 'changeset' | 'commit';
  title: string;
  kind: string; // human label: Breaking, New, Fix, Docs, Internal
  bump: Bump | null;
  packages: string[];
  forYou: string;
  date?: string;
  ref?: string; // short sha or changeset file
}

export interface Release {
  name: string;
  date?: string;
  pending: boolean;
  entries: Entry[];
  announcement: string;
}

const FOR_YOU: Record<string, string> = {
  major: 'Action needed: something you use was renamed, removed or changed visibly. Check the notes before updating.',
  minor: 'New option available. Nothing breaks; use it when it helps.',
  patch: 'No action needed. A fix or a detail now matches the spec.',
  feat: 'New option available. Nothing breaks; use it when it helps.',
  fix: 'No action needed. Something now looks or behaves as specified.',
  docs: 'Nothing changes in Figma or in the product. Guidance got clearer.',
  internal: 'Nothing changes in Figma or in the product. Internal tooling only.',
  breaking: 'Action needed: something you use changed. Read the notes before updating.',
};

const KIND: Record<string, string> = {
  feat: 'New',
  fix: 'Fix',
  docs: 'Docs',
  perf: 'Improvement',
  breaking: 'Breaking',
};

function parseChangeset(file: string): Entry | null {
  const src = readText(`.changeset/${file}`);
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const bumps = [...m[1]!.matchAll(/"([^"]+)":\s*(major|minor|patch)/g)].map((x) => ({ pkg: x[1]!, bump: x[2] as Bump }));
  const order: Bump[] = ['major', 'minor', 'patch'];
  const bump = order.find((b) => bumps.some((x) => x.bump === b)) ?? 'patch';
  const body = m[2]!.trim();
  // Optional override written by the author: a line starting with "For you:".
  const override = body.match(/^For you:\s*(.+)$/im)?.[1];
  const title = body.replace(/^For you:.*$/im, '').trim().split('\n\n')[0]!.replace(/\s+/g, ' ');
  return {
    source: 'changeset',
    title,
    kind: bump === 'major' ? 'Breaking' : bump === 'minor' ? 'New' : 'Fix',
    bump,
    packages: bumps.map((x) => x.pkg),
    forYou: override ?? FOR_YOU[bump]!,
    ref: `.changeset/${file}`,
  };
}

export function pendingChangesets(): Entry[] {
  return listDir('.changeset')
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map(parseChangeset)
    .filter((e): e is Entry => e !== null);
}

const CC = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

function commitEntry(sha: string, date: string, subject: string, body: string): Entry {
  const m = subject.match(CC);
  const breaking = Boolean(m?.[3]) || /BREAKING CHANGE/.test(body);
  const type = m?.[1]?.toLowerCase() ?? 'other';
  const scope = m?.[2];
  const text = m?.[4] ?? subject;
  const key = breaking ? 'breaking' : type in KIND ? type : 'internal';
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return {
    source: 'commit',
    title: scope ? `${sentence} (${scope})` : sentence,
    kind: KIND[key] ?? 'Internal',
    bump: breaking ? 'major' : type === 'feat' ? 'minor' : type === 'fix' ? 'patch' : null,
    packages: [],
    forYou: FOR_YOU[key] ?? FOR_YOU.internal!,
    date,
    ref: sha.slice(0, 7),
  };
}

export function versionNow() {
  try {
    return readJson<{ version: string }>('packages/react/package.json').version;
  } catch {
    return '0.0.0';
  }
}

function announcement(r: Omit<Release, 'announcement'>): string {
  const visible = r.entries.filter((e) => e.kind !== 'Internal');
  const action = r.entries.some((e) => e.kind === 'Breaking');
  const lines = [
    r.pending
      ? `Design system update coming in the next release${action ? ' (action needed)' : ''}:`
      : `Design system ${r.name} is out${action ? ' (action needed)' : ''}:`,
    ...(visible.length ? visible : r.entries).slice(0, 8).map((e) => `- ${e.kind}: ${e.title}`),
    '',
    action
      ? 'Some changes need action: check the changelog before you update your files.'
      : 'Nothing breaks. Figma variables and the docs update automatically after merge.',
    'Full changelog: /changelog/',
  ];
  return lines.join('\n');
}

let releasesCache: Release[] | null = null;

export function releases(): Release[] {
  releasesCache ??= readReleases();
  return releasesCache;
}

function readReleases(): Release[] {
  const SEP = '\u001f';
  const END = '\u001e';
  const raw = git(['log', '--no-merges', `--format=%H${SEP}%cs${SEP}%s${SEP}%b${SEP}%D${END}`]);
  const commits = raw
    .split(END)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [sha = '', date = '', subject = '', body = '', refs = ''] = c.split(SEP);
      const tag = refs.match(/tag: ((?:v|@bridge-ds\/[\w-]+@)\d+\.\d+\.\d+[^,]*)/)?.[1];
      return { sha, date, subject, body, tag };
    });

  const groups: Omit<Release, 'announcement'>[] = [];
  let current: Omit<Release, 'announcement'> = { name: 'Unreleased', pending: true, entries: [], date: undefined };
  const pending = pendingChangesets();
  current.entries.push(...pending);
  groups.push(current);
  for (const c of commits) {
    if (c.tag) {
      current = { name: c.tag.replace(/^@bridge-ds\/[\w-]+@/, 'v'), pending: false, entries: [], date: c.date };
      groups.push(current);
    }
    current.entries.push(commitEntry(c.sha, c.date, c.subject, c.body));
  }
  const first = groups[0]!;
  if (groups.length === 1) {
    first.name = `Unreleased (current version ${versionNow()}, no release tagged yet)`;
  }
  if (!first.date) first.date = commits[0]?.date;
  return groups.filter((g) => g.entries.length).map((g) => ({ ...g, announcement: announcement(g) }));
}

/**
 * The version the Library shows (the package version on main) and the tagged releases before it. Past releases
 * have notes in the Changelog but no archived docs yet, so the header menu lists them as not browsable.
 */
export function versionInfo(): { current: string; past: { name: string; date?: string }[]; pending: number } {
  const all = releases();
  return {
    current: `v${versionNow()}`,
    past: all.filter((r) => !r.pending).map((r) => ({ name: r.name, date: r.date })),
    pending: all.filter((r) => r.pending).reduce((n, r) => n + r.entries.length, 0),
  };
}
