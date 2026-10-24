---
"@bridge-ds/core": patch
---

Token pull requests pushed from Figma say "From Figma: design-approved, ships once the checks pass" (or "waits for a
developer OK" for a rename or removal) instead of the approvals line (`figmaPushTierLabel`, `fromFigma` on
`composePrBody`, `composeProposalBody` and `planTokenProposal`). Build requests: one item per change when the
library branch from Figma closes the issue; assignees on that branch count, the sender never reads as the builder.
