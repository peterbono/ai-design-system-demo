---
"@bridge-ds/core": patch
"@bridge-ds/cli": patch
---

The team snapshot now carries releases, packages and motion, so a team's hosted Library can show its Changelog, Install and motion sections. `bridge snapshot` reads each workspace package and its CHANGELOG.md, the pending changesets and the release dates (tags, or git history on a full clone), and core adds the motion section of every component from its specs. Schema version stays 1: older snapshots still read. Core also exports the Changelog model (collectReleases, groupReleases) and motionDocs, moved from the docs site.

For you: nothing to change. Add `fetch-depth: 0` to the checkout in bridge-data.yml if you want release dates without release tags.
