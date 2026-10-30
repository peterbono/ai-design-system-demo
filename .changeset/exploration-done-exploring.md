---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
"@bridge-ds/docs-site": patch
---

"Done exploring" replaces "Promote to review" for explorations: the pieces the designer ticks go to the DS lead as requests with a link to the preview, the `exploration` label gives way to `ready-for-devs`, and developers take the branch as a starting point (`git fetch origin`, `git checkout explore/<name>`). Nothing is closed or merged, so the preview link stays alive; statuses read Waiting for code, Being built, Shipped. "Archive" (the `archived` label) hides an exploration from the lists without closing it, with an Archived filter in Changes. New: `doneExploringOnGitHub`, `archiveExplorationOnGitHub`, `proposePiecesOnGitHub`, `pieceRequest`, `bridge explore done|archive|unarchive`, `bridge_archive_exploration`; `bridge_promote_exploration` and `bridge explore promote` keep their names and now do Done exploring.
