---
"@bridge-ds/figma-plugin": patch
---

Pull recreates variables deleted in Figma that other tokens still alias, does not read an alias it could not set as a Figma edit, and treats a file whose synced collections were deleted as a first pull.
