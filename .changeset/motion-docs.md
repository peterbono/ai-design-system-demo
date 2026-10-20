---
"@bridge-ds/core": minor
"@bridge-ds/react": patch
"@bridge-ds/docs-site": minor
---

Motion is documented and reviewed from the code. The spec generator now records how a part opens and closes: the "Opening and closing" motion note carries the code's `enter` and `exit` transitions (duration, easing and their motion tokens, read per element so a drawer's side class and its popup class count together), and looping animations carry their `durationToken`. `componentMotion` returns them as `opening` and lists their tokens, so `componentsUsingMotionToken(specs, "motion.duration.moderate")` finds Dialog and AlertDialog. component-specs.json is regenerated (popup sets gain their open and close motion).

Every Library component page has a generated "Motion and interaction" section in its Tokens tab: when it moves (hover, press, check, open, close, loops), what changes, the duration token with its value and the easing token in words, and what reduced motion does, in one sentence. Components without motion say so in one line; motion the specs cannot place is said, never denied.

For branch reviews, `MotionChanges` (components/ds/studio/MotionChanges.tsx) shows a plain sentence per motion change, two looping previews of the same component at the old and new motion with Replay, and the other components it touches; still frames under reduced motion. `motionChanges` (lib/motion-changes.ts) computes the changes from the token sets and specs at both commits; `mountMotionChanges` (scripts/reviews/motion-changes.ts) mounts the block from a review page.
