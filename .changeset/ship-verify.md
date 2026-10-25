---
'@bridge-ds/figma-plugin': patch
'@bridge-ds/docs-site': patch
---

Ship: Bridge checks who asks and where a change comes from before it ships a push from Figma by itself. The author, with write access, records the push right after the plugin opens it (`POST /api/ship` with `mark: "figma"`), and Bridge ships it only while the head is the one it recorded, from a branch of the repository itself, with no change requested. Anything else follows the design approval rule. The plugin records each push before it asks Bridge to ship it.
