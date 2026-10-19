---
"@bridge-ds/tokens": minor
"@bridge-ds/react": patch
"@bridge-ds/docs-site": patch
---

Dark mode polish and leftovers from the critiques.

- Tokens: `color.surface.strong` (Deep Harbor in both themes, for a strong mode surface) and `color.feedback.neutral.bg` (the fill of a status with no tone, one step off every surface in both themes), each checked by a new contrast pair. `popup.border` steps up to `color.border.emphasis` so a list opened inside a Dialog keeps an edge in dark.
- SegmentedControl: the selected segment takes the checked control color as its edge, like a pressed Button toggle; it had no edge in dark.
- Banner `appearance="strong"`: `color.surface.strong` with `color.text.on-solid` and a matching focus ring. In dark it was the light primary action color and read like a Harbor zone.
- Badge neutral (subtle): `color.feedback.neutral.bg`, so grey status chips keep their fill on dark cards.
- Docs site: the owner override confirmation is the DS Dialog for plain scripts (Textarea, Alert, SegmentedControl, ButtonGroup) instead of a native dialog; All tokens filter controls share one size; Quality audit tables stack on phones; the Changes tabs fit a phone; Changes rows say "Library moved on: N updates"; failing developer tests are never "Your turn" for the designer who made the change; the search palette shows the nav icons; Tokens type chips use the selected look; rows of a viewed change say "Changed" or "New"; "Bring in the latest library" uses the standard control height.
