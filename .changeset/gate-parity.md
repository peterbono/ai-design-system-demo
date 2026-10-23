---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
---

One merge verdict everywhere: `branchVerdict` and `approvedSuggestionOnGitHub` in core compose the review rules once, and Studio, the MCP tools (`bridge_branch_status`, `bridge_merge_branch`, `bridge_what_needs_me`, `bridge_get_settings`) and the CLI (`bridge branch status|merge|list`, `bridge settings`) read them. Tier 1 needs one owner approval, the owner override is for owners only and always needs a reason (20 characters by default), and a pull request that applies an approved suggestion with `Closes #n` carries its approvals.
