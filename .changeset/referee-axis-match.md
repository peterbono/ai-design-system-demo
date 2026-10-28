---
'@bridge-ds/core': patch
---

The values referee of the Figma fix loop finds a variant when the fidelity run names it with fewer axes than the rebuilt set has (the run keeps only the axes that vary between its shots, the Button set also has Loading and Full width). Before, every such variant came back as gone and nothing was measured. A new `matchVariant` takes the exact key first, else the one variant holding every asked axis whose other axes sit at their default, and finds nothing when that still leaves a choice. The gap case uses it too, so its variants carry the set's props and their shot.
