---
'@bridge-ds/react': patch
---

Select: the label and badge row in the trigger now applies to every Select, not only disabled ones. A stray selector limited it to disabled triggers, so badges sat under the label and the narrow-trigger rule never ran.
