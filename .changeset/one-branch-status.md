---
"@bridge-ds/core": minor
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
"@bridge-ds/docs-site": patch
---

One status per branch, everywhere. `reviewStatusKind` is the single derivation for the Branches list, the branch page, the home cards, `bridge_what_needs_me`, `bridge_branch_status` and `bridge branch status`. A repo with no automated checks is a calm state of its own ("No automated checks", `CI_STATE_LABEL`) and the status comes from the approvals, as for any branch. While GitHub computes whether a branch merges cleanly, a missing approval still shows; "Checking for conflicts" only holds back "Ready to merge". The words live in core (`REVIEW_STATUS_LABEL`), and the branch page header now shows the same pill as its row ("Owner override needed", "Design owner to approve") instead of a plain "In review".
