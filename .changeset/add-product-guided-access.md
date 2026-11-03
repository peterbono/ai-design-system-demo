---
"@bridge-ds/docs-site": patch
---

Add a product: when a product is not in the list, "Give Bridge access" opens GitHub in a small window on the page where the admin ticks which products Bridge sees. The dialog waits, finds the new product on its own and comes back with it picked and named. The list is never a dead end, and a new return page (/studio/auth/access/) lets GitHub hand back at once.
