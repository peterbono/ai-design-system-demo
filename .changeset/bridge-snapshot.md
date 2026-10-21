---
'@bridge-ds/core': minor
'@bridge-ds/cli': minor
---

New `bridge snapshot`: writes the repo model of a checkout for hosted Bridge (`snapshot.json`: the token, contrast and
component files the model reads, Figma coverage without the 1 MB specs, contrast results, counts) plus
`audits/<id>.json` (`--audit <folder>[=label]` runs `bridge audit`, `--audit-report` carries existing reports). Core
gets the snapshot schema: `parseSnapshot`, `buildSnapshot`, `snapshotSource` (a `RepoSource`, so `loadRepoModel`
reads a snapshot like a repository), `recordingSource`, `snapshotIsFresh`. The `bridge-data` workflow publishes it
to the orphan `bridge-data` branch; `templates/bridge-data.yml` is the copy for other teams (docs/HOSTED.md).
