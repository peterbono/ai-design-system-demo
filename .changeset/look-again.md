---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
---

A branch updated after a changes request waits on the reviewer who asked: core `lookAgainReviewers`, `Review.commitId` from `listReviews`; Studio says "Your turn: look again" to that reviewer and lists it on their home, the author no longer reads "Your turn: address changes"; `bridge_branch_status` gives `approvals.lookAgain` and the next step, `bridge_what_needs_me` says "Look again: updated after your changes".
