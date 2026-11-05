---
"@bridge-ds/docs-site": patch
---

Studio tests run the same on every runner: each test waits for the work it started (a product being created, a read of GitHub, the linked GitHub role) before the next one begins, so nothing lands in another test. No change to the product.
