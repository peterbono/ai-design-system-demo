---
"@bridge-ds/core": minor
"@bridge-ds/figma-plugin": minor
---

Figma components are testable in prototype mode, with the design system's motion. The spec generator reads each set's interaction states (State and Checked axes) and the CSS `transition` of the parts that change, resolves durations and easings from the motion tokens (`motion.duration.*`, `motion.easing.*`), and records them in component-specs.json as `interactions` (trigger, axis, from and to values, transition) plus `motion`, the motion Figma cannot play (looping keyframes, keyboard focus, popups opening). Cubic bezier easings play exactly as Figma's custom bezier; when parts move at several speeds Figma plays the longest and the transition says it was approximated.

New pure helpers in `@bridge-ds/core`: `componentMotion(spec)` (reactions per variant, triggers with Figma's names, motion tokens, animated properties, approximations, what Figma cannot play, the reduced motion note) and `componentsUsingMotionToken(specs, tokenPath, chainOf?)` (sets whose interactions use a motion token, through aliases). `@bridge-ds/core/node` exports the CSS side (`parseTransitions`, `resolveDuration`, `resolveEasing`, `transitionBetween`, `motionNotes`).

The Figma plugin wires the variants with prototype reactions: While hovering, While pressing, On click (Mouse enter and Mouse leave on sets with a Checked axis), Change to with Smart animate. Idempotent: a second pull writes no reaction; reactions designers added are kept, and on the same trigger theirs wins. The Pull preview shows "Interactions: N" per set and lists the motion it could not map; set descriptions say "In code, reduced motion turns this off."
