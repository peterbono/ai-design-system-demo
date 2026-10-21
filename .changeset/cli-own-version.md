---
'@bridge-ds/cli': patch
---

The CLI reports its own version: `bridge --version`, the help banner, audit reports and snapshots recorded the `@bridge-ds/mcp` version (0.8.3) instead. `bridge --version` also printed the help and exited 2; it now prints the version and exits 0, like `bridge version`.
