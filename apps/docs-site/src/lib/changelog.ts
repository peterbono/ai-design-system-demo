// Human changelog, read at build time from what the repo already has:
//   1. each package's CHANGELOG.md (packages/* and apps/*), written by the release action: the published versions,
//   2. .changeset/*.md: the entries waiting for the next release,
//   3. release dates: the release tags (@bridge-ds/react@1.1.0) when the clone has them, else the commit that added
//      the version heading to CHANGELOG.md. No date is shown when git has neither; none is ever guessed.
// Parsing and grouping are pure, in changelog-model.ts.
import { git, listDir, readJson, readText, exists } from './repo';
import { announcement, groupReleases, parseChangelog, parseChangeset, sortEntries, type ChangelogSection, type Entry, type Release } from './changelog-model';

export type { Bump, Entry, Release, ReleasePackage } from './changelog-model';

export function pendingChangesets(): Entry[] {
  return listDir('.changeset')
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map((f) => parseChangeset(readText(`.changeset/${f}`), `.changeset/${f}`))
    .filter((e): e is Entry => e !== null);
}

export function versionNow() {
  try {
    return readJson<{ version: string }>('packages/react/package.json').version;
  } catch {
    return '0.0.0';
  }
}

/** Every CHANGELOG.md of a workspace package, with its npm name and whether it is published. */
export function changelogFiles(): { file: string; pkg: string; published: boolean }[] {
  const out: { file: string; pkg: string; published: boolean }[] = [];
  for (const dir of ['packages', 'apps']) {
    for (const name of listDir(dir)) {
      const file = `${dir}/${name}/CHANGELOG.md`;
      if (!exists(file) || !exists(`${dir}/${name}/package.json`)) continue;
      const pj = readJson<{ name: string; private?: boolean }>(`${dir}/${name}/package.json`);
      out.push({ file, pkg: pj.name, published: !pj.private });
    }
  }
  return out;
}

/** Release tags the clone has: "@bridge-ds/react@1.1.0" -> "2026-10-18". Empty on a clone without tags. */
function tagDates(): Map<string, string> {
  const raw = git(['for-each-ref', '--format=%(refname:short)\t%(creatordate:short)', 'refs/tags/']);
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const [tag, date] = line.split('\t');
    if (tag && date && /@\d+\.\d+\.\d+/.test(tag)) map.set(tag, date);
  }
  return map;
}

/** Date of the commit that added "## <version>" to a CHANGELOG.md, or undefined when the history does not reach it. */
function headingDate(file: string, version: string): string | undefined {
  const out = git(['log', '--format=%cs', '-S', `## ${version}\n`, '--', file]);
  const lines = out.split('\n').filter(Boolean);
  return lines[lines.length - 1];
}

let releasesCache: Release[] | null = null;
let sourceNote = '';

export function releases(): Release[] {
  releasesCache ??= readReleases();
  return releasesCache;
}

/** Where the release dates came from on this build, for the "For developers" section. */
export function releaseDateSource(): string {
  releases();
  return sourceNote;
}

function readReleases(): Release[] {
  const files = changelogFiles();
  const sections: ChangelogSection[] = files.flatMap((f) => parseChangelog(readText(f.file), f.pkg, f.published));
  const tags = tagDates();
  const fileOf = new Map(files.map((f) => [f.pkg, f.file]));
  let fromTags = 0;
  let fromLog = 0;
  const dateOf = (pkg: string, version: string) => {
    const tagged = tags.get(`${pkg}@${version}`);
    if (tagged) {
      fromTags++;
      return tagged;
    }
    const logged = fileOf.has(pkg) ? headingDate(fileOf.get(pkg)!, version) : undefined;
    if (logged) fromLog++;
    return logged;
  };
  const released = groupReleases(sections, dateOf);
  sourceNote =
    fromTags || fromLog
      ? `Release dates come from ${[fromTags && 'the release tags', fromLog && 'the commit that added each version to CHANGELOG.md'].filter(Boolean).join(' and ')}.`
      : 'This build had no release tags and no history for the CHANGELOG.md files, so release dates are not shown.';

  const pending = pendingChangesets();
  const next: Omit<Release, 'announcement'>[] = pending.length
    ? [{ name: 'Coming in the next release', pending: true, packages: [], entries: sortEntries(pending), date: undefined }]
    : [];
  return [...next, ...released].map((r) => ({ ...r, announcement: announcement(r) }));
}

/**
 * The version the Library shows (the package version on main) and the releases before it. Past releases have notes
 * in the Changelog but no archived docs yet, so the header menu lists them as not browsable.
 */
export function versionInfo(): { current: string; past: { name: string; date?: string }[]; pending: number } {
  const all = releases();
  const current = `v${versionNow()}`;
  return {
    current,
    past: all.filter((r) => !r.pending && r.name.startsWith('v') && r.name !== current).map((r) => ({ name: r.name, date: r.date })),
    pending: all.filter((r) => r.pending).reduce((n, r) => n + r.entries.length, 0),
  };
}
