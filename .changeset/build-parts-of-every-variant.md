---
"@bridge-ds/core": patch
"@bridge-ds/figma-plugin": patch
---

Parts only some variants render are built, not left for the designer to draw. A set built from the measure now has the parts of every variant's story, not the default story's alone: a check mark only a checked story renders, a dot only a selected one, a description only one placement shows. Each is drawn from its own story (size, place, colors bound to the tokens, its SVG), and hidden in the variants that do not render it. A set drawn before gets them on the next Check for updates, in place, and the designer's own layers stay. The gap case Claude reads says a part is missing in Figma only when the file has no layer for it (a hidden one is "hidden in Figma, shown in code"), so Claude no longer asks the designer to draw a check mark, dot or fallback the component already has. The status fixes that did so (Avatar, Checkbox, ChoiceCard, Radio) are removed, and those of Button, RadioGroup and Switch no longer ask to draw.
