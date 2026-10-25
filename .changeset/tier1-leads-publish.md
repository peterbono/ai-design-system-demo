---
'@bridge-ds/core': minor
'@bridge-ds/cli': minor
'@bridge-ds/mcp': minor
---

Tier 1 publish by leads. New `governance.leadsPublishTier1` in `bridge.config.json` (absent counts as on): team admins and the reviewers of the matching domain publish a Tier 1 change without review, and Bridge merges it once the checks pass. Core adds the `tier1-publish` module (`canPublishTier1`, `tier1Domain`, `tier1PublishOf`, `publishedWithoutReview`, `tier1PublishSentence`) and `branchVerdict` reads `tier1Published` as on its way until a check fails. `bridge settings` and the MCP settings and roles say who may publish small changes; `bridge branch status` and `bridge_branch_status` say "Published by <name> without review (Tier 1)."
