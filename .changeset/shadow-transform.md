---
"@bridge-ds/core": patch
---

Measure: a part's box-shadow becomes a `shadow` field (drop and inner shadows, transparent rings left out), drawn as
Figma effects by the plugin; and a part a transform moves or scales (a progress indicator slid left with translateX)
sits where and as big as it is drawn, out of the flow, instead of where the layout would put it.
