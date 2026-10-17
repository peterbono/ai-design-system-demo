---
"@bridge-ds/docs-site": patch
---

Studio Components, "Edit tokens" now opens Studio Tokens on `?component=<slug>`: exactly the tokens that component's CSS module reads, across every collection, with a removable "Used by IconButton" chip in the chip row. The Tokens column, the Library component cards and the component page count the same set, so the link never lands on "No token matches". Components that read no token get no link.
