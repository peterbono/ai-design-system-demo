---
"@bridge-ds/docs-site": patch
---

Studio Components, calmer list and drawer.

List: each thumbnail renders one calm sample of the component (the secondary or neutral look, never the destructive
one) at one size, and the columns say their facts in words: "Admin demo and Bridge itself", "1 request", "4
examples", "40 tokens". The token split ("1 own · 39 from Button") leaves the row for the drawer's "For developers".

Drawer, top to bottom: the family as an eyebrow on the name, one sentence with a link to the Library page, one live
preview with a Light/Dark switch (it starts on the page theme), the facts in one line ("Used in Admin demo (4
places). 40 tokens. Usage guidance written. No open request."), a pill only when guidance is missing or waits for a
review, then one row of actions with a single primary (the guidance while it is missing or in review, else Edit
tokens) and "Request a change" as the last secondary. Token origins, props, stories, the files folder, Code and the
component sandbox sit in one "For developers" fold at the bottom.
