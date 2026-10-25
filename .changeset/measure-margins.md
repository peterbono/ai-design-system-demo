---
'@bridge-ds/core': patch
'@bridge-ds/cli': patch
---

Measure what Carbon's form fields and controls really lay out. Child margins become auto layout: a first or last child's margin becomes padding, the space between children becomes the gap when uniform, else the smallest gap plus `spacers` per child. Widths and heights the CSS sets are listed in `sized` (kept fixed, not hugged). A percentage radius becomes px from the box (50% of a knob is half its side). An inline element holding blocks, and a row whose children sit stacked, take their direction from their boxes (a wrapping row stays a row). Closed or hidden content (opacity 0, hidden, inert, clipped away, an aria-hidden popover, an empty zero-size shell) is not a part. `--variants` runs once a component's stories are measured and starts each combination from the closest story; it probes an enum by rendering its default and one other value through args and comparing them with popovers and tooltips left out, so an arg that only opens, aligns or moves a popup is not an axis.
