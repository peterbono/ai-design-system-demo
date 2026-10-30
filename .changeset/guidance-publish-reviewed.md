---
'@bridge-ds/docs-site': patch
'@bridge-ds/react': patch
---

Publishing Claude's usage guidance from the docs editor now counts as its review: the drafts still pending go out kept (credited to Claude, `needsReview` false) instead of marked for a review nobody is asked for, and the send step says so. On the Studio home, a guidance draft someone already sent no longer waits on you: published, it reads "On its way to the library"; sent for review, "In review", and it opens the change. VisuallyHidden's guidance, published in #610, is marked reviewed.
