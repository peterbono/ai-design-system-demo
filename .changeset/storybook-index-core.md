---
'@bridge-ds/core': minor
'@bridge-ds/visual': patch
---

Core reads a Storybook without the repo. `fetchStorybookIndex` tries `index.json` (Storybook 7 and later, v4 and v5)
then `stories.json` (v3), skips HTML fallbacks, and reports why it failed (`not-found`, `not-json`, `private`, `empty`,
`http`, `network`). `parseStorybookIndex` groups entries into components by title and keeps test entries out of the
story list. `normalizeStorybookUrl`, `storybookIframeUrl` and `storybookManagerUrl` build the addresses. The visual
impact tool now parses `storybook-static/index.json` and builds story URLs through core; its output is unchanged.
