---
'@bridge-ds/core': minor
'@bridge-ds/mcp': patch
'@bridge-ds/cli': patch
---

Missing pieces now include a library component restyled from outside with tokens only: CSS on a class the component carries, often on a state selector such as `[aria-pressed='true']`, or a token-only inline style tied to its `pressed` prop, reads "IconButton: restyled when pressed" with what changed (`fill (icon) currentColor`) and a `restyle` mark that sets it apart from hand-picked values. Layout around the component (margin, position, inset, gap) is not a piece. Requests from pieces say the closest library value once, in the "Needed by" line with its token and value, and drop the "Now" column when nothing says what is there today. Done exploring says when no piece goes to the DS lead (none picked, or never checked), and the developer note follows the branch checks instead of always saying the code is not tested.
