---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
---

Token values follow the Figma rule wherever they are made (decision TV-1): a pull request or a suggestion that only
changes token values (values changed or tokens added, nothing renamed or removed, no code) needs the design approval
only. Once it is in, the tech approval counts as given and the change ships after the automatic checks
(`isTokenValueChange`, `mayBeTokenValueChange`, `withTokenValueApprovals`, `branchVerdict` `tokenValues`,
`suggestionIsTokenValues`, `summarizeSuggestionApprovals` `valuesOnly`, `requiredApprovals(tier, valuesOnly)`).
Renames and removals still need a developer OK. Studio, the MCP server and the CLI read the same verdict
(`bridge_branch_status` says "Design approval (token values ship after the checks)").
