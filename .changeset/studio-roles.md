---
"@bridge-ds/core": minor
"@bridge-ds/mcp": patch
"@bridge-ds/docs-site": minor
---

Roles with default rights, editable per team, and a visual before and after that can run on demand.

Core: `governance.rights` in `bridge.config.json` says which owner group may approve design, approve tech and ship
(merge, which publishes to the products): `{ "approveDesign": ["design"], "approveTech": ["tech"], "ship": ["tech"] }`
by default, and a team may let design owners ship too (`"ship": ["design", "tech"]`). A config without `rights`
behaves as before: approvals follow `owners`, anyone with write access ships. New top-level `visualImpact.mode`,
`"auto"` (default) or `"on-demand"`. Both are validated by `loadConfig` and the JSON schema and written back by
`toConfigJson`. New exports in `rights.ts`: `DEFAULT_RIGHTS`, `normalizeRights`, `holdersOf`, `approverLists`,
`shipPolicy`, `canShip`, `whoCanShipSentence`, `groupsPhrase`, `RIGHT_LABEL`, `VISUAL_CHECK_LABEL`.

MCP and CLI: `bridge init` (detected configs) starts from the default rights.

Studio: Settings gains Roles: one sentence, who holds each right with their avatars, and the visual before and after
mode; "Change roles" proposes the edit as a pull request on `bridge.config.json` (only `governance.rights` and
`visualImpact` change). Reviews counts approvals against the rights and keeps Merge off for a viewer without the
ship right, saying who can ("Only the tech owner can ship this (@theo)."); the owner override never bypasses it.
In on-demand mode a pull request without a before and after offers "Show the visual impact", which adds the
`visual-check` label (the workflow runs on it), or links to GitHub without a write token.
