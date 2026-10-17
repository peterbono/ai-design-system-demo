---
"@bridge-ds/core": minor
"@bridge-ds/figma-plugin": minor
---

Push names structure changes. Each variant keeps a layer outline, so a layer added, removed or moved becomes a
"Structure change" request (new request kind `structure`) with a line like `New instance layer "Icon" (Icon/Pencil)
after "Label" in primary sm` and the title "Add a layer after Label", instead of a vague visual change. Renames,
wrappers and hidden layers bound to nothing still send nothing. When an optional part already draws the added layer
(an icon after the label while "Icon end" exists), the row says "Icon end already does this: show it with the Icon end
property" and the item starts unchecked; "Keep it as a request" sends it anyway.
