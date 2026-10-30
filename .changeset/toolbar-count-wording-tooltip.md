---
"@bridge-ds/toolbar": patch
---

The count of changed elements no longer reads like "This change": the bar says "13 changed", then "2 / 13 changed" while stepping, and screen readers hear "Changed element 2 of 13: Avatar" (also with changes tried together). The before and after tooltip of the current element now opens below it when there is room above the bar, else beside it, and above it only as a last resort, so the title above the element stays readable and the tooltip never covers the bar.
