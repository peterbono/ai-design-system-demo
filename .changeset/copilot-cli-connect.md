---
'@bridge-ds/cli': minor
---

`bridge connect --tool copilot` (or `--tool both`) sets a product repository up for GitHub Copilot in VS Code, agent
mode: the Bridge MCP server in `.vscode/mcp.json` (`"servers"`, the same `npx -y @bridge-ds/mcp --repo <ds>` command
as `.mcp.json`) and the Bridge section in `.github/copilot-instructions.md`, unless `AGENTS.md` carries it already.
It merges into existing files (other servers, `inputs`, comments kept), never replaces a different `bridge` server
without `--force`, and a second run changes nothing. Without `--tool`, Copilot is included when the repository has
one of those files already.
