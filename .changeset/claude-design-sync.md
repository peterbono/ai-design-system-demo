---
"@bridge-ds/mcp": minor
"@bridge-ds/docs-site": minor
---

The Bridge Library in Claude Design, kept in sync. Each docs-site deploy serves the Library as a Claude Design System
for its version (`/claude-design-system/manifest.json` and `/claude-design-system/<version>/project/...`, static files
built by `scripts/claude-design-system/release.mjs` in `docs:build`). New MCP tools: `bridge_get_claude_design_system`
gives the team's Claude the version, the manifest (path, size, sha256, url) and the steps (create the Design System
artifact once, then republish only the changed files to the same artifact and re-run the install in the canvases), and
`bridge_set_claude_design_system_url` remembers the team's artifact (admins and leads only, checked on the server).
Settings > Your AI tools shows admins one quiet line, "Claude Design: Bridge Library 1.8.4 · Update available", with
"Copy the request for Claude".
