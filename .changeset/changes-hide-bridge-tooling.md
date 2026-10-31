---
'@bridge-ds/core': minor
'@bridge-ds/docs-site': patch
---

Studio Changes and the home leave out pull requests that only change Bridge itself. bridge.config.json takes an
optional `tooling` key: the folders that are the tool around the design system (`paths`, with `!` to keep a file as
design system) and the pull request title scopes that mean tooling (`scopes`, the guess until the changed files are
read). Core `isToolingPull` decides: the changed files once read, the title's scopes before; explorations, bridge/
branches and changes Bridge opened for someone are never left out. Without the key (a team's design system
repository) nothing changes. Bridge's own repository lists Studio, the core, the CLI, the MCP server and the toolbar,
so Shipped shows design system work only. The side nav's account row shows the GitHub profile name, the @login
staying in its menu.
