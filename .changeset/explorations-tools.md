---
"@bridge-ds/mcp": minor
"@bridge-ds/cli": minor
---

Explorations for Claude and the terminal: MCP tools `bridge_start_exploration` and `bridge_list_explorations`; CLI `bridge explore start <name> --purpose`, `bridge explore list`, `bridge explore promote <name>` and `bridge explore close <name>`. Write tools take a target exploration branch: `bridge_propose_token_change` and `bridge propose` with `branch` (one commit on GitHub, or the checked-out working tree locally), `bridge_draft_docs` with `branch`, `bridge_get_request` and `bridge request implement` with `branch`, `bridge_create_request` and `bridge request create` with `exploration`. Briefs for an exploration say to work on that branch and never open a pull request to main.
