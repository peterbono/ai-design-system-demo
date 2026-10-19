---
"@bridge-ds/docs-site": patch
---

Studio status polish.

- Changes: the summary line and its button point at the most urgent change where it is your turn. With none, they name the most urgent change; when only a developer can move it, the line says it waits on a developer and shows no button.
- A change: "Ready for review" keeps one tone whatever its checks say (status colour for the status only); failing checks show in the checklist and the "Blocked by tests" chip. The Overview and the change selector use the same tone.
- Quality audits: share bars, legend keys and trend lines use the Harbor data hue and neutrals, never the success, warning or info hues.
- Tokens: the type chips, the filter field, Options and New token sit at the DS control height (44px), up from 32px.
