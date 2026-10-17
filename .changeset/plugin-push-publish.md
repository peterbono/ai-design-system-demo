---
'@bridge-ds/figma-plugin': minor
---

Push works like publishing a library in Figma: a Changes list grouped Variables and Components with a checkbox per
item (all checked by default, select all per group), a Description that opens the pull request and every request, and
one "Push for review". Unchecked variable edits stay in Figma; unchecked component changes are not sent. "Mark as
experimental" (row menu) stores a durable mark on the variable or component set: experimental items show a tag and
start unchecked on every push.
