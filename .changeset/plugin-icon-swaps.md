---
'@bridge-ds/figma-plugin': minor
---

Pulled components get real icons and content slots, swappable like a Figma library. An Icons page holds one
component per Lucide icon (`Icon/Plus`, drawn from its SVG, bound to the icon tokens) and a Slots page holds
`Slot/Card body text` and `Slot/Media`. Icon parts of Button, IconButton, Badge and Tag, and Card's body, are instances
of their code default with an INSTANCE_SWAP property (`Icon`, `Icon start`, `Icon end`, `Body`); Card `Padding=none`
shows Media. Swapping in a variant is a visual change only when it differs from the code default; a fresh pull still
sends nothing. Placeholders from earlier pulls are replaced in place.
