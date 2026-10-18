---
"@bridge-ds/core": patch
"@bridge-ds/docs-site": patch
---

Studio Tokens and Components, designer first.

Tokens: the list says "Semantic and foundation tokens" (the base collection reads Foundation in Studio), collections
and usage filters move under Advanced in Options, swatches are 24px and values read at the UI size, and long names
wrap at their dots instead of truncating next to the details panel. The details say "Where the value comes from".
The value popover shows the real components that use the token, light and dark, repainted on every pick. The review
opens on its visual preview: light and dark side by side, before above after, several components scaled to fill
their frames; Export JSON moves under "For developers". "Send for review" replaces "Propose change": the dialog says
who approves from the configured rights ("The design owner and a developer will approve it; nothing ships before
both."), drafts the title from the edit ("Darker primary action fill") and keeps the branch sentence under "For
developers".

Components: each row starts with a thumbnail of the real component, "Stories" reads "Examples", and two columns join:
open requests per component and "Used in products" (from the committed audit reports). The drawer opens on the
component live in light and dark; Code, Workbench, props and stories move under "For developers". A request carries
a Figma link and one image (pasted or picked, committed to the requests branch like the Figma plugin does), Kind
starts on Visual change, and the button reads "Send request".

Core: the request kind "Prop change" reads "Option change (prop)" everywhere requests are shown.
