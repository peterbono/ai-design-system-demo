---
'@bridge-ds/core': minor
---

Add the repo model: `RepoSource` (`list`, `text`) with `memorySource` and, in `@bridge-ds/core/node`, `fsSource` over a
local checkout, and `loadRepoModel(source)`, which parses `bridge.config.json` once and computes the token rows,
contrast results, component scan (props, CSS tokens, stories, docs.json) and Figma coverage from it. The parsers move
from the docs site into core (`buildTokenRows`, `evaluateContrastPairs`, `scanComponents` and friends), browser-safe,
with every path taken from the config (defaults: the paths this repo used before). New optional config key
`tokens.usage` (token group notes, relative to `tokens.root`). `gitHubSource` now implements
the shared `RepoSource` interface and lists paths sorted; `repo-source-github` and `repo-access` are exported from
the main entry.
