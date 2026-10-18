---
"@bridge-ds/react": minor
"@bridge-ds/docs-site": patch
---

Textarea gets `appearance="inline"` for editing existing text in place: no border, no resize handle, the surrounding
font, size and line height, a height that fits the content (`field-sizing: content`, measured without moving the page
where it is not supported), a fill and hairline on hover and the DS focus ring on focus. Never use it in forms.
The Library edit mode now uses it instead of restyling Textarea internals.
