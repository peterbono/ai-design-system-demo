---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
---

Claude finds explorations in a design team's copy by their branch or their name, not only by their number. GitHub's branch filter on pull requests finds nothing in a fork that lives in the same organization as the product, so "Continue Bridge exploration" with the branch said "No open exploration" and Claude fell back to plain git. Bridge now reads the copy's open pull requests when that filter comes back empty. An exploration located in the copy carries the copy's preview pattern, so Continue and Done exploring link the copy's preview, and Done exploring files the task in the developers' repository as Studio does.
