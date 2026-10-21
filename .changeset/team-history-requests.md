---
'@bridge-ds/core': minor
'@bridge-ds/docs-site': minor
---

Team pages: History, component change requests and "Start an exploration" now work for the team in the address
instead of the demo. History reads the team's merged token changes from GitHub (signed in, the 20 latest, with each
change's token diff read when it opens), and the token drawer's "See the whole history" lands there. A request opens in
place from the team's request issues. An exploration starts against the team's repository: in direct mode the first
write asks for Bridge Direct's OK; in suggest mode Studio says why it does not start one, since an exploration is a
branch.

Core: the repo model reads the global stylesheets a library ships (new optional `components.styles` globs in
`bridge.config.json`, default every .css file under `styles/` and `theme/` next to the components folder) and counts
their `var(--token)` reads as usage, so team Quality and the team token explorer no longer flag tokens only base styles
read as unused. Snapshots record the globs they read; a snapshot from before reads those files from the repository.
