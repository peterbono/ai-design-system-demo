---
'@bridge-ds/core': minor
'@bridge-ds/mcp': minor
'@bridge-ds/cli': minor
'@bridge-ds/docs-site': minor
---

Opt-in `governance.soloOwnerCanApproveBoth` for a design system run by one person. When it is true and the owners
resolve to exactly one person holding both roles, that person's approval counts as the design and the tech approval,
so Tier 2 and Tier 3 pull requests and suggestions can reach approved. Default false: one person still never covers
both approvals alone. The author of a change still never approves it. Core adds `soloApprover`, `soloOwnerOf`,
`soloOwnerSentence` and an optional rules argument to `summarizeApprovals`; `summarizeSuggestionApprovals` reads the
flag from its governance. Studio Settings shows an "Only owner" line when the rule is active, the suggestion and pull
request reviews say "As the only owner, your approval covers design and code." with one Approve, and
`bridge settings`, `bridge branch status`, `bridge suggestions show` and the MCP tools say the same.
