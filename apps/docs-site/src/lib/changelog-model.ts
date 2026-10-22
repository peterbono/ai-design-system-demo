// Pure parsing and grouping for the Changelog, now in @bridge-ds/core (changelog-model.ts) so the team snapshot carries
// the same releases. Re-exported here under the names the docs site uses. Unit tested in changelog-model.test.ts.
export {
  CHANGELOG_DETAIL_MAX as DETAIL_MAX,
  groupReleases,
  noteSentences as sentences,
  parseChangelogSections as parseChangelog,
  parseChangeset,
  releaseAnnouncement as announcement,
  releasePackagesLabel as packagesLabel,
  shortPackage,
  sortChangelogEntries as sortEntries,
  splitNote,
  type ChangelogBump as Bump,
  type ChangelogEntry as Entry,
  type ChangelogRelease as Release,
  type ChangelogReleasePackage as ReleasePackage,
  type ChangelogSection,
} from '@bridge-ds/core';
