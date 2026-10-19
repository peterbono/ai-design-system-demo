---
"@bridge-ds/react": minor
"@bridge-ds/docs-site": minor
"@bridge-ds/admin": patch
---

Variants and props for the gaps Studio and the admin worked around.

- Button and IconButton: `pressed` makes a toggle (`aria-pressed`, a selected fill and a doubled Deep Harbor edge; the look follows the attribute, so a script can drive a static toggle). Button `variant="link"` looks like a text link and stays a button, with the DS focus ring. `variant="inverse"` is the action on a strong surface (Deep Harbor, `color.surface.inverse`).
- SegmentedControl: `appearance="strong"` fills the selected segment with Deep Harbor. Any number of segments: when they do not fit (a phone), the track scrolls sideways with scroll shadows instead of widening the page, and the selected segment scrolls into view. The focus ring now sits inside the segment so the track never clips it.
- Select: `badge` on an option (a status or a count), shown on the item and in the trigger once selected. `portalContainer` on Select and Combobox.
- Combobox, Select and Menu popups sit on the popover layer, above a Dialog or Drawer, so a list opened inside a dialog is never covered.
- Menu: `icon` also takes an element (a brand mark); leading icons and indicators show reliably and keep labels aligned.
- Table: `width` (token length, percentage or a fraction like `0.35`) and `minWidth` on TableHead and TableCell, `layout="fixed"`, and `narrowLayout="stack"`: under about 480px each row becomes a card, every value under its column name (`label` on a cell, or the header text).
- Alert: `actionsPlacement="inline"` puts the action at the end of a short message and under it on a phone.

Adopted in Studio (Changes status filter on phones, the Viewing select's status badges, view and edit banners, Components "need guidance" filter, Settings approvals on phones, Start a change menu icons and families), on the Library site (terminal Copy buttons, Accessibility Compare) and in the admin Bridge toolbar (Before/After and Show what changed toggles). Homemade CSS for these is removed.
