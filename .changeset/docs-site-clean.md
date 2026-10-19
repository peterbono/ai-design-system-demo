---
"@bridge-ds/react": minor
"@bridge-ds/core": patch
"@bridge-ds/docs-site": patch
---

`@bridge-ds/react/dom` gains the Dialog for pages without React at runtime: `dialogHtml()` renders the exact markup of `<DialogContent>` (same classes, same look), and `bindDialogs()`, `openDialog()`, `closeDialog()`, `isDialogOpen()` and `dialogReturnValue()` give it the React Dialog behavior: focus moves in and is trapped, the page behind is inert and does not scroll, Escape and the scrim close it, focus returns to the trigger, `aria-modal`, `open`, `cancel` and `close` events, and a `<form method="dialog">` inside closes it with the submit button's value. A parity test compares it with the React Dialog. SegmentedControl: the selected segment uses the raised surface, so it no longer disappears into its track in dark mode (light is unchanged).

The audit counts a native element only when the design system has a component that replaces it: `<img>` is no longer a miss in a design system without an Image component.

The docs site has no temporary audit allowlist any more: its prose links are the DS Link or ButtonLink, its icons are the DS Icon (the site's own glyphs, drawn through `createLucideIcon`), the Quality audit table is the DS Table, and the search palette, New token, Send for review, Connect GitHub and Undo planner dialogs are DS Dialogs opened by their scripts. Every Studio header control is the DS sm size.
