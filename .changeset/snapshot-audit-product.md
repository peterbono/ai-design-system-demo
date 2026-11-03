---
"@bridge-ds/core": minor
"@bridge-ds/cli": minor
---

`bridge snapshot` records which bridge.config.json product each audit measured (`product` on snapshot audits): the product whose `path` holds the audited folder, or whose `repo` is the folder's git origin. Older snapshots without it still read.
